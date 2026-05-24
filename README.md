# Marina Stee

Agent-native marina management — built to undercut Dockwa/Molo/Marinaware by putting natural-language operations at the front of the product, with point-and-click as fallback.

Status: **UI shell complete + simulated agent working end-to-end**. No backend yet — every entity lives in `lib/mock-data.ts` and mutations route through an in-memory client store. The agent surface optionally talks to Anthropic when an API key is configured.

---

## Quickstart

```bash
npm install
cp .env.example .env.local       # optional — add ANTHROPIC_API_KEY for real Claude
npm run dev                       # http://localhost:3000
```

Production build:

```bash
npm run build
npm start
```

---

## What's in the app

### Admin (sidebar)

| Route | Purpose |
|---|---|
| `/` | Dashboard — agent-forward hero + live KPIs + cross-platform activity feed |
| `/rentals` | Visual dock map + 7 sub-routes (spaces / rates / fees / gas / meters / contracts) |
| `/boaters` | Boater list with unified search/create input |
| `/boaters/[id]` | 5-tab detail (Overview / Vessels & Slips / Financials / Work Orders / Comms) |
| `/reservations` | Today's arrivals + departures + upcoming queue |
| `/work-orders` | Kanban (Open / Scheduled / In-Progress / Done) with quote + signature + payment flow |
| `/work-orders/[id]` | Full WO with editable quote builder, signature panel, payment, linked entities |
| `/ledger` | POS terminal + Orders + A/R aging + **QuickBooks Sync** tab |
| `/settings` | Marina identity / staff / payment processors / MCP connections |

### Dockhand mobile (PWA)

| Route | Purpose |
|---|---|
| `/dock` | Mobile-first dockhand surface — check in/out, log meter, quick fuel sale |

**Install on iPhone/iPad:** open `/dock` in Safari → Share → **Add to Home Screen**. Launches in standalone mode (no browser chrome), uses the Marina Stee app icon, and propagates every action back to admin in real time via the shared client store.

PWA basics live in `app/manifest.ts`, `app/icon.tsx`, `app/apple-icon.tsx`, and `public/sw.js`. Service worker only activates in production builds. See the `reference-marina-stee-pwa-and-ios` memory note for the iOS-native path (Capacitor wrap) when it's time.

### Boater portal (no admin chrome)

| Route | Purpose |
|---|---|
| `/sign` | Demo index of tokenized quotes |
| `/sign/[token]` | Public signing experience — quote review → signature canvas → payment method → done |

### API

| Route | Purpose |
|---|---|
| `POST /api/agent` | Real Claude streaming when `ANTHROPIC_API_KEY` is set; otherwise returns 503 and the client falls back to the simulated agent |

---

## The agent

Two layers stacked:

1. **Simulated agent** (`lib/simulated-agent.ts`) — deterministic intent matcher with text-stream output + structured action proposals. Recognizes: balance queries, slip availability, charge-to-account, meter anomalies, contract expiry, work orders, fuel summary. Actions execute against the client store.

2. **Real Claude** (`app/api/agent/route.ts`) — when `ANTHROPIC_API_KEY` is set, streams text from `claude-sonnet-4-5`. The action-detection layer stays on the simulated/deterministic side, so executable actions remain auditable regardless of which model produced the narration.

Drop your API key in `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

…and restart the dev server. The agent surface now narrates with Claude. No code change needed.

---

## Cross-platform connections (the live demo loop)

Every mutation propagates through the client store (`lib/client-store.ts`, `useSyncExternalStore` based):

1. Type "Charge a hoist fee to David Emmons" in the dashboard hero
2. Agent recognizes the intent, drafts the charge, shows an approval card
3. Click **Approve** →
   - PosOrder created (Harbormaster, charge-to-account)
   - LedgerEntry invoice posted to David's account
   - Communication auto-receipt sent via David's preferred channel (SMS)
   - All three marked `qb_sync_status: pending`
4. **Without reloading**, this all updates live:
   - Dashboard "Open ledger balance" KPI
   - Dashboard activity feed
   - Boater identity bar balance pill
   - Boater Financials transaction history (clickable → drawer)
   - Boater Comms tab (new receipt)
   - POS Orders tab (new row with QB pending badge)
   - POS A/R aging
   - POS QuickBooks Sync tab pending batch

---

## Stack

- **Next.js 16.2** App Router (Turbopack default)
- **React 19**
- **Tailwind v4** — CSS-based `@theme` (no `tailwind.config.ts`)
- **TypeScript 5**
- **Radix UI** primitives (Dialog, Tabs, Tooltip, Avatar, Popover, Slot)
- **lucide-react** icons
- **next-themes** for light/dark
- **@anthropic-ai/sdk** for the optional Claude integration

Design tokens live in `app/globals.css` as CSS variables on `:root` + `.dark` — adapted from the Linear pattern in `VoltAgent/awesome-design-md` (see `~/Desktop/Claude/master-reference.md`).

See `CLAUDE.md` in this repo for project-specific conventions and deliberate departures from the global `~/Desktop/Claude/CLAUDE.md`.

---

## Deploy

### Vercel (recommended)

```bash
npx vercel
```

Set `ANTHROPIC_API_KEY` in the Vercel dashboard → Settings → Environment Variables. The agent activates automatically.

### Netlify

```bash
npx netlify deploy --build
```

The `@netlify/plugin-nextjs` package handles App Router routing including the streaming `/api/agent` route.

### Self-hosted (per CLAUDE.md global defaults)

```bash
npm run build
pm2 start "npm start" --name marina-stee
```

Reverse-proxy via nginx; same Node 20.9+ runtime required.

---

## Next milestones

- **Real backend** per `~/Desktop/Claude/CLAUDE.md` — Express + Postgres + parameterized queries + session auth. Mock data layer maps cleanly onto a schema.
- **Settings → QuickBooks deep-config** — GL mapping table + SKU → QB Item mapping UI
- **Claude tool use** — return executable actions from Claude's response (currently extracted deterministically on the client)
- **Patron promotion** — agent suggests upgrading walk-ins with N visits to full Boaters
- **Mobile / dockhand-first views** — work order checkin, meter reading capture
