"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * <ContractMarkdown> — single renderer for contract bodies across the app.
 *
 * Consolidates two earlier renderers (one in `components/onboard/
 * onboard-experience.tsx`, one in `components/contracts/contract-preview-
 * sheet.tsx`) that both shipped subtly different bugs:
 *   - The preview-sheet renderer split on blank lines first, then treated
 *     each block as its own list — so a 30-clause contract with blank
 *     lines between clauses (standard markdown) became 30 separate <ol>s
 *     each numbering "1.", "1.", "1.", …
 *   - The onboard renderer closed the list on every blank line for the
 *     same reason, and emitted HTML via dangerouslySetInnerHTML.
 *
 * This component:
 *   - Goes line-by-line so blank-lines-inside-a-list don't break numbering
 *   - Emits an <ol start="N"> when the author wrote an explicit number
 *     (so "1. First", blank, "2. Second" renders 1, 2 — and "30.
 *     ASSIGNABILITY" after a non-list paragraph correctly restarts at 30,
 *     not 1)
 *   - Emits real React (no dangerouslySetInnerHTML)
 *   - Handles **bold**, *italic*, `code` inline
 *
 * Two visual variants:
 *   - "preview" (default) — large, document-like hierarchy. Used by the
 *     operator's Contract Preview Sheet (full-width preview pane).
 *   - "compact" — tighter sizing for in-page embeds. Used by the
 *     onboarding /onboard/[token] holder view where the contract sits
 *     inside a constrained card.
 *
 * Subset of CommonMark — enough for contract templates without pulling
 * in a full markdown lib. Headings (# ## ###), ordered + unordered
 * lists, paragraphs, horizontal rules, blockquotes (>), bold/italic/code.
 */

export type ContractMarkdownVariant = "preview" | "compact";

type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "hr" }
  | { kind: "ol"; start: number; items: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "p"; lines: string[] }
  | { kind: "quote"; lines: string[] };

/**
 * Parse a markdown body into a list of blocks. Exported for tests and
 * for any caller that wants to inspect structure (e.g. a future "skip
 * to clause N" outline).
 */
export function parseContractMarkdown(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];

  let current: Block | null = null;
  let lastOrderedNumber = 0;

  function flush() {
    if (current) {
      blocks.push(current);
      current = null;
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    // Heading
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);
    if (h1 || h2 || h3) {
      flush();
      const text = (h3 ?? h2 ?? h1)![1];
      blocks.push({ kind: h3 ? "h3" : h2 ? "h2" : "h1", text });
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      flush();
      blocks.push({ kind: "hr" });
      continue;
    }

    // Ordered list item — preserve the explicit number on the FIRST
    // item of each <ol>, then track increments so we can split into a
    // new <ol start="N"> when the author skips numbers.
    const olMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (olMatch) {
      const number = parseInt(olMatch[1], 10);
      const text = olMatch[2];
      if (
        current &&
        current.kind === "ol" &&
        number === lastOrderedNumber + 1
      ) {
        current.items.push(text);
        lastOrderedNumber = number;
      } else {
        flush();
        current = { kind: "ol", start: number, items: [text] };
        lastOrderedNumber = number;
      }
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^[-*]\s+(.*)/);
    if (ulMatch) {
      if (current && current.kind === "ul") {
        current.items.push(ulMatch[1]);
      } else {
        flush();
        current = { kind: "ul", items: [ulMatch[1]] };
      }
      continue;
    }

    // Blockquote
    const quoteMatch = line.match(/^>\s?(.*)/);
    if (quoteMatch) {
      if (current && current.kind === "quote") {
        current.lines.push(quoteMatch[1]);
      } else {
        flush();
        current = { kind: "quote", lines: [quoteMatch[1]] };
      }
      continue;
    }

    // Blank line — closes paragraph + quote blocks, but NOT lists
    // (loose-list semantics: a blank between two numbered items is
    // expected in standard markdown and should not split the list).
    if (line.trim() === "") {
      if (current && (current.kind === "p" || current.kind === "quote")) {
        flush();
      }
      // For lists, just continue — the next list line extends the list.
      continue;
    }

    // Regular paragraph line — also ends any open list, since a
    // non-list non-blank line terminates loose-list mode.
    if (current && current.kind === "p") {
      current.lines.push(line);
    } else {
      flush();
      current = { kind: "p", lines: [line] };
    }
  }

  flush();
  return blocks;
}

