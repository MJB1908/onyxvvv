# PRM v1 → v2 changelog

Drop-in replacements for the two files. No API changes — `window.prmApp.mount(container, { snapshot, seller })` still returns state with the same shape, so the `app.js` patch from v1 still applies untouched.

## Sizes

|                | v1   | v2   | Δ     |
|----------------|------|------|-------|
| `prm-app.js`   | 663  | 1290 | +627  |
| `prm-app.css`  | 153  | 273  | +120  |

## What's new

### 1. Quick Note modal
- `+ Note` button in the partner header → opens top-right popup
- Customer dropdown auto-populated from the unique `registration` values across the partner's keys (capped at 100). Picking a customer prepends `Customer: ` to the subject — same UX as the original PRM.
- Fields: type select, subject, customer dropdown, body. Posts to existing `/api/notes` with `source: "onyx-prm"`.
- ESC key + click-on-backdrop both close the modal.
- Modal markup is part of the `.prm-app` shell (rendered once on `mount`, reused for every partner).

### 2. Sidebar agent chips
- New `state.filters.agent` field
- New chip group ("Account owner") below the Level chips, hidden when no agents exist
- Built dynamically from the loaded partner list, sorted by count descending
- Chip label uses first-name-only via `shortAgentName()` (full name in the `title` attribute on hover)
- Filter is composable with the level filter — both apply

### 3. Cert badges in sidebar partner rows
- Small uppercase mini-pill (TIT/PLA/GLD/SLV/BRO) next to the partner ID
- Colour-coded to the same tier palette as the partner-header tier badge
- Sourced from `distributorLevel` (onyxvvv has no separate cert field; the abbreviation gives the row the same info-density as the original PRM had with its dedicated Cert column)

### 4. Overview — 3-column layout
- `grid-template-columns: 260px 1fr 300px` on the overview, collapses to 2 cols ≤1180px and 1 col ≤780px (media queries)
- Left column: Install Mix card → KPI grid → Renewal Radar
- Center column: New Activations table → Upcoming Renewals table → Recent Notes
- Right column: Communication log (uses `snapshot.calls` filtered by `partnerId`, with sentiment pill)

### 5. New Activations table (last 30 days)
- Filters live keys whose synthetic `activatedOn` (= `hostingExpires` − 12 months) falls within 30 days of today
- Columns: Customer, License (edition + SC tag), Version, Activated, Status (Active/Soon/Urgent/Overdue tag)

### 6. Upcoming Renewals table (91–180 day window)
- Live keys whose expiry is in the 91–180 day band — i.e. coming up but not yet on the radar
- Columns: Customer, Current product, Expiry (highlighted amber), Version, Status

### 7. Largest / Average extensions
- New mini-block at the bottom of the Install Mix card
- Computed from the `primaryLicenseSc` field across live keys (used as `maxExt` in the view-shape)
- Two stats side-by-side with a top border separating from the mix bars

### 8. Notes filter chips
- New `state.noteFilters = { type: '', poster: '' }`
- Two chip groups (Type, Poster) above the timeline, only shown when the partner has notes
- Filters apply via `style.display = ''/none` on existing cards — no full re-render, faster on larger note timelines
- Posters list only shown when there's more than one poster

### 9. Keys: Renewal Radar section + Ext badge + retired tag
- New section at the top of the Keys tab listing the same keyRow as the main table, but filtered to expiring-within-90-days only (sorted by daysLeft asc)
- Main table now shows SC + Ext side-by-side: green SC pill (`16SC`) + dim "X ext" (`16 ext`) for visual parity with the original
- Retired (license-expired) keys get a `retired` mini-tag inline next to the key id, plus 55% opacity on the row
- "X total · Y live · Z retired" summary in section header when retired keys exist

### 10. Orders: license-key chips + currency totals
- Per-row `prm-order-key-chip` boxes mapped from keys to orders by date proximity (±14 days, configurable via `MATCH_WINDOW_DAYS`). Each chip is a clickable link to `staff.3cx.com/key/edit.aspx`.
- Each chip has an edition-coloured prefix (ENT/PRO/STD/SMB) — matches the original visual signature of the PRM orders tab
- Section count line now shows: total orders · paid count · Σ totals by currency · X/Y matched-to-keys (Z%)
- Match rate metric exposes how good the date-matching heuristic is on the current dataset — useful for tuning when wired to live ERP

## Caveats / gaps still open

- **Date matching is approximate** because onyxvvv mock keys don't carry a real purchase date. The synthetic `activatedOn = hostingExpires − 12 months` works for the visualisation but match rates against orders will be lower than what live staff.3cx.com data would yield. When you wire the live ERP, swap `viewKey()`'s `purchased`/`activatedOn` derivation to the real field — everything else stays as-is.
- **Communication Log** uses `snapshot.calls`, not Gmail. The original PRM pulled from a Google Sheet of Gmail classifications — not the same data source. If you want email-level comms, add an `/api/emails?partnerId=` filter and a second renderer in the right column.
- **Users tab** still empty — no per-partner user feed exists in onyxvvv's data shape. Add it to `snapshotStore` first, then a renderer is ~50 lines.
- The original PRM also has Discounts (P/M/H), Sage ID, Support PIN pills in the pills row. None of these are in onyxvvv's partner shape, so they're omitted rather than faked.

## Patches still apply unchanged

The `patches/PATCHES.md` from v1 is unchanged. Both v2 files are pure drop-in replacements at the same paths (`public/prm-app.css`, `public/prm-app.js`).
