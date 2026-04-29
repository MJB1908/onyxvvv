# Patches — apply these to existing onyxvvv files

All four are additive. None of them remove or rewrite existing logic.

---

## 1) `src/server.js` — mount sales routes

Add **once**, before the static handler at the bottom:

```diff
 const erpDataAdapter = require("./erpDataAdapter");
+const salesRoutes = require("./salesRoutes");

 // … all existing routes …

+app.use(salesRoutes);
+
 // Serve the unified dashboard
 app.get("/", (_req, res) => {
   res.sendFile(path.join(__dirname, "..", "public", "unified.html"));
 });
```

---

## 2) `package.json` — add Anthropic SDK

```diff
   "dependencies": {
     "express": "^4.19.2",
     "express-rate-limit": "^7.4.0",
+    "@anthropic-ai/sdk": "^0.30.0",
     "openai": "^4.56.0"
   }
```

Then `npm install`.

---

## 3) `unified.html` and `index.html` — load PRM assets, add nav link

Both files have the same head + sidebar. Apply the same diff to each.

```diff
   <head>
     <meta charset="UTF-8" />
     <meta name="viewport" content="width=device-width, initial-scale=1" />
     <title>ONYX — AI Sales Force Assistant</title>
     <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
     <link rel="stylesheet" href="/styles.css" />
+    <link rel="stylesheet" href="/prm-app.css" />
   </head>
```

In the `<nav class="nav">` block, after the existing `<div class="nav-group">` for Data, add:

```diff
+          <div class="nav-group">
+            <div class="nav-group-title">Reseller PRM</div>
+            <a href="#/prm" class="nav-item nav-item-sub" data-match="prm">Reseller dashboard</a>
+          </div>
         </nav>
```

And before the closing `</body>`, after the `app.js` script tag:

```diff
     <script src="/app.js" defer></script>
+    <script src="/prm-app.js" defer></script>
   </body>
```

(Order matters — `prm-app.js` must load after `app.js` because `app.js` calls `window.prmApp.mount`.)

---

## 4) `public/app.js` — add the `#/prm` route + provider toggle

### 4a. parseRoute() — add the new view

In the `parseRoute()` function (around line 60), add before the final `return { view: "home", title: "Home" };`:

```diff
     if (parts[0] === "data" && parts[1]) {
       const sub = parts[1];
       const titles = {
         partners: "Partners",
         orders: "Orders",
         keys: "License keys",
         "license-types": "License types",
         emails: "Emails",
         users: "Internal users",
         products: "Products",
       };
       return { view: "data", sub, title: titles[sub] || "Data" };
     }
+    if (parts[0] === "prm") {
+      return { view: "prm", title: "Reseller PRM" };
+    }
     return { view: "home", title: "Home" };
```

### 4b. setNavActive() — recognise the new match

```diff
   function setNavActive() {
     const r = parseRoute();
     let match = "";
     if (r.view === "home") match = "home";
     else if (r.view === "chat") match = "chat";
+    else if (r.view === "prm") match = "prm";
     else if (r.view === "dashboard") match = `dashboard/${r.sub}`;
     else if (r.view === "data") match = `data/${r.sub}`;
```

### 4c. render() — dispatch to the new view

```diff
     try {
       if (route.view === "home") await renderHome();
       else if (route.view === "dashboard") await renderDashboard(route.sub, seller);
       else if (route.view === "data") await renderData(route.sub);
       else if (route.view === "chat") renderChatShell();
+      else if (route.view === "prm") await renderPrm(seller);
     } catch (err) {
       viewEl.innerHTML = `<p class="error">${escapeHtml(err.message || "Failed to load.")}</p>`;
     }
```

### 4d. renderPrm() — add the function

Add this function alongside the other `render*` functions:

