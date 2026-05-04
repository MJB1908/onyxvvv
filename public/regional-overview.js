/* ============================================================
   ONYX Dashboard — SPA module (v5.6)
   Reads from server snapshot. Enrichment triggered via bridge.
   Includes License & Growth Quality segmentation.
   Exposes window.regionalOverview = { mount, unmount }
   ============================================================ */
(function () {
  "use strict";
  const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const SIZE_ORDER = ["S","M","L","XL","XXL"];
  const SIZE_LABELS = { S:"S (4–8)", M:"M (16–32)", L:"L (48–96)", XL:"XL (128–192)", XXL:"XXL (256+)" };
  const SIZE_COLORS = { S:"#2d9e5f", M:"#0077b6", L:"#6f42c1", XL:"#e67e00", XXL:"#dc3545" };
  const ED_ORDER = ["Enterprise","Professional","Standard","Trial","Free"];
  const ED_COLORS = {
    Enterprise:{ bg:"#f0ebff", bar:"#6f42c1" }, Professional:{ bg:"#e3f2fd", bar:"#0077b6" },
    Standard:{ bg:"#e0f7fa", bar:"#00838f" }, Trial:{ bg:"#fff3e0", bar:"#e67e00" },
    Free:{ bg:"#e8f5ee", bar:"#2d9e5f" },
  };
  const LEVEL_ORDER = ["Titanium","Platinum","Gold","Silver","Bronze"];
  const LEVEL_COLORS = {
    Titanium:{ bg:"#1a1d23", fg:"#e8e0d0" }, Platinum:{ bg:"#f0ebff", fg:"#6f42c1" },
    Gold:{ bg:"#fff8e1", fg:"#996500" }, Silver:{ bg:"#f0f4f8", fg:"#4a6785" },
    Bronze:{ bg:"#fff3e0", fg:"#bf6900" }, Trainee:{ bg:"#e8f5ee", fg:"#2d9e5f" },
    Affiliate:{ bg:"#f0f2f5", fg:"#5a6270" },
  };

  // ── Segment definitions (License & Growth Quality 2x2) ────────────────────
  const SEGMENTS = {
    strategic:    { label:"Strategic",    icon:"🟢", color:"#2d9e5f", bg:"rgba(45,158,95,.12)",  desc:"High keys + growing — invest & expand" },
    emerging:     { label:"Emerging",     icon:"🔵", color:"#0077b6", bg:"rgba(0,119,182,.12)",  desc:"Low keys but growing fast — nurture" },
    mature:       { label:"Mature",       icon:"🟡", color:"#e67e00", bg:"rgba(230,126,0,.12)",  desc:"High keys, flat growth — maintain & upsell" },
    at_risk:      { label:"At Risk",      icon:"🔴", color:"#dc3545", bg:"rgba(220,53,69,.12)",  desc:"Low keys, not growing — re-engage" },
    intervention: { label:"Intervention", icon:"⚫", color:"#f87171", bg:"rgba(248,113,113,.12)", desc:"Declining licenses — call now" },
  };

  function classifyPartner(p, medianKeys) {
    if (!p.enriched) return null;
    const keys = p.keys ?? 0;
    const growth = p.growthTrend;
    if (growth !== null && growth < -0.05) return "intervention";
    const highKeys = keys >= medianKeys;
    const growing = growth !== null && growth > 0.05;
    if (highKeys && growing) return "strategic";
    if (highKeys && !growing) return "mature";
    if (!highKeys && growing) return "emerging";
    return "at_risk";
  }

  function sizeBucket(sc) { const n=parseInt(sc)||0; if(n<=8) return "S"; if(n<=32) return "M"; if(n<=96) return "L"; if(n<=192) return "XL"; return "XXL"; }
  function getLevelColor(lv) { return LEVEL_COLORS[lv] || { bg:"var(--surface-2)", fg:"var(--muted)" }; }
  function badge(label, bg, fg) { return `<span style="background:${bg};color:${fg};font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;white-space:nowrap">${esc(label)}</span>`; }

  // ── Minimal bridge helper (for enrichment + ↻ only) ──
  let _bridgeReady = false;
  window.addEventListener("onyx-bridge:ready", () => { _bridgeReady = true; });
  if (window.__onyxBridgeContent__) _bridgeReady = true;
  let _rid = 0;
  function bridgeCall(type, payload={}) {
    return new Promise(resolve => {
      if (!_bridgeReady) { resolve(null); return; }
      const reqId = `ov_${++_rid}_${Date.now()}`;
      const h = e => { if (e.detail?.reqId !== reqId) return; window.removeEventListener("onyx-bridge:response", h); resolve(e.detail); };
      window.addEventListener("onyx-bridge:response", h);
      window.dispatchEvent(new CustomEvent("onyx-bridge:request", { detail: { reqId, type, ...payload } }));
      setTimeout(() => { window.removeEventListener("onyx-bridge:response", h); resolve(null); }, 60000);
    });
  }

  let _container = null, _snapshotSlug = null;
  let _state = {
    allPartners: [],
    ov: {
      enriched: {}, enriching: false,
      search: "", levelFilter: "", countryFilter: "", agentFilter: "",
      segmentFilter: "", editionFilter: "", sizeFilter: "",
      viewFilter: "all", sortField: "keys", sortDir: "desc",
    },
    onPartnerClick: null,
  };

  let _cssInjected = false;
  function injectCSS() {
    if (_cssInjected) return; _cssInjected = true;
    const s = document.createElement("style");
    s.textContent = `
.ov-wrap{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:var(--text);}
.ov-kpi-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px;}
.ov-kpi{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;}
.ov-kpi-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:5px;}
.ov-kpi-value{font-size:22px;font-weight:700;line-height:1;}
.ov-kpi-sub{font-size:10px;color:var(--muted);margin-top:3px;}
.ov-seg-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}
.ov-seg-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;transition:border-color .15s,opacity .15s;}
.ov-seg-card:hover{border-color:var(--accent);}
.ov-seg-card.active{border-width:2px;}
.ov-seg-card.dimmed{opacity:.35;}
.ov-seg-icon{font-size:14px;}
.ov-seg-count{font-size:20px;font-weight:700;margin:2px 0;}
.ov-seg-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
.ov-seg-desc{font-size:9px;color:var(--muted);margin-top:2px;line-height:1.3;}
.ov-charts{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px;}
.ov-chart-panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;display:flex;flex-direction:column;}
.ov-chart-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:10px;}
.ov-bar-row{margin-bottom:7px;cursor:pointer;transition:opacity .15s;}
.ov-bar-label{display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;}
.ov-bar-track{height:4px;background:var(--surface-2);border-radius:3px;overflow:hidden;}
.ov-bar-fill{height:100%;border-radius:3px;transition:width .3s;}
.ov-view-pills{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;}
.ov-view-pill{display:flex;align-items:center;gap:5px;font-size:11px;padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer;font-family:inherit;font-weight:500;transition:all .15s;}
.ov-view-pill.active{font-weight:700;}
.ov-score-ring{position:relative;flex-shrink:0;}
.ov-score-ring svg{transform:rotate(-90deg);}
.ov-score-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;}
.ov-tbl{width:100%;border-collapse:collapse;}
.ov-tbl th{padding:8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);text-align:right;cursor:pointer;user-select:none;white-space:nowrap;border-bottom:1px solid var(--border);}
.ov-tbl th:nth-child(2){text-align:left;}
.ov-tbl td{padding:6px 8px;font-size:12px;border-bottom:1px solid var(--surface-2);vertical-align:middle;}
.ov-tbl tr{cursor:pointer;transition:background .1s;}
.ov-tbl tr:hover td{background:var(--surface-2);}
.ov-agent-row{display:flex;align-items:center;gap:4px;margin-bottom:10px;flex-wrap:wrap;}
.ov-agent-btn{font-size:10px;padding:3px 8px;border-radius:4px;border:1px solid transparent;background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;transition:all .1s;}
.ov-agent-btn.active{border-color:#0077b6;background:rgba(0,119,182,.15);color:#5c9dff;font-weight:700;}
.ov-active-filters{display:flex;align-items:center;gap:6px;padding:8px 14px;margin-bottom:14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;flex-wrap:wrap;}
.ov-filter-tag{display:flex;align-items:center;gap:4px;font-size:11px;padding:3px 10px;border-radius:5px;border:1px solid var(--border);background:var(--surface-2);color:var(--muted);cursor:pointer;font-weight:600;font-family:inherit;}
.ov-filter-tag:hover{border-color:var(--error);color:var(--error);}
.ov-enrich-bar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--surface-2);border:1px solid #4a3580;border-radius:8px;margin-bottom:14px;}
.ov-enrich-btn{font-size:10px;padding:4px 12px;border-radius:5px;border:1px solid #4a3580;background:var(--surface);color:#a78bfa;cursor:pointer;font-weight:600;font-family:inherit;}
.ov-enrich-btn:disabled{opacity:.5;cursor:not-allowed;}
.ov-seg-badge{font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;white-space:nowrap;text-transform:uppercase;letter-spacing:.3px;}
@media (max-width:1200px){.ov-kpi-grid{grid-template-columns:repeat(3,1fr);}.ov-charts{grid-template-columns:1fr 1fr;}.ov-seg-grid{grid-template-columns:repeat(3,1fr);}}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
`;
    document.head.appendChild(s);
  }

  function scoreRing(score, size) {
    if (score===null) return '<span style="color:var(--muted);font-size:10px">—</span>';
    const r=(size-4)/2, circ=2*Math.PI*r, col=score>=70?"#2d9e5f":score>=45?"#e67e00":"#dc3545";
    return `<div class="ov-score-ring" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="3"/><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${col}" stroke-width="3" stroke-dasharray="${(score/100)*circ} ${circ}" stroke-linecap="round"/></svg><div class="ov-score-num" style="font-size:${size<36?9:11}px;color:${col}">${score}</div></div>`;
  }
  function contactAge(d) {
    if(d===null) return '<span style="color:var(--muted)">—</span>';
    const col=d<=14?"#2d9e5f":d<=30?"#0077b6":d<=60?"#e67e00":"#dc3545";
    const lbl=d<=1?"Today":d<=7?d+"d":d<=30?Math.round(d/7)+"w":Math.round(d/30)+"mo";
    return `<span style="color:${col};font-weight:600;font-size:11px">${lbl}</span>`;
  }
  function chartPanel(title, items) {
    return `<div class="ov-chart-panel"><div class="ov-chart-title">${title}</div>${items.map(it=>{
      const pct=Math.round((it.count/(it.total||1))*100);
      return `<div class="ov-bar-row" data-chart-key="${esc(it.key)}" data-chart-type="${esc(it.type)}" style="opacity:${it.dimmed?".4":"1"}"><div class="ov-bar-label"><span style="color:var(--muted);font-weight:${it.active?700:400}">${it.badge||esc(it.label)}</span><span style="font-weight:600">${it.count} <span style="color:var(--muted);font-weight:400;font-size:10px">(${pct}%)</span></span></div><div class="ov-bar-track"><div class="ov-bar-fill" style="width:${pct}%;background:${it.color}"></div></div></div>`;
    }).join("")}</div>`;
  }

  // ── Data processing ───────────────────────────────────────────────────────
  function computeMedianKeys() {
    const vals = _state.allPartners
      .map(p => { const e = _state.ov.enriched[p.id]; return e ? (e.commercialKeys??e.keys??0) : null; })
      .filter(v => v !== null)
      .sort((a,b) => a - b);
    if (!vals.length) return 0;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : Math.round((vals[mid-1] + vals[mid]) / 2);
  }

  function buildList() {
    const ov = _state.ov;
    const medianKeys = computeMedianKeys();
    let list = _state.allPartners.map(p => {
      const e = ov.enriched[p.id] || {};
      const item = {
        id: p.id, company: p.companyName||p.company||"—",
        level: e.level||p.distributorLevel||"",
        type: p.partnerCategory||p.category||"",
        country: p.country||"", agent: p.accountOwnerName||p.agent||"",
        cert: p.cert||"", revenue: p.annualRevenueUsd||p.revenue||"",
        keys: e.commercialKeys??e.keys??null, trials: e.trials??null,
        totalSC: e.totalSC??null, newActivations: e.newActivations??null,
        expiringSoon: e.expiringSoon??null, overdue: e.overdue??null,
        renewalRate: e.renewalRate??null, edMix: e.edMix??{}, szMix: e.szMix??{},
        score: e.score??null, growthTrend: e.growthTrend??null,
        lastContactDaysAgo: e.lastContactDaysAgo??null,
        enriched: !!e.keys||!!e.commercialKeys,
        avgDealSize: (e.totalSC && (e.commercialKeys||e.keys)) ? Math.round((e.totalSC) / (e.commercialKeys||e.keys)) : null,
      };
      item.segment = classifyPartner(item, medianKeys);
      return item;
    });
    if(ov.search){const q=ov.search.toLowerCase();list=list.filter(p=>p.company.toLowerCase().includes(q)||String(p.id).includes(q));}
    if(ov.levelFilter) list=list.filter(p=>p.level===ov.levelFilter);
    if(ov.countryFilter) list=list.filter(p=>p.country===ov.countryFilter);
    if(ov.agentFilter) list=list.filter(p=>p.agent===ov.agentFilter);
    if(ov.segmentFilter) list=list.filter(p=>p.segment===ov.segmentFilter);
    if(ov.editionFilter) list=list.filter(p=>(p.edMix[ov.editionFilter]||0)>0);
    if(ov.sizeFilter) list=list.filter(p=>(p.szMix[ov.sizeFilter]||0)>0);
    if(ov.viewFilter==="active") list=list.filter(p=>(p.keys??0)>0);
    if(ov.viewFilter==="expiring") list=list.filter(p=>(p.expiringSoon??0)>0);
    if(ov.viewFilter==="overdue") list=list.filter(p=>(p.overdue??0)>0);
    list.sort((a,b)=>{const av=a[ov.sortField]??-9999,bv=b[ov.sortField]??-9999;return typeof av==="string"?(ov.sortDir==="asc"?av.localeCompare(bv):bv.localeCompare(av)):(ov.sortDir==="asc"?av-bv:bv-av);});
    return list;
  }

  function computeAgg(list) {
    const el=list.filter(p=>p.enriched),tp=list.length,ep=el.length;
    const tk=el.reduce((s,p)=>s+(p.keys||0),0);
    const na=el.reduce((s,p)=>s+(p.newActivations||0),0),ex=el.reduce((s,p)=>s+(p.expiringSoon||0),0);
    const od=el.reduce((s,p)=>s+(p.overdue||0),0);
    const rr=ep?Math.round(el.reduce((s,p)=>s+(p.renewalRate||0),0)/ep):0;
    const avgScore=ep?Math.round(el.reduce((s,p)=>s+(p.score||0),0)/ep):0;
    const edDist={},szDist={},lvDist={},segDist={};
    el.forEach(p=>{Object.entries(p.edMix).forEach(([e,c])=>{edDist[e]=(edDist[e]||0)+c;});Object.entries(p.szMix).forEach(([b,c])=>{szDist[b]=(szDist[b]||0)+c;});});
    list.forEach(p=>{if(p.level) lvDist[p.level]=(lvDist[p.level]||0)+1;});
    el.forEach(p=>{if(p.segment) segDist[p.segment]=(segDist[p.segment]||0)+1;});
    const topAct=[...el].filter(p=>(p.newActivations||0)>0).sort((a,b)=>b.newActivations-a.newActivations);
    const agents=[...new Set(list.map(p=>p.agent).filter(Boolean))].sort();
    const countries=[...new Set(list.map(p=>p.country).filter(Boolean))].sort();
    return {tp,ep,tk,na,ex,od,rr,avgScore,edDist,szDist,lvDist,segDist,topAct,agents,countries};
  }

  // ── Enrichment ────
  async function startEnrichment() {
    if (_state.ov.enriching) return;
    if (!_bridgeReady) { alert("ONYX Chrome extension not detected."); return; }
    _state.ov.enriching = true; render();
    const ids = _state.allPartners.map(p=>p.id).filter(id=>!_state.ov.enriched[id]);
    for (let i=0; i<ids.length; i++) {
      try {
        const r = await bridgeCall("FETCH_KEYS_SUMMARY", { partnerId: String(ids[i]) });
        if (r?.ok && r.result) _state.ov.enriched[ids[i]] = r.result;
        if ((i+1)%5===0 || i===ids.length-1) render();
      } catch(e) { console.warn(`Enrich ${ids[i]} failed:`, e); }
    }
    _state.ov.enriching = false;
    if (_snapshotSlug) { try { const snap = await fetch(`/api/snapshots/${encodeURIComponent(_snapshotSlug)}`).then(r=>r.json()); if (snap?.details) { for (const [pid,d] of Object.entries(snap.details)) _state.ov.enriched[pid] = d.keysSummary||d; } } catch {} }
    render();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    if(!_container) return;
    const list=buildList(), agg=computeAgg(list), ov=_state.ov;
    const enrichedCount=Object.keys(ov.enriched).length, totalCount=_state.allPartners.length;
    const hasFilters=ov.search||ov.levelFilter||ov.countryFilter||ov.agentFilter||ov.segmentFilter||ov.editionFilter||ov.sizeFilter||ov.viewFilter!=="all";
    const showCount=Math.min(list.length,100);
    const sortArrow=f=>ov.sortField!==f?'<span style="opacity:.2;margin-left:3px">↕</span>':`<span style="color:var(--accent);margin-left:3px">${ov.sortDir==="asc"?"↑":"↓"}</span>`;

    const pills=[
      {key:"all",label:"All Partners",count:totalCount},
      {key:"active",label:"Active",count:list.filter(p=>(p.keys||0)>0).length,color:"#0077b6"},
      {key:"expiring",label:"Expiring ≤90d",count:agg.ex,color:"#e67e00"},
      {key:"overdue",label:"Overdue",count:agg.od,color:"#dc3545"},
    ];

    const cols=[
      {k:"score",l:"Score",w:"52px"},{k:"company",l:"Partner",w:"auto",left:true},
      {k:"segment",l:"Segment",w:"90px"},
      {k:"level",l:"Level",w:"80px"},{k:"type",l:"Type",w:"100px"},
      {k:"country",l:"",w:"32px"},{k:"keys",l:"Keys",w:"50px"},
      {k:"newActivations",l:"New",w:"50px"},
      {k:"expiringSoon",l:"Expiring",w:"60px"},{k:"overdue",l:"Overdue",w:"60px"},
      {k:"renewalRate",l:"Renewal",w:"60px"},{k:"lastContactDaysAgo",l:"Contact",w:"58px"},
      {k:"agent",l:"Agent",w:"80px"},{k:"_actions",l:"",w:"30px"},
    ];

    // Active filters
    const filterTags = [];
    if(ov.levelFilter) filterTags.push({label:ov.levelFilter,type:"level"});
    if(ov.countryFilter) filterTags.push({label:ov.countryFilter,type:"country"});
    if(ov.agentFilter) filterTags.push({label:ov.agentFilter,type:"agent"});
    if(ov.segmentFilter) filterTags.push({label:SEGMENTS[ov.segmentFilter]?.label||ov.segmentFilter,type:"segment"});
    if(ov.editionFilter) filterTags.push({label:ov.editionFilter,type:"edition"});
    if(ov.sizeFilter) filterTags.push({label:"Size "+ov.sizeFilter,type:"size"});
    if(ov.viewFilter!=="all") filterTags.push({label:pills.find(p=>p.key===ov.viewFilter)?.label||ov.viewFilter,type:"view"});

    function segBadge(seg) {
      if (!seg || !SEGMENTS[seg]) return '<span style="color:var(--muted);font-size:9px">—</span>';
      const s = SEGMENTS[seg];
      return `<span class="ov-seg-badge" style="background:${s.bg};color:${s.color};border:1px solid ${s.color}30">${s.icon} ${s.label}</span>`;
    }

    _container.innerHTML=`<div class="ov-wrap" style="padding:14px 20px">
      ${agg.agents.length?`<div class="ov-agent-row"><span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)">Agent:</span><button class="ov-agent-btn${!ov.agentFilter?" active":""}" data-agent="">All</button>${agg.agents.map(a=>`<button class="ov-agent-btn${ov.agentFilter===a?" active":""}" data-agent="${esc(a)}">${esc(a.split(/\s+/)[0])}</button>`).join("")}</div>`:""}

      <div class="ov-view-pills">${pills.map(vp=>{const active=ov.viewFilter===vp.key,bc=vp.color||"#0077b6";return`<button class="ov-view-pill${active?" active":""}" data-vf="${vp.key}" style="border-color:${active?bc:"var(--border)"};background:${active?bc+"10":"var(--surface)"};color:${active?bc:"var(--muted)"}">${vp.label} <span style="font-size:10px;font-weight:700;opacity:${active?1:.6}">${vp.count}</span></button>`;}).join("")}</div>

      <div class="ov-kpi-grid">
        <div class="ov-kpi"><div class="ov-kpi-label">Partners</div><div class="ov-kpi-value">${agg.tp}</div><div class="ov-kpi-sub">avg score ${agg.avgScore}</div></div>
        <div class="ov-kpi"><div class="ov-kpi-label">Commercial Keys</div><div class="ov-kpi-value" style="color:#0077b6">${agg.tk.toLocaleString("de-DE")}</div><div class="ov-kpi-sub">paid licenses</div></div>
        <div class="ov-kpi"><div class="ov-kpi-label">New (30d)</div><div class="ov-kpi-value" style="color:#2d9e5f">${agg.na}</div><div class="ov-kpi-sub">activations</div></div>
        <div class="ov-kpi"><div class="ov-kpi-label">Expiring</div><div class="ov-kpi-value" style="color:#e67e00">${agg.ex}</div><div class="ov-kpi-sub">within 90 days</div></div>
        <div class="ov-kpi"><div class="ov-kpi-label">Overdue</div><div class="ov-kpi-value" style="color:#dc3545">${agg.od}</div><div class="ov-kpi-sub">past expiry</div></div>
        <div class="ov-kpi"><div class="ov-kpi-label">Renewal Rate</div><div class="ov-kpi-value" style="color:${agg.rr>=70?"#2d9e5f":agg.rr>=50?"#e67e00":"#dc3545"}">${agg.rr}%</div><div class="ov-kpi-sub">across portfolio</div></div>
      </div>

      <!-- License & Growth Segmentation -->
      ${enrichedCount > 0 ? `
      <div class="ov-seg-grid">
        ${["strategic","emerging","mature","at_risk","intervention"].map(key=>{
          const s=SEGMENTS[key], count=agg.segDist[key]||0;
          const active=ov.segmentFilter===key, dimmed=ov.segmentFilter&&ov.segmentFilter!==key;
          return `<div class="ov-seg-card${active?" active":""}${dimmed?" dimmed":""}" data-seg="${key}" style="border-color:${active?s.color:"var(--border)"}">
            <div style="display:flex;align-items:center;gap:6px"><span class="ov-seg-icon">${s.icon}</span><span class="ov-seg-label" style="color:${s.color}">${s.label}</span></div>
            <div class="ov-seg-count" style="color:${s.color}">${count}</div>
            <div class="ov-seg-desc">${s.desc}</div>
          </div>`;
        }).join("")}
      </div>` : ""}

      <div class="ov-charts">
        ${chartPanel("Edition Mix",ED_ORDER.map(ed=>({key:ed,type:"edition",label:ed,count:agg.edDist[ed]||0,total:agg.tk||1,color:ED_COLORS[ed]?.bar||"var(--muted)",active:ov.editionFilter===ed,dimmed:ov.editionFilter&&ov.editionFilter!==ed})))}
        ${chartPanel("Key Sizes",SIZE_ORDER.map(b=>({key:b,type:"size",label:SIZE_LABELS[b],count:agg.szDist[b]||0,total:agg.tk||1,color:SIZE_COLORS[b],active:ov.sizeFilter===b,dimmed:ov.sizeFilter&&ov.sizeFilter!==b})))}
        ${chartPanel("Partner Levels",LEVEL_ORDER.map(lv=>{const c=getLevelColor(lv);return{key:lv,type:"level",label:lv,count:agg.lvDist[lv]||0,total:agg.tp||1,color:c.fg,active:ov.levelFilter===lv,dimmed:ov.levelFilter&&ov.levelFilter!==lv,badge:badge(lv,c.bg,c.fg)};}))}
        <div class="ov-chart-panel"><div class="ov-chart-title">Top Activators (30d)</div>
          ${(agg.topAct.slice(0,5)).map((p,i)=>`<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:${i<4?"1px solid var(--border)":"none"};cursor:pointer" data-pid="${p.id}"><span style="font-size:10px;font-weight:700;color:var(--muted);width:20px;text-align:right">#${i+1}</span><span style="flex:1;font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.company)}</span>${p.level?badge(p.level,getLevelColor(p.level).bg,getLevelColor(p.level).fg):""}<span style="font-size:12px;font-weight:700;color:#2d9e5f">${p.newActivations}</span></div>`).join("")||'<div style="color:var(--muted);font-size:11px;padding:8px">No activations</div>'}
        </div>
      </div>

      ${enrichedCount<totalCount?`<div class="ov-enrich-bar"><span style="font-size:11px;color:#c4a8ff">✦ ${enrichedCount}/${totalCount} partners enriched.</span><button class="ov-enrich-btn" id="ovEnrichBtn" ${_state.ov.enriching?"disabled":""}>${_state.ov.enriching?"↻ Enriching…":"↻ Enrich All"}</button><div style="flex:1"></div><span style="font-size:10px;color:var(--muted)">${_bridgeReady?"Extension connected":"Extension not detected"}</span></div>`:""}

      ${filterTags.length?`<div class="ov-active-filters"><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted)">Filtered by:</span>${filterTags.map(f=>`<button class="ov-filter-tag" data-ftype="${f.type}">${esc(f.label)} ×</button>`).join("")}<div style="flex:1"></div><span style="font-size:10px;color:var(--muted)">${list.length} of ${totalCount}</span></div>`:""}

      <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px 10px 0 0;border-bottom:none">
        <div style="position:relative;flex:0 0 260px"><span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:13px;pointer-events:none">⌕</span><input id="ovSearch" value="${esc(ov.search)}" placeholder="Search partners…" style="width:100%;padding:6px 10px 6px 30px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none;font-family:inherit;background:var(--surface-2);color:var(--text)"/></div>
        <select id="ovCountry" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:inherit;background:${ov.countryFilter?"var(--accent-dim)":"var(--surface-2)"};color:${ov.countryFilter?"var(--accent)":"var(--muted)"};cursor:pointer;outline:none"><option value="">All Countries</option>${agg.countries.map(c=>`<option value="${esc(c)}"${ov.countryFilter===c?" selected":""}>${esc(c)}</option>`).join("")}</select>
        <div style="flex:1"></div>
        ${hasFilters?'<button id="ovClear" style="font-size:10px;padding:4px 10px;border-radius:5px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer;font-weight:600;font-family:inherit">✕ Clear all</button>':""}
        <span style="font-size:10px;color:var(--muted)">${list.length} partners</span>
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:0 0 10px 10px;overflow:hidden"><div style="overflow-x:auto">
        <table class="ov-tbl"><thead><tr>${cols.map(c=>c.k==="_actions"?`<th style="width:${c.w}"></th>`:`<th data-sort="${c.k}" style="width:${c.w};text-align:${c.left?"left":"right"}">${c.l}${sortArrow(c.k)}</th>`).join("")}</tr></thead>
        <tbody id="ovTbody">${list.slice(0,showCount).map(p=>{
          const tc=getLevelColor(p.level),na=p.newActivations,ex=p.expiringSoon,od=p.overdue,rr=p.renewalRate;
          return`<tr data-pid="${p.id}">
            <td style="text-align:center">${scoreRing(p.score,30)}</td>
            <td style="text-align:left"><div style="font-size:12px;font-weight:500">${esc(p.company)}</div><div style="font-size:10px;color:var(--muted)">#${esc(String(p.id))}</div></td>
            <td style="text-align:center">${segBadge(p.segment)}</td>
            <td style="text-align:right">${p.level?badge(p.level,tc.bg,tc.fg):'<span style="color:var(--muted)">—</span>'}</td>
            <td style="text-align:right;font-size:10px;color:var(--muted)">${esc(p.type||"—")}</td>
            <td style="text-align:center;font-size:10px;color:var(--muted)">${esc(p.country)}</td>
            <td style="text-align:right;font-weight:600">${p.keys!==null?p.keys:'<span style="color:var(--muted)">—</span>'}</td>
            <td style="text-align:right;font-weight:700;color:${na>0?"#2d9e5f":"var(--border)"}">${na!==null?(na||"—"):'<span style="color:var(--muted)">—</span>'}</td>
            <td style="text-align:right;color:${ex>0?"#e67e00":"var(--border)"}">${ex!==null?(ex||"—"):'<span style="color:var(--muted)">—</span>'}</td>
            <td style="text-align:right;color:${od>0?"#dc3545":"var(--border)"}">${od!==null?(od||"—"):'<span style="color:var(--muted)">—</span>'}</td>
            <td style="text-align:right">${rr!==null?`<span style="font-size:11px;font-weight:700;color:${rr>=70?"#2d9e5f":rr>=50?"#e67e00":"#dc3545"}">${rr}%</span>`:'<span style="color:var(--muted)">—</span>'}</td>
            <td style="text-align:right">${contactAge(p.lastContactDaysAgo)}</td>
            <td style="text-align:right;font-size:11px;color:var(--muted);white-space:nowrap">${esc(p.agent)}</td>
            <td style="text-align:center"><button class="ov-row-refresh" data-rid="${p.id}" title="Fetch full detail" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--muted);padding:2px;transition:color .15s" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--muted)'">↻</button></td>
          </tr>`;}).join("")}</tbody></table></div>
        ${list.length>showCount?`<div style="padding:10px;text-align:center;font-size:10px;color:var(--muted)">${showCount} of ${list.length}</div>`:""}
        ${!list.length?'<div style="padding:32px;text-align:center;color:var(--muted);font-size:12px">No partners match filters.</div>':""}
      </div>
    </div>`;
    wireEvents();
  }

  function wireEvents() {
    const ov=_state.ov, q=s=>_container.querySelector(s), qa=s=>_container.querySelectorAll(s);
    qa(".ov-agent-btn").forEach(b=>b.addEventListener("click",()=>{ov.agentFilter=b.dataset.agent;render();}));
    qa(".ov-view-pill").forEach(b=>b.addEventListener("click",()=>{const k=b.dataset.vf;ov.viewFilter=ov.viewFilter===k?"all":k;render();}));
    qa(".ov-bar-row").forEach(r=>r.addEventListener("click",()=>{const k=r.dataset.chartKey,t=r.dataset.chartType;if(t==="level") ov.levelFilter=ov.levelFilter===k?"":k;else if(t==="edition") ov.editionFilter=ov.editionFilter===k?"":k;else if(t==="size") ov.sizeFilter=ov.sizeFilter===k?"":k;render();}));
    // Segment cards — click to filter
    qa(".ov-seg-card").forEach(c=>c.addEventListener("click",()=>{const seg=c.dataset.seg;ov.segmentFilter=ov.segmentFilter===seg?"":seg;render();}));
    qa(".ov-filter-tag").forEach(b=>b.addEventListener("click",()=>{
      const t=b.dataset.ftype;
      if(t==="level") ov.levelFilter=""; else if(t==="country") ov.countryFilter="";
      else if(t==="agent") ov.agentFilter=""; else if(t==="segment") ov.segmentFilter="";
      else if(t==="edition") ov.editionFilter=""; else if(t==="size") ov.sizeFilter="";
      else if(t==="view") ov.viewFilter="all";
      render();
    }));
    q("#ovSearch")?.addEventListener("input",e=>{ov.search=e.target.value.trim().toLowerCase();render();});
    q("#ovCountry")?.addEventListener("change",e=>{ov.countryFilter=e.target.value;render();});
    q("#ovClear")?.addEventListener("click",()=>{ov.search="";ov.levelFilter="";ov.countryFilter="";ov.agentFilter="";ov.segmentFilter="";ov.editionFilter="";ov.sizeFilter="";ov.viewFilter="all";render();});
    q("#ovEnrichBtn")?.addEventListener("click",startEnrichment);
    qa(".ov-row-refresh").forEach(btn=>btn.addEventListener("click",async e=>{
      e.stopPropagation();
      if(!_bridgeReady){alert("Extension not detected.");return;}
      const pid=btn.dataset.rid;
      btn.textContent="⟳";btn.style.color="var(--accent)";btn.style.animation="spin .7s linear infinite";
      try{const r=await bridgeCall("FETCH_PARTNER360",{partnerId:String(pid)});if(r?.ok&&r.result){_state.ov.enriched[pid]=r.result.keysSummary||_state.ov.enriched[pid]||{};render();}else{btn.textContent="↻";btn.style.color="";btn.style.animation="";}}
      catch{btn.textContent="↻";btn.style.color="";btn.style.animation="";}
    }));
    qa(".ov-tbl th[data-sort]").forEach(th=>th.addEventListener("click",()=>{const f=th.dataset.sort;if(ov.sortField===f) ov.sortDir=ov.sortDir==="asc"?"desc":"asc";else{ov.sortField=f;ov.sortDir="desc";}render();}));
    qa("#ovTbody tr[data-pid]").forEach(r=>r.addEventListener("click",()=>{if(_state.onPartnerClick) _state.onPartnerClick(r.dataset.pid);}));
    qa("[data-pid]").forEach(r=>{if(!r.closest("#ovTbody")) r.addEventListener("click",()=>{if(_state.onPartnerClick) _state.onPartnerClick(r.dataset.pid);});});
  }

  async function mount(container, opts={}) {
    injectCSS(); _container=container;
    _state.onPartnerClick=opts.onPartnerClick||null;
    const snapshot=opts.snapshot;
    if(!snapshot?.partners?.length) { _container.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted)">No partner data. Open the ONYX extension and click "Get Data".</div>'; return; }
    _state.allPartners=snapshot.partners;
    _snapshotSlug=snapshot.rep?.slug||null;
    _state.ov.enriched={};
    if(snapshot.details) { for(const[pid,d] of Object.entries(snapshot.details)) _state.ov.enriched[pid]=d.keysSummary||d; }
    render();
  }
  function unmount(){_container=null;}
  window.regionalOverview={mount,unmount};
})();
