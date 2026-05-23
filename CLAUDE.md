@AGENTS.md
@../CLAUDE.md

# Marina Stee — Project-Level Overrides

This project inherits the global stack and code conventions from `~/Desktop/Claude/CLAUDE.md`. Where Marina Stee deviates, those choices are deliberate and listed below.

## Deliberate departures from global CLAUDE.md

| Area | Global default | Marina Stee | Why |
|---|---|---|---|
| Framework | React + Express two-tier | **Next.js 16 (App Router)** | Server actions + RSC + streaming fit the agentic UX |
| Styling config | Tailwind v3 | **Tailwind v4** (CSS `@theme`) | Came with Next 16 scaffold; no `tailwind.config.ts` |
| Folder structure | `/src/components/`, `/src/pages/` | `/components/`, `/app/` at root | App Router convention |
| Component library | shadcn/ui via CLI | **Hand-rolled shadcn pattern** (Radix + cva + cn in `/components/ui/*`) | Tailwind v4 + React 19 + Next 16 had CLI friction at scaffold time |
| Backend | Express + Postgres now | **Not yet built — frontend-only mock data** | Will follow CLAUDE.md to the letter when added |

## Marina Stee-specific conventions (additive)

- **Design tokens** live in `app/globals.css` as CSS variables on `:root` + `.dark`, then re-exported via `@theme inline` so Tailwind generates utilities (`bg-surface-1`, `text-fg-muted`, `border-hairline`, etc.). Always use these tokens — never raw hex or Tailwind gray scales.
- **Status colors**: `--status-ok` / `--status-warn` / `--status-danger` / `--status-info` are operational signal, not decoration. Use them for occupancy, payment status, anomalies, etc.
- **Agentic UX is the primary surface**, point-and-click is fallback. Every list page has an agent search/create input; every detail page has a contextual agent rail or "Ask →" link.
- **Cross-entity connections must be visible inline** — never hidden behind a click chain. A Work Order shows its boater, vessel, slip, ledger entries, and comms on the same page.
- **Inline `style={{}}` is allowed** only for runtime-computed continuous values (progress bar widths, gauge fills) that Tailwind can't express cleanly.

## When adding the backend

Follow `~/Desktop/Claude/CLAUDE.md` strictly:
- Express + Postgres + `pg`, session-based auth
- `/routes/`, `/middleware/`, parameterized queries only
- `/migrations/` numbered SQL files, FK + indexes explicit
- Every table has `created_at` + `updated_at` (`DEFAULT NOW()`)
- `helmet`, CORS explicit, bcrypt 12+ rounds, input sanitization
- JSON response shape `{ success, data | error }`
- Correct HTTP status codes (200/201/400/401/403/404/500)