```js
async function renderPrm(seller) {
  if (!window.prmApp) {
    viewEl.innerHTML = '<p class="empty">PRM module not loaded — check that prm-app.js is included.</p>';
    return;
  }
  // Pick the seller's snapshot (same logic as erp.js)
  const list = await fetch("/api/snapshots").then((r) => r.json()).catch(() => ({ snapshots: [] }));
  if (!list.snapshots?.length) {
    viewEl.innerHTML = '<p class="empty">No snapshot loaded yet — run a refresh from the extension popup.</p>';
    return;
  }
  list.snapshots.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  // Prefer this seller's slug, else most-recent
  const target =
    list.snapshots.find((s) => s.name === seller?.name) || list.snapshots[0];
  const snapshot = await fetch(`/api/snapshots/${encodeURIComponent(target.slug)}`).then((r) => r.json());
  // The PRM module owns the inner DOM — give it a clean container.
  viewEl.innerHTML = "";
  await window.prmApp.mount(viewEl, { snapshot, seller });
}
```

### 4e. Provider toggle (optional, in topbar)

Right after the `seller-select` block in `unified.html` and `index.html`:

```diff
             <label class="seller-label" for="seller-select">Seller</label>
             <select id="seller-select" class="seller-select" aria-label="Selected sales rep"></select>
+            <label class="seller-label" for="ai-provider-select">AI</label>
+            <select id="ai-provider-select" class="seller-select" aria-label="AI provider">
+              <option value="">Auto</option>
+              <option value="anthropic">Claude</option>
+              <option value="openai">ChatGPT</option>
+            </select>
           </div>
         </header>
```

And in `app.js` near the bottom, before `init()`:

```js
const aiProviderSelect = document.getElementById("ai-provider-select");
if (aiProviderSelect) {
  aiProviderSelect.value = localStorage.getItem("onyx-ai-provider") || "";
  aiProviderSelect.addEventListener("change", (e) => {
    if (e.target.value) localStorage.setItem("onyx-ai-provider", e.target.value);
    else localStorage.removeItem("onyx-ai-provider");
  });
}
```

---

## 5) `public/app.js` — wire pre-call panel to the new endpoint (optional but recommended)

Find `if (sub === "pre-call")` in `renderDashboard()`. After the existing render of the brief, add a "Run AI brief" button. Replace the closing `</div>` of `<section class="card brief-card">` with:

```diff
             <section class="card brief-card">
               <h3 class="h3">Suggested agenda</h3>
               <ol class="brief-ol">${agenda}</ol>
             </section>
             <section class="card brief-card">
               <h3 class="h3">Predicted objections</h3>
               <ul class="brief-ul">${objections}</ul>
             </section>
+            <section class="card brief-card brief-card--ai">
+              <h3 class="h3">✦ Generate live brief</h3>
+              <p class="muted">Pulls the call-prep + account-research skills.</p>
+              <button class="btn-secondary" id="btnAiPreCall">Run AI brief</button>
+              <div id="aiPreCallOut" class="ai-result" hidden></div>
+            </section>
           </div>
```

Then at the end of the pre-call branch:

```js
const btn = document.getElementById("btnAiPreCall");
if (btn) {
  btn.addEventListener("click", async () => {
    const out = document.getElementById("aiPreCallOut");
    out.hidden = false;
    out.textContent = "Generating…";
    try {
      const r = await fetch("/api/sales/call-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: b.partner.id,
          seller: seller.name,
          provider: localStorage.getItem("onyx-ai-provider") || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      out.textContent = d.text;
    } catch (e) {
      out.textContent = `Failed: ${e.message}`;
    }
  });
}
```

---

## 6) Repeat the pattern for post-call

Same shape — drop a button on `#/dashboard/post-call` that calls `/api/sales/call-summary` with whatever notes the user has pasted into a textarea. Already plumbed into the PRM dashboard's note form (the `✦ AI summarise` button), so you can ship without touching post-call panel if you prefer.

---

## Smoke tests

```bash
# 1. Server boots, skills loaded
node src/server.js
curl -s http://localhost:3000/api/sales/providers | jq

# 2. Pre-call brief (use a real partnerId from your snapshot)
curl -s -X POST http://localhost:3000/api/sales/call-prep \
  -H "Content-Type: application/json" \
  -d '{"partnerId":"prt-001","provider":"anthropic"}' | jq

# 3. Same with OpenAI
curl -s -X POST http://localhost:3000/api/sales/call-prep \
  -H "Content-Type: application/json" \
  -d '{"partnerId":"prt-001","provider":"openai"}' | jq

# 4. PRM dashboard loads in the SPA
open "http://localhost:3000/#/prm"
```
