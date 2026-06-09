/*
 * Shared boater lookup — id → last name → first name → slip code.
 *
 * Lives in its own module (NOT "use client") so both server-side tool
 * resolvers (lib/agent-tools/*.ts) and client-side resolvers
 * (lib/agent-fetch.ts) can import it without poisoning the Next.js
 * client/server boundary.
 *
 * Inline copies of this pattern existed in agent-fetch.ts (5 sites)
 * and schedule-reminder.ts before consolidation; new agent tools
 * should always import from here.
 */

import { BOATERS } from "@/lib/mock-data";
import type { Boater } from "@/lib/types";

/**
 * Fuzzy lookup. Tries:
 *   1. exact id match (when a server tool pre-resolved the id),
 *   2. last name substring,
 *   3. first name substring,
 *   4. slip code substring.
 * Returns undefined when nothing matches.
 */
export function findBoaterFuzzy(q: string): Boater | undefined {
  if (!q) return undefined;
  const byId = BOATERS.find((b) => b.id === q);
  if (byId) return byId;
  const t = q.toLowerCase();
  return (
    BOATERS.find((b) => t.includes(b.last_name.toLowerCase())) ??
    BOATERS.find((b) => t.includes(b.first_name.toLowerCase())) ??
    BOATERS.find((b) => b.code && t.includes(b.code.toLowerCase()))
  );
}

/**
 * id → Boater map across the whole BOATERS array. Use when a hot path
 * needs to do many id lookups in a single pass — beats N × .find()
 * which is O(n²) at scale.
 *
 * Module-level memo because BOATERS is a const array in the mock-data
 * world. When Convex lands and BOATERS becomes a live hook-backed
 * slice, this helper switches to building the Map per call (still O(n)
 * — only O(n²) is the win to preserve).
 *
 * Callers should NOT mutate the returned Map.
 */
let _boaterByIdMap: Map<string, Boater> | null = null;
export function boaterByIdMap(): Map<string, Boater> {
  if (_boaterByIdMap) return _boaterByIdMap;
  _boaterByIdMap = new Map(BOATERS.map((b) => [b.id, b]));
  return _boaterByIdMap;
}
