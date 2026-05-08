# ONYX — AI Sales Force Assistant for 3CX Channel Sales

> **Built with Claude (Anthropic) + Cursor + Human oversight** — This entire project was developed through an iterative AI-assisted workflow using Claude as the code author, with human direction, architectural decisions, and domain expertise provided by the GM DACH and Sales Director at 3CX. Every line of code, every parser, every UI component was authored by AI and validated by a human who provided business logic, and iterative feedback.

---

## What is ONYX?

ONYX is a real-time AI-powered sales intelligence platform purpose-built for 3CX channel sales representatives. It connects directly to the 3CX staff portal (ERP), scrapes live partner (until API is provided), license key, revenue, and user data, and presents it through an intelligent dashboard with AI-assisted call preparation, coaching, and follow-up.

Unlike traditional CRM tools that require manual data entry, ONYX pulls data directly from the source of truth — the 3CX administration portal — and enriches it with AI-generated insights, health scores, and actionable recommendations.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     ONYX SYSTEM ARCHITECTURE                        │
│                                                                     │
│  ┌───────────────────┐         ┌──────────────────────────────────┐ │
│  │  Chrome Extension  │         │  Express.js SPA Server           │ │
│  │  (Data Proxy)      │  HTTP   │  (Render.com / any Node host)   │ │
│  │                    │ ──────► │                                  │ │
│  │  • Scrapes staff.  │ POST    │  • /api/ingest/erp              │ │
│  │    3cx.com         │ JSON    │  • /api/ingest/erp/partner-detail│ │
│  │  • Stores in       │         │  • /api/chat (AI)               │ │
│  │    chrome.storage  │         │  • /api/ai/* (7 workspace routes)│ │
│  │  • Bridges SPA ←→  │         │  • /api/notes                   │ │
│  │    background.js   │         │  • /api/settings                │ │
│  │                    │         │  • /api/secrets                 │ │
│  └───────┬───────────┘         └──────────┬───────────────────────┘ │
│          │                                │                         │
│          │ Content Script                 │ Serves static files     │
│          │ Bridge (postMessage)           │                         │
│          ▼                                ▼                         │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    SPA Frontend (Browser)                      │ │
│  │                                                                │ │
│  │  unified.html ─► app.js (session isolation + routing)          │ │
│  │       ├── #/dashboard  → regional-overview.js (KPIs, table)   │ │
│  │       ├── #/           → prm-app.js (Partner 360 view)        │ │
│  │       ├── #/actions    → app.js (trials + not-contacted)      │ │
│  │       └── #/settings   → app.js (API keys, model, prefs)     │ │
│  │                                                                │ │
│  │  Floating AI Chat (✦) available on all views                   │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### Dashboard (`#/dashboard`)
- **KPI cards**: Install base, new activations (30d), renewal rate, expiring keys
- **Partner segmentation**: Strategic / Emerging / Nurture / At-Risk based on composite scoring
- **Full partner table** with columns: Score, Partner, Segment, Level, Country, Keys, **Trials**, New, Expiring, Revenue, Health
- **Edition/Size/Level chart filtering** with interactive segmentation breakdowns
- **Enrich All** button: triggers bulk key summary fetch for all partners
- **Per-row refresh (↻)**: fetches full partner-360 detail from ERP via Chrome extension bridge

### Reseller Overview (`#/` — Partner 360)
- **Header**: Avatar, company name, tier badge, health ring, email link
- **Subtitle**: Partner ID, country, contact name, sales rep, start date
- **Pill badges**: Active, Solution Provider, High Potential, Revenue, Keys count, Users count, Credit limit, Sell model, SIP provider
- **5 tabs**:
  - **Overview**: Company profile, discount structure, key distribution chart
  - **Notes**: Per-partner notes with timestamped entries and poster attribution
  - **License Keys**: Full key table with expandable detail rows (7 fields: Company, FQDN, Deployed As, Extensions, Purchase Date, Last Activation, Activations)
  - **Revenue**: Current year + previous annual KPI cards with YoY%, 3-year attributed revenue trend table with bar chart
  - **Users**: Full user table with Name (OWNER badge), Email, Phone, Roles, Certification level (Advanced/Basic pills), Status, Last Login
- **Floating AI Chat (✦)**: Context-aware assistant with full partner data in system prompt

### AI Workspace (7 backend routes — frontend UI in development)
- **Call Setup Summary**: AI generates a pre-call briefing from live ERP partner data
- **Call Setup Runbook**: AI creates 4-5 actionable bullet points for the call
- **Runbook Coach**: AI revises the runbook based on seller instructions
- **Simulated Call Turns**: AI plays both buyer and seller roles for practice
- **During-Call Evaluation**: Live scoring — sentiment analysis, topic guidance, runbook progress tracking
- **During-Call Whisper**: In-call coaching channel with tactical advice
- **Post-Call Drafts**: Auto-generates meeting notes, follow-up email, and action plan

### Chrome Extension (Data Proxy)
- **Partner list scraper**: Extracts all partners from `customers.aspx` with 20+ fields per partner
- **Partner detail enrichment**: Fetches General, Users, Billing, Certification, Revenue, and Statistics tabs via ASP.NET UpdatePanel POST simulation
- **License key scraper**: Parses `keys.aspx` with disabled key detection (both row class and anchor class)
- **Key detail fetcher**: Parses `key/edit.aspx` with correct `lbl`-prefixed IDs + activations table FQDN fallback
- **Revenue tab parser**: Extracts revenue balance, previous annual, and 3-year attributed revenue table
- **Users tab parser**: Extracts users with roles (array), certification level, owner detection
- **Configurable server URL**: No hardcoded deployment URL — ONYX server URL is configurable via the extension popup and persisted in `chrome.storage.local`
- **Session isolation**: Supports `?onyxUser=` parameter for multi-user deployments

---

## File Structure

```
onyx/
├── extension/                      # Chrome Extension (loaded locally via chrome://extensions)
│   ├── manifest.json               # Extension manifest (v3, ONYX v3.1.0)
│   ├── background.js               # Service worker: scraping engine, tab postback simulation,
│   │                                #   key detail parser, revenue/users specialist parsers,
│   │                                #   ONYX server push, bridge message handler
│   ├── dashboard.html              # Extension popup UI (status, Get Data, Open ONYX, URL config)
│   ├── dashboard.js                # Popup logic: storage-based URL, connection checks, data fetch
│   ├── bridge.js                   # Content script: relays messages between SPA ←→ background.js
│   ├── content.js                  # Injected into staff.3cx.com for cookie/session access
│   ├── webclient.js                # 3CX WebClient integration (call state interception)
│   ├── webclient_inject.js         # Page-level injection for WebSocket/protobuf hooks
│   ├── popup.html                  # Legacy popup (retained for compatibility)
│   └── popup.js                    # Legacy popup logic
│
├── public/                         # Static SPA files served by Express
│   ├── unified.html                # Main entry with nav (Dashboard, Reseller Overview, Actions, Settings)
│   ├── app.js                      # Core SPA: session isolation, routing, chat shell, settings UI
│   ├── prm-app.js                  # Reseller Overview: partner-360 with 5 tabs, floating AI chat
│   ├── prm-app.css                 # Dark theme CSS for Reseller Overview
│   ├── regional-overview.js        # Dashboard: KPIs, segmentation, partner table, charts
│   ├── styles.css                  # Global dark theme CSS variables and base styles
│   ├── onyx-bridge-client.js       # Client-side bridge for extension ←→ SPA communication
│   ├── context-loader.js           # Dynamic context loading for AI prompts
│   ├── design-system.css           # Design tokens and component primitives
│   ├── erp.html                    # ERP data viewer (legacy/debug)
│   ├── erp.js                      # ERP data rendering logic
│   ├── index.html                  # Redirect entry point
│   └── favicon.svg                 # ONYX logo
│
├── src/                            # Express.js backend
│   ├── server.js                   # Main server: all API routes, middleware, session isolation,
│   │                                #   AI workspace routes, chat endpoint, static file serving
│   ├── aiWorkspaceApi.js           # AI call simulation backend: 7 handlers for call prep,
│   │                                #   sim calls, coaching, evaluation, post-call drafts.
│   │                                #   Uses real ERP data via buildPartnerPack().
│   ├── openaiClient.js             # OpenAI integration: chatCompletion, chatCompletionWithOptions
│   │                                #   (jsonMode, custom temp/tokens), truncateTranscriptLines,
│   │                                #   partnerInsight, buildSystemPrompt with live ERP context
│   ├── aiProvider.js               # Multi-model AI provider abstraction (OpenAI + Anthropic)
│   ├── erpDataAdapter.js           # ERP data ingestion: receives POST from Chrome extension,
│   │                                #   normalizes partner/key data, per-user snapshot storage
│   ├── salesRoutes.js              # Sales-specific API routes (insights, partner AI pack, etc.)
│   ├── secretsStore.js             # Encrypted API key storage on persistent disk
│   ├── settingsStore.js            # User preferences (model selection, region, etc.)
│   ├── skillLoader.js              # AI skill prompt templates for different sales scenarios
│   └── snapshotStore.js            # Per-user data snapshot persistence (partners, orders, keys)
│
├── design/                         # Design system reference files (HTML previews, CSS tokens)
├── package.json                    # Dependencies: express, openai, @anthropic-ai/sdk
├── render.yaml                     # Render.com deployment configuration
└── README.md                       # This file
```

---

## Data Flow

### Initial Data Load
```
1. User opens Chrome extension popup
2. Sets ONYX server URL (persisted in chrome.storage.local)
3. Clicks "Get Data"
4. Extension scrapes customers.aspx → partner list (20+ fields per partner)
5. POST /api/ingest/erp → server stores partner data per user session
6. Dashboard loads with partner table, KPIs, segmentation
```

### Partner Enrichment (per-row ↻ or "Enrich All")
```
1. Dashboard triggers FETCH_PARTNER360 via bridge
2. Extension fetches partner/edit.aspx (General tab — default GET)
3. Extension POSTs ASP.NET __doPostBack to fetch Users, Billing, Certs, Revenue, Stats tabs
4. Extension fetches keys.aspx?c={partnerId} for all license keys
5. All data merged into a single partner-detail object
6. POST /api/ingest/erp/partner-detail → server stores enriched data
7. SPA renders updated Reseller Overview with all 5 tabs populated
```

### Key Detail Expansion (click a key row in License Keys tab)
```
1. Instantly shows Company, Purchase Date, Last Activation, Activations (from keys.aspx)
2. Background fetches key/edit.aspx?i={keyId} for FQDN, Deployed As, Extensions
3. Parser uses correct lbl-prefixed IDs (Main_phoneSystem_lblFQDN, etc.)
4. Falls back to activations table for FQDN when static Phone System labels show <none>
5. Handles both IssuedTo variants: hlIssuedTo (anchor) and lblIssuedTo (span)
6. Overlays detail page data onto the expandable row (detail wins, key list as fallback)
```

### AI Chat Flow
```
1. User types in floating chat (✦) or call workspace
2. POST /api/chat with messages array + X-Onyx-User header
3. Server builds system prompt with live ERP context (partners, orders, keys)
4. OpenAI/Anthropic returns response
5. Displayed in chat bubble with markdown rendering
```

---

## ERP Field Extraction Reference

### Partner General Tab (`partner/edit.aspx?i={id}`)
`id`, `publicId`, `company`, `contact` (firstName + lastName), `email`, `phone`, `website`, `description`, `type`, `category`, `enabled`, `sageId`, `address`, `country`, `revenue`, `upToDate`, `supportPin`, `discounts` (product / maintenance / hosting), `solutionProvider`, `highPotential`, `salesRep`, `startDate`, `creditLimit`, `sellModel`, `sipTrunkProvider`, `vat`, `paymentMethod`, `currency`

### Partner Users Tab (POST → `btnUsers`)
`firstName`, `lastName`, `email`, `userId`, `phone`, `roles` (array), `cert`, `status`, `lastLogin`

### Partner Revenue Tab (POST → `btnPoints`)
`revenueBalance`, `previousAnnual`, `attributed[]` (`year`, `direct`, `indirect`, `total`)

### License Keys (`keys.aspx?c={partnerId}`)
`key`, `keyId` (numeric), `disabled`, `product`, `purchased`, `activatedOn`, `sc`, `maxExt`, `expiry`, `version`, `issuedTo`, `reseller`, `registration`, `assignedUser`, `activations`

### Key Detail (`key/edit.aspx?i={keyId}`)
`licenseKey`, `product`, `billingType`, `facilityId`, `issuedTo` (dual variant: `hlIssuedTo` anchor + `lblIssuedTo` span), `purchaseDate`, `fqdn` (static label + activations table fallback), `extensions`, `deployedAs`, `registration` (from input `tbCompany`), `reseller`, `activations`, `lastActivation`

---

## Deployment

### Server (Render.com or any Node.js host)
```bash
git clone repo
cd onyx
npm install
npm start          # Starts Express server on PORT (default 3000)
```

**Environment variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `OPENAI_API_KEY` | For AI features | OpenAI API key for chat and workspace |
| `ONYX_SECRET_KEY` | No | Encryption key for stored API secrets |
| `OPENAI_MODEL` | No | Model override (default: gpt-4.1-mini) |

### Chrome Extension
1. Open `chrome://extensions/` in your browser
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** → select the `extension/` folder from this repo
4. Navigate to `staff.3cx.com` and log in with your 3CX staff credentials
5. Click the ONYX extension icon in the Chrome toolbar
6. Enter your ONYX server URL (e.g., `https://your-server.onrender.com`) and click the ✓ save button
7. The ONYX Server status dot should turn green
8. Click **Get Data** to scrape and push partner data to the server
9. Click **Open ONYX** to launch the dashboard

---

## Session Isolation

ONYX supports multiple sales reps using the same server instance. Each user's data is isolated via the `?onyxUser=` query parameter:

- The Chrome extension detects the logged-in user's email from the ERP session cookie
- The **Open ONYX** button appends `?onyxUser={email}#/dashboard` to the URL
- All API calls include the `X-Onyx-User` header (set automatically by the SPA)
- Server-side data stores (partners, keys, notes, settings) are partitioned by user email
- Each rep sees only their own scraped data, notes, and AI conversation history

---

## AI Integration

ONYX supports both **OpenAI** and **Anthropic Claude** as AI providers, configurable via the Settings page (`#/settings`). The AI is used in three contexts:

### 1. Floating Chat (✦)
Free-form assistant available on every view. System prompt includes the full partner context (company, keys, revenue, notes) so the AI can answer questions about any partner without the rep needing to copy-paste data.

### 2. Partner Insight
One-click AI brief for any partner — generates three paragraphs: current state, signals (renewals, large orders, missed calls), and a suggested next action for this week.

### 3. AI Workspace (7 endpoints)
Structured call workflow powered by real ERP data through `buildPartnerPack()`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ai/call-setup-summary` | POST | Pre-call briefing with client context, objectives, scope |
| `/api/ai/call-setup-runbook` | POST | 4-5 actionable bullet points for the call |
| `/api/ai/runbook-coach` | POST | AI revises runbook per seller's natural-language instruction |
| `/api/ai/sim-call-turn` | POST | Simulated buyer/seller dialogue for practice |
| `/api/ai/during-call-eval` | POST | Live scoring: sentiment, topic guidance, runbook achievement |
| `/api/ai/during-call-whisper` | POST | Coach whisper: 2-6 sentences of tactical advice |
| `/api/ai/post-call-drafts` | POST | Meeting notes, follow-up email, action plan bullets |

---

## Development History

This project evolved through several phases, all built collaboratively between a human sales leader and Claude (Anthropic's AI assistant):

| Phase | What was built | Key technical decisions |
|-------|---------------|----------------------|
| **1. PoC** | Mock-data-driven call simulation trainer | 536K of generated JSON, monolithic app.js |
| **2. ERP Integration** | Chrome extension scraper replaced all mock data | ASP.NET UpdatePanel POST simulation, cookie-based auth |
| **3. Dashboard** | Regional overview with KPIs, segmentation, partner table | Composite health scoring, dark theme CSS vars |
| **4. Partner 360** | 5-tab reseller detail view with floating AI chat | Modular rendering (prm-app.js), bridge architecture |
| **5. Revenue & Users** | Specialist parsers for Revenue and Users tabs | `parseRevenueHtml()`, `parseUsersHtml()` — regex on UpdatePanel HTML |
| **6. Key Detail** | Expandable key rows with dual-source data + activations FQDN | `lbl`-prefix fix, `hlIssuedTo`/`lblIssuedTo` variant handling |
| **7. AI Workspace** | 7 call simulation endpoints ported from PoC | `buildPartnerPack()` replaces mockApi with real ERP data |
| **8. Multi-user** | Session isolation, configurable server URL | `?onyxUser=`, `X-Onyx-User` header, `chrome.storage.local` |

### AI Development Methodology

The development workflow used throughout this project:
1. Human describes the feature requirement and provides real HTML samples from the ERP system
2. Claude analyzes the HTML structure, identifies element IDs, and writes the parser/UI code
3. Human tests in the browser and reports results (screenshots, console output, raw HTML)
4. Claude iterates on the code based on feedback
5. Files are delivered for manual deployment to GitHub and Render

This iterative loop was repeated hundreds of times across 8 build sessions to produce the current codebase.

---

## License

Private repository. Internal use only.

---

*This README was generated by Claude (Anthropic) as part of the ONYX development workflow. Last updated: May 2026.*