/**
 * Inline markdown — bold (**x**), italic (*x* / _x_), code (`x`).
 * Order matters: bold first so `**foo**` doesn't get treated as italic.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode {
  // Tokenize into runs of [literal | **bold** | *italic* | _italic_ | `code`]
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g);
  return tokens.map((t, i) => {
    if (!t) return null;
    const key = `${keyPrefix}-${i}`;
    if (t.startsWith("**") && t.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-fg">
          {t.slice(2, -2)}
        </strong>
      );
    }
    if (t.startsWith("`") && t.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded bg-surface-2 px-1 py-0.5 text-[0.92em] text-fg"
        >
          {t.slice(1, -1)}
        </code>
      );
    }
    if (
      (t.startsWith("*") && t.endsWith("*")) ||
      (t.startsWith("_") && t.endsWith("_"))
    ) {
      return (
        <em key={key} className="italic">
          {t.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={key}>{t}</React.Fragment>;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Variant style maps
// ─────────────────────────────────────────────────────────────────────

const STYLES: Record<
  ContractMarkdownVariant,
  {
    root: string;
    h1: string;
    h2: string;
    h3: string;
    hr: string;
    ol: string;
    ul: string;
    li: string;
    p: string;
    quote: string;
  }
> = {
  preview: {
    root: "text-[13.5px] leading-relaxed text-fg-muted",
    h1: "text-[22px] font-semibold text-fg mt-6 mb-3 display-tight",
    h2: "text-[17px] font-semibold text-fg mt-5 mb-2 display-tight",
    h3: "text-[14px] font-semibold text-fg mt-4 mb-1.5",
    hr: "my-6 border-t border-hairline",
    ol: "my-3 ml-5 list-decimal space-y-1.5",
    ul: "my-3 ml-5 list-disc space-y-1",
    li: "pl-1",
    p: "my-2",
    quote:
      "my-3 border-l-2 border-hairline pl-3 italic text-fg-subtle",
  },
  compact: {
    root: "text-[13px] leading-relaxed text-fg",
    h1: "text-[15px] font-semibold text-fg mt-4 mb-2",
    h2: "text-[14px] font-semibold text-fg mt-3 mb-1.5",
    h3: "text-[13px] font-semibold text-fg mt-2.5 mb-1",
    hr: "my-4 border-t border-hairline",
    ol: "my-2 ml-4 list-decimal space-y-1",
    ul: "my-2 ml-4 list-disc space-y-1",
    li: "",
    p: "my-1.5 leading-relaxed",
    quote: "my-2 border-l-2 border-hairline pl-3 italic text-fg-subtle",
  },
};

export function ContractMarkdown({
  body,
  variant = "preview",
  className,
}: {
  body: string;
  variant?: ContractMarkdownVariant;
  className?: string;
}) {
  const blocks = React.useMemo(() => parseContractMarkdown(body), [body]);
  const s = STYLES[variant];
  return (
    <div className={cn(s.root, className)}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case "h1":
            return (
              <h1 key={k} className={s.h1}>
                {renderInline(b.text, k)}
              </h1>
            );
          case "h2":
            return (
              <h2 key={k} className={s.h2}>
                {renderInline(b.text, k)}
              </h2>
            );
          case "h3":
            return (
              <h3 key={k} className={s.h3}>
                {renderInline(b.text, k)}
              </h3>
            );
          case "hr":
            return <hr key={k} className={s.hr} />;
          case "ol":
            return (
              <ol key={k} start={b.start} className={s.ol}>
                {b.items.map((it, j) => (
                  <li key={`${k}-li${j}`} className={s.li}>
                    {renderInline(it, `${k}-li${j}`)}
                  </li>
                ))}
              </ol>
            );
          case "ul":
            return (
              <ul key={k} className={s.ul}>
                {b.items.map((it, j) => (
                  <li key={`${k}-li${j}`} className={s.li}>
                    {renderInline(it, `${k}-li${j}`)}
                  </li>
                ))}
              </ul>
            );
          case "p":
            return (
              <p key={k} className={s.p}>
                {b.lines.map((line, j, arr) => (
                  <React.Fragment key={`${k}-l${j}`}>
                    {renderInline(line, `${k}-l${j}`)}
                    {j < arr.length - 1 && <br />}
                  </React.Fragment>
                ))}
              </p>
            );
          case "quote":
            return (
              <blockquote key={k} className={s.quote}>
                {b.lines.map((line, j, arr) => (
                  <React.Fragment key={`${k}-l${j}`}>
                    {renderInline(line, `${k}-l${j}`)}
                    {j < arr.length - 1 && <br />}
                  </React.Fragment>
                ))}
              </blockquote>
            );
        }
      })}
    </div>
  );
}
