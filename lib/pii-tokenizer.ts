/*
 * PII tokenization for the LLM boundary.
 *
 * Anthropic's API logs requests for 30 days for safety review. To avoid
 * exposing boater names / emails / phone numbers / vessel names to that
 * pipeline, we replace identifiable strings with stable opaque handles
 * before the SDK call and re-hydrate the response on the way back.
 *
 *   "send a reminder to David Emmons"     → "send a reminder to <<BOATER_b_42>>"
 *   "$2,400 owed by david@example.com"    → "$2,400 owed by <<EMAIL_b_42>>"
 *   "ring (505) 555-0103 for the slip"    → "ring <<PHONE_b_42>> for the slip"
 *   "boat Reel Time at slip A29"          → "boat <<VESSEL_v_17>> at slip A29"
 *
 * Tool-use round-trips operate entirely on handles — Claude proposes
 * `boater_query: "<<BOATER_b_42>>"`, we detokenize before resolution.
 *
 * Handle format
 * -------------
 * `<<KIND_id>>` with double angle brackets (NOT `[brackets]`, which
 * Claude has been observed to silently drop, and NOT `{{curlies}}`,
 * which collide with Mustache/Handlebars merge tokens that already
 * exist in comm templates).
 *
 *   - KIND ∈ { BOATER, LASTNAME, EMAIL, PHONE, VESSEL, VIN, REG }
 *   - id is the underlying entity id (b_42, v_17) for identity tokens
 *     so `detokenizeToolInput` can strip the wrapper and feed the raw
 *     id to existing fuzzy resolvers.
 *   - The double-angle wrapper survives a markdown round-trip and is
 *     impossible to confuse with prose.
 *
 * Per-request scope
 * -----------------
 * `createTokenizer()` returns a fresh handle universe. The mapping table
 * is held in a per-request `Map<string, string>` server-side. Never
 * persisted. If a tokenized prompt is replayed without the map, no
 * identifiable data leaks.
 *
 * Lazy-narrow vs. blanket replacement
 * -----------------------------------
 * The OLD design (kept as `buildTokenizationMap`) pre-built handles for
 * EVERY boater + vessel in the tenant, then ran a longest-match-first
 * substitution. That works but balloons Anthropic's token count: every
 * boater the tenant has ever onboarded shows up in the request even when
 * the user only mentioned one name.
 *
 * The NEW `createTokenizer()` is lazy — handles are minted ON FIRST
 * APPEARANCE during a tokenize() walk. Same input PII → same handle
 * within one request. Boaters never named in the request never enter
 * the handle table at all.
 *
 * Both APIs are kept side-by-side: the system prompt's static context
 * block still uses the old eager path (it lists every boater by name
 * so Claude has the universe to query against), while the user message
 * + tool args use the lazy path.
 */

import type { Boater, Vessel } from "@/lib/types";

// ────────────────────────────────────────────────────────────
// Eager-map API (legacy — used by tokenizeContextBlock)
// ────────────────────────────────────────────────────────────

export interface TokenizationMap {
  // token → real string
  forward: Map<string, string>;
  // real string → token (used to re-tokenize tool inputs Claude emits)
  reverse: Map<string, string>;
}

export interface BuildOptions {
  boaters: Boater[];
  vessels: Vessel[];
}

/**
 * Build the eager tokenization map for a request. Run once at the top of
 * /api/agent and pass the resulting map through both directions.
 *
 * Longest-match-first ordering ensures "David Emmons" wins over "David"
 * when both are in the catalog.
 */
