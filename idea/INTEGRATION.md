# onyxvvv ← 3cx-prm dashboard + Sales plugin integration

Two changes, one branch:

## A) Embed the 3cx-prm dashboard inside the SPA shell (approach 3)

The PRM dashboard becomes a hash-routed view (`#/prm`) inside `unified.html`, sharing the existing seller selector, snapshot store, and `/api/*` endpoints. Nothing duplicated, no new top-level page.

**Files added**
- `public/prm-app.css` — all PRM styles, scoped under `.prm-app` so they don't collide with `styles.css` / `design-system.css`
- `public/prm-app.js` — self-contained PRM controller: `mount(container, { snapshot, seller })`. No globals. Renders sidebar list, partner header, six tabs, AI bar.

**Files patched**
- `unified.html` — load the new CSS + JS, add a nav link
- `index.html` — same nav link (the two HTML files are duplicates today; consider collapsing to one later)
- `public/app.js` — add a `prm` route + a `renderPrm(seller)` that calls `prmApp.mount(viewEl, ...)`

**Data plumbing** — adapter in `prm-app.js` maps onyxvvv shapes to the PRM rendering layer:

| PRM (3cx-prm) | onyxvvv (snapshot)                  |
|---------------|-------------------------------------|
| `company`     | `partner.companyName`               |
| `contact`     | `partner.contactName`               |
| `email`       | `partner.accountOwnerEmail`         |
| `phone`       | `partner.accountOwnerPhone`         |
| `type`/`category` | `partner.distributorLevel`      |
| `country`     | `partner.country`                   |
| `agent`       | `partner.accountOwnerName`          |
| `publicId`    | `partner.partnerCode`               |
| `tabs.keys[].key`         | `licenseKey.licenseKey`           |
| `tabs.keys[].product`     | `licenseKey.productEdition`       |
| `tabs.keys[].sc`          | `licenseKey.primaryLicenseSc`     |
| `tabs.keys[].expiry`      | `licenseKey.licenseExpires`       |
| `tabs.keys[].registration`| `licenseKey.company`              |
| `tabs.keys[].disabled`    | `licenseKey.flags.licenseExpired` |
| `tabs.orders[].orderNo`   | `order.orderId`                   |
| `tabs.orders[].created`   | `order.date`                      |
| `tabs.orders[].amount`    | `order.totalUsd`                  |
| `tabs.orders[].payment`   | `order.paymentMethod`             |
| `tabs.notesParsed[]`      | `/api/notes?partnerId=…`          |
| `tabs.users[]`            | *(not in current data — tab hidden)* |

## B) Native Claude Code sales plugin — provider-agnostic

The plugin (`anthropics/knowledge-work-plugins/sales`) is **markdown only** — `commands/*.md` and `skills/*/SKILL.md`. There's no runtime to import. The integration pattern is: vendor the markdown, load it at server boot, prepend the relevant skill as a system message when the user hits a workflow endpoint. Either Anthropic or OpenAI can consume the same prompts — they're plain English instructions.

**Vendor the plugin** (one-time, do this in your `onyxvvv` repo root):

```bash
# Option 1: shallow clone the relevant subtree
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/anthropics/knowledge-work-plugins.git /tmp/kwp
(cd /tmp/kwp && git sparse-checkout set sales)
mkdir -p src/skills
cp -r /tmp/kwp/sales src/skills/

# Option 2: git submodule (keeps you on `main`, easy to update)
git submodule add https://github.com/anthropics/knowledge-work-plugins.git \
  vendor/knowledge-work-plugins
ln -s ../vendor/knowledge-work-plugins/sales src/skills/sales
```

You end up with:

```
src/skills/sales/
├── commands/
│   ├── call-summary.md
│   ├── forecast.md
│   └── pipeline-review.md
└── skills/
    ├── account-research/SKILL.md
    ├── call-prep/SKILL.md
    ├── call-summary/SKILL.md
    ├── competitive-intelligence/SKILL.md
    ├── daily-briefing/SKILL.md
    ├── draft-outreach/SKILL.md
    ├── forecast/SKILL.md
    └── pipeline-review/SKILL.md
```

**Files added**
- `src/aiProvider.js` — unified `chat({ messages, system, provider })`. `provider: 'anthropic' | 'openai'`. Falls back per env.
- `src/skillLoader.js` — at boot, reads every `SKILL.md` under `src/skills/sales/skills/` and exposes `getSkill('call-prep')` returning the markdown body. Hot-reload via fs.watchFile in dev.
- `src/salesRoutes.js` — six endpoints, one per workflow: `/api/sales/call-prep`, `/call-summary`, `/draft-outreach`, `/pipeline-review`, `/account-research`, `/competitive-intel`. Each one builds context from the snapshot + injects the relevant skill + delegates to `aiProvider.chat`.

**Files patched**
- `src/server.js` — `app.use(require('./salesRoutes'))`
- `package.json` — add `"@anthropic-ai/sdk"` dependency
- `public/app.js` — pre-call / during-call / post-call panels gain a "Run" button that calls the new endpoints; provider toggle (Claude / GPT-4o) in the topbar
- `public/styles.css` — small additions for the provider toggle and the inline result panel

### Wiring matrix — call lifecycle to skills

| Stage         | Panel (existing route)         | Skill(s) injected                              | Inputs from snapshot                                          |
|---------------|--------------------------------|------------------------------------------------|---------------------------------------------------------------|
| Pre-call      | `#/dashboard/pre-call`         | `account-research` + `call-prep`               | partner, recent orders, recent calls, license keys, notes     |
| During-call   | `#/chat`                       | `call-prep` + `competitive-intelligence`       | same as above + live user message stream                      |
| Post-call     | `#/dashboard/post-call`        | `call-summary` (+ `draft-outreach` follow-up)  | partner, transcript/notes posted by user                       |
| Ambient       | `#/dashboard/insights`         | `pipeline-review` + `daily-briefing`           | full snapshot for the seller                                   |
| Outreach      | new button on partner row      | `draft-outreach` + `account-research`          | partner, last interaction                                      |

### Provider toggle

Stored as `localStorage.onyx-ai-provider`, defaults to `claude` if `ANTHROPIC_API_KEY` is set, otherwise `openai`. Sent on every `/api/sales/*` request as `{ provider }` in the body. Server validates against env keys actually present and refuses unknown providers.

---

## Order of operations (for a clean PR)

1. Drop the two `prm-app.*` files into `public/`. Patch `unified.html` + `index.html` + `app.js`. Verify `#/prm` works against an existing snapshot.
2. Vendor `sales/` skills.
3. Drop `aiProvider.js` + `skillLoader.js` + `salesRoutes.js` into `src/`. Patch `server.js`. `npm i @anthropic-ai/sdk`. Test `curl -X POST http://localhost:3000/api/sales/call-prep -d '{"partnerId":"prt-001","provider":"claude"}'`.
4. Wire UI buttons in `app.js` for pre-call/post-call/insights panels.
5. Add provider toggle in topbar.

Each step is independently reversible — no big-bang.
