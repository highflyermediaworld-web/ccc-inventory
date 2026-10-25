# CCC Inventory

Card Collector's Companion — an inventory, marketplace, and pricing app for trading-card collectors. Track sealed product, raw singles, and graded slabs across Pokémon, One Piece, Magic: The Gathering, DBZ, League of Legends, and Union Arena. Scan cards with your camera, pull live prices from Scryfall / TCGdex, list items on an internal marketplace, propose trades, and export everything to Excel.

## Tech stack

- **Frontend:** React 18, Vite, Tailwind CSS, shadcn/ui, wouter, TanStack Query
- **Backend:** Express 5, TypeScript, Drizzle ORM
- **Database:** Turso (libSQL) in production, local SQLite file in dev
- **AI:** Anthropic Claude (Sonnet) for card identification, barcode/QR extraction, search suggestions, and price fallback
- **Live pricing:** Scryfall (MTG), TCGdex (Pokémon)

## Local development

```bash
npm install
npm run dev
```

### Required env var

- `ANTHROPIC_API_KEY` — your Anthropic key (for scan + AI price fallback)

`TURSO_DATABASE_URL` is **optional** locally. If unset, the app falls back to a local SQLite file at `./data.db`. If you want to point local dev at Turso, set both `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

Create a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
# Optional — use Turso locally instead of ./data.db
# TURSO_DATABASE_URL=libsql://your-db.turso.io
# TURSO_AUTH_TOKEN=...
```

The server listens on port 5000 (configurable via `PORT`).

## Deploy to Render

1. **Create a Turso database**

   ```bash
   turso db create ccc-inventory
   turso db show ccc-inventory --url          # copy the libsql:// URL
   turso db tokens create ccc-inventory       # copy the auth token
   ```

2. **Push this repo to GitHub** (or fork it into your account).

3. **In Render:** New → Blueprint → point it at the repo. Render reads `render.yaml` and creates a web service + 1 GB persistent disk for scan uploads.

4. **Paste the secrets** when Render prompts:

   - `TURSO_DATABASE_URL` — the libsql:// URL from step 1
   - `TURSO_AUTH_TOKEN` — the token from step 1
   - `ANTHROPIC_API_KEY` — your Anthropic API key
   - `ADMIN_INVITE_CODE` — a secret code required for new admin sign-ups (set any hard-to-guess string)
   - `ADMIN_INITIAL_USERNAME` — username for the bootstrap admin (e.g. `chris`). Only used on first boot when no users exist; **delete this var after you've signed in once** as a best practice.
   - `ADMIN_INITIAL_PASSWORD` — password for the bootstrap admin. **Delete this var after first sign-in.**

5. **Deploy.** First boot runs migrations, seeds the demo inventory + mock marketplace listings + mock incoming trades, and (if `ADMIN_INITIAL_USERNAME`/`ADMIN_INITIAL_PASSWORD` are set) creates your bootstrap admin account.

## Authentication

- The customer shop at `/` is public — anyone can browse and submit Buy/Trade requests.
- Every admin page (`/admin`, `/admin/inventory`, `/admin/scan`, `/admin/marketplace`, `/admin/trades`, `/admin/transactions`, `/admin/requests`) requires sign-in.
- Sessions last 24 hours and are stored in the `sessions` table.
- To invite an additional admin, share your `ADMIN_INVITE_CODE` — they sign up at `/signup`.
- To rotate the invite code, update the env var in Render; existing admins keep their accounts.

## Features

- **Inventory** — Add, edit, delete, bulk-import (Excel), status tracking (In Inventory / Listed / Sold / Traded), per-item price history charts
- **Scan** — Single-image, bulk, and barcode/QR (UPC + slab QR URL) card identification using Claude vision
- **Marketplace** — Create listings from your inventory, browse mock seller listings, Buy Now to acquire new SKUs
- **Trades** — Propose outgoing trades against marketplace listings; accept/decline incoming trade offers
- **Transactions** — Full ledger of buys, sells, and trades with realized P/L
- **Pricing** — Per-item refresh and bulk "Refresh all" from Scryfall (MTG), TCGdex (Pokémon), with Claude fallback for other franchises. 1-hour in-memory cache and throttling.
- **History** — Price history sparkline on every item, sourced from each successful refresh
- **Exports** — XLSX export of inventory and transactions
- **Storefront About page** — Admin → Storefront → About page edits the hero, story, photo, quick facts, values and closing call-out shown at `#/about`. Copy is stored in `app_settings` (`shop_about`); the photo is saved to `uploads/about/` on the persistent disk.
- **Ask CPulls chat** — Floating assistant on the Shop, FAQ and About pages (`POST /api/shop/chat`). Answers are grounded in the FAQ, About story, published shows and live inventory, using the same AI key as the scanner. Rate-limited per IP; when no provider is reachable the widget says it is offline and points to the shop's DMs.

## Notes

- Secrets are never committed — `render.yaml` uses `sync: false` placeholders and real values live only in the Render dashboard.
- The `uploads/` directory holds scan photos and is mounted as a persistent disk on Render, so user-uploaded images survive redeploys.