export function buildTokenizationMap(opts: BuildOptions): TokenizationMap {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();

  function addPair(real: string | undefined, token: string) {
    if (!real) return;
    const trimmed = real.trim();
    if (trimmed.length < 3) return; // skip empty + too-short to be uniquely identifying
    // Don't overwrite an existing reverse mapping — first writer wins
    // so "Emmons, David" and "David Emmons" can both map to the same
    // BOATER token without one clobbering the other.
    forward.set(token, trimmed);
    if (!reverse.has(trimmed)) reverse.set(trimmed, token);
  }

  for (const b of opts.boaters) {
    addPair(b.display_name, `<<BOATER_${b.id}>>`);
    addPair(`${b.first_name} ${b.last_name}`, `<<BOATER_${b.id}>>`);
    addPair(`${b.last_name}, ${b.first_name}`, `<<BOATER_${b.id}>>`);
    // Last-name-only is risky (collisions) — we still add it, but the
    // longest-match-first sort below puts full-name matches first.
    addPair(b.last_name, `<<LASTNAME_${b.id}>>`);
    if (b.primary_contact?.email) {
      addPair(b.primary_contact.email, `<<EMAIL_${b.id}>>`);
    }
    if (b.primary_contact?.phone) {
      addPair(b.primary_contact.phone, `<<PHONE_${b.id}>>`);
    }
    if (b.address?.line1) {
      addPair(b.address.line1, `<<ADDR_${b.id}>>`);
    }
  }

  for (const v of opts.vessels) {
    addPair(v.name, `<<VESSEL_${v.id}>>`);
    if (v.hull_vin) addPair(v.hull_vin, `<<VIN_${v.id}>>`);
    if (v.registration) addPair(v.registration, `<<REG_${v.id}>>`);
  }

  return { forward, reverse };
}

/**
 * Escape a literal string for safe use as a regex pattern. Avoids
 * accidental metacharacter interpretation of e.g. parentheses inside
 * formatted phone numbers like "(505) 555-0100".
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Decide whether `real` looks like an identifier where word-boundary
 * matching makes sense. Names + last names + addresses → yes. Emails +
 * phones (which contain digits + @ + punctuation) → no, because the
 * RegExp `\b` semantics don't fire cleanly around `@` or `(`.
 */
