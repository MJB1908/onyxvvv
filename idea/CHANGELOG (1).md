# v3-fix — auth simplification

You were right: the ERP scrape already authenticates the user. The Chrome
extension uses your live staff.3cx.com session cookies — anything it pushes
to ONYX is implicitly authenticated by 3CX. So having ONYX *additionally*
require an env var or proxy header is duplicate work.

## What changed

**Before:** `/api/me` returned 401 unless `X-Onyx-User` header or
`ONYX_DEV_USER` env var was set. Frontend rendered "Not signed in" panel
and asked you to configure auth.

**After:** `/api/me` falls back to the most recent snapshot's rep email
when no header/env is present. Returns 200 with `needsRefresh: true`
when no snapshot exists yet (fresh install). Frontend renders "No
reseller data yet" panel pointing at the Chrome extension.

## Auth lookup order (most explicit wins)

1. `X-Onyx-User` header — production setups where a reverse proxy
   (TCX-Hub session, Cloudflare Access, Caddy forward_auth) injects the
   user's email after validating their session.
2. `ONYX_DEV_USER` env var — explicit dev overrides.
3. **Most recent snapshot's rep email** — the new fallback. Sufficient
   for a single-tenant deploy where the user scrapes their own data.

## What this means in practice

- **No env vars needed for the dev / single-tenant case.** Just run an
  ERP refresh from the extension, and ONYX picks up your identity.
- **Production multi-tenant still works.** Drop in `X-Onyx-User` from
  your TCX-Hub session middleware, the existing fallback chain is
  bypassed correctly.
- **The 401 path is gone.** `/api/me` always returns 200; the frontend
  uses `me.needsRefresh` instead of a status code to decide what to render.

## Files changed (only 2)

- `src/server.js` — `authUser()` now consults `snapshotStore.listSnapshots()`
  as a third fallback. `/api/me` always 200s, with `needsRefresh: true`
  when no snapshot exists.
- `public/app.js` — empty-state panel reworded; new `authHeaders()` helper
  conditionally sets `X-Onyx-User` only when known; settings page Account
  card resilient to no-snapshot state.

## Tested

21/21 smoke tests pass:

- Fresh install (no anything) → 200 with `needsRefresh: true`
- Snapshot present, no header → 200, email auto-detected
- Header present → header wins
- Env present → env wins (over snapshot, under header)
- Multiple snapshots → picks most recently updated

## Apply

Drop the two files over the v3 versions:

```
src/server.js  → src/server.js
public/app.js  → public/app.js
```

No env-var changes needed. Restart, run an extension refresh if you haven't
already, and you should land on the reseller dashboard without ever seeing
a 401 or a "configure auth" message.
