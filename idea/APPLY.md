# ONYX v3 — pruning pass apply guide

Replace files, append CSS, set two new env vars, restart. That's it.

## What changes (from v2)

**UI removed:**
- Seller dropdown in topbar (auto from `/api/me`)
- AI provider dropdown in topbar (moved to Settings)
- Brand subtitle "AI Sales Force Assistant"
- Nav: License types, Internal users, Products, Partner intelligence, Call queue, Prospects
- The "Partner dashboard" and "AI workspace" nav groups (flattened)

**UI added:**
- `#/settings` — full settings page, replaces `admin.html`
- `#/actions` — "what should I do today" view (was `#/home`)
- `#/` (root) → reseller dashboard (was `#/prm`)
- Settings cog at the bottom of the sidebar

**Server changed:**
- `/api/me` — replaces `/api/sellers`. Returns the authenticated user.
- `/api/settings` GET/POST — replaces `/api/admin/settings`. Handles AI prefs + models + PRM defaults.
- `/api/secrets/:provider` PUT/DELETE — runtime API keys, encrypted on disk.
- Removed: `/api/sellers`, `/api/insights`, `/api/next-caller`, `/api/prospects`, `/api/alerts`, `/api/pre-call-brief`, `/api/admin/*`.

**New env vars:**
- `ONYX_SECRET_KEY` (required for runtime API key storage; min 16 chars)
  ```
  ONYX_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ```
- `ONYX_DEV_USER` (local dev only; set to your email)
  ```
  ONYX_DEV_USER=marcos@fam-valassas.com
  ```
- For production, your reverse proxy / Cloudflare Access / TCX-Hub session must inject `X-Onyx-User: <email>` on requests to ONYX.

## Files to apply

### Replace these files outright

| Source path in this drop                | Target path in onyxvvv repo        |
| ---------------------------------------- | ---------------------------------- |
| `src/server.js`                         | `src/server.js`                    |
| `src/aiProvider.js`                     | `src/aiProvider.js`                |
| `src/settingsStore.js`                  | `src/settingsStore.js`             |
| `public/app.js`                         | `public/app.js`                    |
| `public/unified.html`                   | `public/unified.html`              |
| `public/index.html`                     | `public/index.html`                |

### New files (add)

| Source path                             | Target path                        |
| ---------------------------------------- | ---------------------------------- |
| `src/secretsStore.js`                   | `src/secretsStore.js`              |

### Append (don't replace)

Append the contents of `public/styles-v3-additions.css` to the **bottom of `public/styles.css`**.

### Delete

| Path | Why |
|---|---|
| `public/admin.html` | Replaced by `#/settings` |
| `idea/` (entire folder) | Stale v2 patches from a previous Claude session — already applied |

### `.gitignore`

Add:
```
data/secrets.json
data/secrets.json.tmp
```

### `package.json`

If `@anthropic-ai/sdk` isn't already a dependency, add it:
```json
"@anthropic-ai/sdk": "^0.30.0"
```

Then `npm install`.

## First-run checklist

```bash
# 1. Generate a master key (one-time, save in your secret manager)
export ONYX_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 2. Set who you are (dev only — production uses X-Onyx-User header)
export ONYX_DEV_USER=marcos@fam-valassas.com

# 3. Start
npm start

# 4. Verify
curl http://localhost:3000/api/me
# → { "email": "marcos@fam-valassas.com", "name": "marcos", ... }

curl http://localhost:3000/api/settings
# → { "settings": {...}, "secrets": {...}, "masterKeyAvailable": true, ... }
```

## Smoke test

Visit `http://localhost:3000`:
1. Lands on the reseller dashboard (`#/`)
2. Topbar shows "<your name> · DACH"
3. Click ⚙ Settings — see your account info, AI provider radio, both API key rows, model dropdowns
4. Set an API key — should validate against the live provider before saving
5. Visit `#/actions` — see the action queue
6. Visit `#/pre-call?partnerId=<your-partner-id>` — generates a brief from `/api/sales/call-prep`
7. Visit `#/data/partners` — table of partners
8. Try `#/data/products` — should redirect to root (no longer exists)
9. Try `/admin.html` — redirects to `#/settings`

## What to test in production

- Reverse proxy correctly injects `X-Onyx-User` for every authenticated request
- `ONYX_SECRET_KEY` is set in your deployment platform (Coolify env vars, not in `.env` committed to git)
- File `data/secrets.json` is mode `0600` after first key save
- API key saved via UI takes precedence over env var (verify by checking which key shows `…last4` in the Settings UI status pill)

## Rollback

If something explodes, the old files are unchanged in git history. `git checkout HEAD~1 src/server.js public/app.js public/unified.html public/index.html src/aiProvider.js src/settingsStore.js` and remove `src/secretsStore.js` to fully revert.