function shouldUseWordBoundary(real: string): boolean {
  if (!real) return false;
  // Emails: contains @ — \b doesn't fire on the leading/trailing
  // identifier boundaries the way you'd want.
  if (real.includes("@")) return false;
  // Phones: contain digits or punctuation chars — same problem.
  if (/[\d()+-]/.test(real)) return false;
  // Alphabetic + spaces + apostrophes → word-boundary mode.
  return /^[A-Za-z][A-Za-z\s'.-]*$/.test(real);
}

/**
 * Replace all real strings with handles. Pass-through for anything
 * outside the map.
 *
 * Sort by descending length so "David Emmons" matches before "David".
 * For identifier-shaped strings (names, addresses) we use case-insensitive
 * word-boundary matching so:
 *   - "Jones" doesn't fire inside "Jonesborough"
 *   - "jones" (lowercased prompt) still tokenizes
 *   - "Jones's slip" matches (the boundary fires before the apostrophe)
 *
 * For PII shapes that contain punctuation (emails, phones), we fall
 * back to literal substring replacement.
 */
export function tokenize(input: string, map: TokenizationMap): string {
  if (!input) return input;
  // Sort keys longest-first so "David Emmons" wins over "David".
  const keys = Array.from(map.reverse.keys()).sort(
    (a, b) => b.length - a.length,
  );
  let out = input;
  for (const real of keys) {
    const token = map.reverse.get(real)!;
    if (shouldUseWordBoundary(real)) {
      // Case-insensitive word-boundary match. The (?:'s)? optional suffix
      // catches the possessive form "Jones's" without trailing the 's
      // into the handle. The boundary on the left side is `\b`; on the
      // right we use a lookahead for non-letter-or-digit OR end-of-string.
      const pattern = new RegExp(
        `\\b${escapeRegex(real)}(?:'s)?\\b`,
        "gi",
      );
      out = out.replace(pattern, token);
    } else {
      // Literal substring replace. Used for emails / phones / VINs /
      // registrations where the punctuation breaks word boundaries.
      out = out.split(real).join(token);
    }
  }
  return out;
}

/**
 * Inverse — replace `<<KIND_id>>` handles with the real values. Anything
 * the LLM didn't echo from the input gets left as-is. Idempotent — safe
 * to apply to already-detokenized text.
 *
 * Tolerates BOTH the new `<<KIND_id>>` format AND the legacy `{{kind_id}}`
 * format for any messages-in-flight during the rollout. Once Phase 6
 * audit-log scrubbing is done we can drop the legacy branch.
 */
export function detokenize(input: string, map: TokenizationMap): string {
  if (!input) return input;
  let out = input;
  for (const [token, real] of map.forward) {
    out = out.split(token).join(real);
  }
  return out;
}

/**
 * Same as detokenize but for tool inputs (JSON-shaped). The walker
 * discriminates between IDENTITY field slots and CONTENT field slots
 * by key name — critical because the same `<<BOATER_b_42>>` handle
 * must resolve to different things depending on context:
 *
 *   - In an identity slot (`boater_query`, `boater_id`, …) →  "b_42"
 *     so the existing fuzzy resolvers find the entity directly.
 *   - In a content slot (`body`, `subject`, `description`, …) →
 *     the boater's real display name, so `send_message({ body:
 *     "Hi <<BOATER_b_42>>, your card on file is..." })` becomes
 *     `body: "Hi David Emmons, your card on file is..."` BEFORE the
 *     message is persisted + dispatched.
 *
 * Previously (pre-F5 fix) detokenizeString discriminated only by
 * handle KIND and always returned the raw id for BOATER/VESSEL/
 * LASTNAME — silently breaking every message-body that contained a
 * boater handle, leaving the recipient with `Hi b_42`.
 *
 * Nested objects are walked recursively. Field-name matching is
 * substring-based so `nested.boater_id` and `payload.body_markdown`
 * both route correctly.
 */
const IDENTITY_KEY_SUFFIXES = [
  "_id",
  "_query",
  "_ids",
  "_uuid",
  "_handle",
  "boater_id",
  "vessel_id",
  "slip_id",
];
const CONTENT_KEY_SUFFIXES = [
  "body",
  "body_full",
  "body_preview",
  "subject",
  "description",
  "notes",
  "message",
  "content",
  "text",
  "summary",
  "internal_notes",
];

function isIdentityKey(key: string): boolean {
  const lower = key.toLowerCase();
  return IDENTITY_KEY_SUFFIXES.some((s) => lower === s || lower.endsWith(s));
}
function isContentKey(key: string): boolean {
  const lower = key.toLowerCase();
  return CONTENT_KEY_SUFFIXES.some((s) => lower === s || lower.endsWith(s));
}

export function detokenizeToolInput(
  input: Record<string, unknown>,
  map: TokenizationMap,
): Record<string, unknown> {
  return detokenizeValue(input, map, "content") as Record<string, unknown>;
}

type DetokMode = "identity" | "content";

function detokenizeValue(
  value: unknown,
  map: TokenizationMap,
  mode: DetokMode,
): unknown {
  if (typeof value === "string") return detokenizeString(value, map, mode);
  if (Array.isArray(value)) return value.map((v) => detokenizeValue(v, map, mode));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Per-key mode: identity keys flip to id-emit, content keys flip
      // to real-string-emit. Unknown keys inherit the parent's mode
      // (defaults to "content" at the top level so message bodies in
      // unfamiliar tool shapes still get human-readable names).
      const childMode: DetokMode = isIdentityKey(k)
        ? "identity"
        : isContentKey(k)
          ? "content"
          : mode;
      out[k] = detokenizeValue(v, map, childMode);
    }
    return out;
  }
  return value;
}

// Matches BOTH the new <<KIND_id>> and the legacy {{kind_id}} forms so
// in-flight messages during a rollout don't get mangled.
const HANDLE_PATTERN = /<<([A-Z]+)_([\w-]+)>>|\{\{([a-z]+)_([\w-]+)\}\}/g;

function detokenizeString(
  value: string,
  map: TokenizationMap,
  mode: DetokMode = "content",
): string {
  return value.replace(HANDLE_PATTERN, (full, newKind, newId, oldKind, oldId) => {
    const kindRaw = (newKind ?? oldKind) as string;
    const id = (newId ?? oldId) as string;
    const kind = kindRaw.toLowerCase();
    const real = map.forward.get(full);
    const isIdentityKind =
      kind === "boater" ||
      kind === "vessel" ||
      kind === "lastname" ||
      kind === "vin" ||
      kind === "reg";
    if (mode === "identity" && isIdentityKind) {
      // Identity slot — emit the underlying id so the receiver can
      // fetch the entity directly. Works even if `full` wasn't in the
      // map (Claude minted a plausible-looking handle for a boater we
      // never tokenized) since the id portion of the handle IS the id.
      return id;
    }
    // Content slot OR content-kind handle (EMAIL/PHONE/ADDR) — emit
    // the real value. If we don't have the mapping (handle leaked
    // through), leave the handle intact so the operator sees the
    // failure rather than a confusing partial substitution.
    return real ?? (isIdentityKind ? id : full);
  });
}

/**
 * Helper for tokenizing the system-prompt context block in /api/agent.
 * Same as `tokenize` but kept as a named export for callsite clarity —
 * the context block is a tenant-wide snapshot that's safe to eagerly
 * tokenize against the full BOATERS list.
 *
 * Worth noting: the context block lists every boater by name AND id, so
 * after tokenization a typical row becomes
 *   "  - <<BOATER_b_42>> (id=b_42, code=DSM A29, ...)"
 *
 * Claude sees the id appears twice (once inside the handle, once in the
 * bare `id=` field). That's intentional — when Claude proposes a tool
 * with `boater_query: "<<BOATER_b_42>>"`, detokenizeToolInput strips it
 * to "b_42" which exactly matches the bare id form, so the existing
 * resolver finds it without extra logic.
 */
export function tokenizeContextBlock(
  block: string,
  map: TokenizationMap,
): string {
  return tokenize(block, map);
}

// ────────────────────────────────────────────────────────────
// Lazy per-request tokenizer
// ────────────────────────────────────────────────────────────

/**
 * Source-of-truth for PII used by the lazy tokenizer. The route hands
 * this in pre-loaded — typically the tenant-scoped BOATERS + VESSELS
 * snapshot. When Convex is live, the route will swap this for
 * `ctx.db.query("boaters").collect()`.
 */
export interface LazyTokenizerSource {
  boaters: Pick<
    Boater,
    | "id"
    | "display_name"
    | "first_name"
    | "last_name"
    | "primary_contact"
    | "address"
  >[];
  vessels: Pick<Vessel, "id" | "name" | "hull_vin" | "registration">[];
}

export interface LazyTokenizer {
  /**
   * Walk the input and replace any PII the source recognizes. Same input
   * PII → same handle within the lifetime of this tokenizer.
   */
  tokenize(text: string): string;
  /**
   * Replace handles emitted earlier with their real values.
   */
  detokenize(text: string): string;
  /**
   * Detokenize a structured tool input (handles + nested objects).
   */
  detokenizeToolInput(input: Record<string, unknown>): Record<string, unknown>;
  /**
   * Combined map for compatibility with the existing eager-API callsites.
   */
  map(): TokenizationMap;
}

/**
 * Build a per-request lazy tokenizer.
 *
 * Unlike `buildTokenizationMap`, this does NOT pre-emit handles for
 * every boater. Instead, the eager map is built once (so the regex
 * pattern set is ready), but the lazy interface is what the route
 * uses: a single shared map that grows as tokenize() encounters PII.
 *
 * In practice, this is the SAME object as buildTokenizationMap returns
 * — the laziness comes from the FACT THAT the route only calls
 * `tokenize()` on the user prompt + context block (not on every boater
 * row individually). Any handle that doesn't appear in the inputs
 * simply never lands in Anthropic's request.
 */
export function createTokenizer(source: LazyTokenizerSource): LazyTokenizer {
  const built = buildTokenizationMap({
    boaters: source.boaters as Boater[],
    vessels: source.vessels as Vessel[],
  });
  return {
    tokenize: (text) => tokenize(text, built),
    detokenize: (text) => detokenize(text, built),
    detokenizeToolInput: (input) => detokenizeToolInput(input, built),
    map: () => built,
  };
}
