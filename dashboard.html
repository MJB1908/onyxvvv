<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>3CX Partner PRM</title>
<style>
:root {
  --bg:#f5f6f8; --s:#ffffff; --s2:#f0f2f5; --b:#e1e4e8; --b2:#cdd0d6;
  --a:#0077b6; --a2:#0096c7; --t:#1a1d23; --m:#5a6270; --dim:#9ba3ae;
  --r:8px; --r2:12px;
  --green:#2d9e5f; --red:#dc3545; --amber:#e67e00; --blue:#0077b6; --purple:#6f42c1;
  --font:'Segoe UI',system-ui,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--t);font:13px var(--font);height:100vh;display:flex;flex-direction:column;overflow:hidden;}

/* ── Top bar ── */
.topbar{display:flex;align-items:center;gap:12px;padding:0 16px;height:48px;background:var(--s);border-bottom:1px solid var(--b);flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.06);}
.topbar .logo{width:28px;height:28px;border-radius:6px;background:linear-gradient(135deg,var(--a),var(--a2));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0;}
.topbar h1{font-size:14px;font-weight:600;flex:0 0 auto;}
.topbar .divider{width:1px;height:20px;background:var(--b);flex-shrink:0;}
.search-wrap{position:relative;flex:0 0 260px;}
.search-wrap input{width:100%;background:var(--s2);border:1px solid var(--b);border-radius:var(--r);color:var(--t);font:13px var(--font);padding:6px 10px 6px 32px;outline:none;transition:border-color .15s;}
.search-wrap input:focus{border-color:var(--a);}
.search-wrap .si{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--dim);font-size:13px;pointer-events:none;}
#searchDrop{position:absolute;top:calc(100%+4px);left:0;right:0;background:var(--s);border:1px solid var(--b);border-radius:var(--r);z-index:100;max-height:220px;overflow-y:auto;display:none;box-shadow:0 4px 12px rgba(0,0,0,.1);}
#searchDrop.open{display:block;}
.sditem{padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--b);}
.sditem:last-child{border:none;}
.sditem:hover{background:var(--b);}
.sditem .sid{color:var(--dim);font-size:11px;margin-left:6px;}
.topbar .sp{flex:1;}
.topbar .pill{font-size:11px;padding:3px 9px;border-radius:4px;background:var(--b);color:var(--m);cursor:pointer;border:1px solid transparent;transition:color .15s,border-color .15s;}
.topbar .pill:hover{color:var(--a);border-color:var(--a);}
#sessionDot{width:8px;height:8px;border-radius:50%;background:#555;transition:background .3s;flex-shrink:0;}

/* ── Layout ── */
.layout{display:flex;flex:1;overflow:hidden;}
.sidebar{width:300px;flex-shrink:0;background:var(--s);border-right:1px solid var(--b);display:flex;flex-direction:column;overflow:hidden;}
.main{flex:1;overflow:hidden;display:flex;flex-direction:column;}

/* ── Sidebar ── */
.sidebar-header{padding:12px 14px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);}
.sidebar-filter{padding:0 10px 10px;display:flex;flex-direction:column;gap:10px;border-bottom:1px solid var(--b);}
.sidebar-filter input#sidebarSearch{width:100%;background:var(--s2);border:1px solid var(--b);border-radius:6px;color:var(--t);font:12px var(--font);padding:6px 10px;outline:none;}
.sidebar-filter input#sidebarSearch:focus{border-color:var(--a);}
.chip-group{display:flex;flex-direction:column;gap:5px;}
.chip-group-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);padding-left:2px;}
.chip-row{display:flex;flex-wrap:wrap;gap:4px;}
.chip{font-size:11px;padding:3px 9px;border-radius:999px;background:var(--s2);color:var(--m);border:1px solid var(--b);cursor:pointer;user-select:none;transition:background .1s,color .1s,border-color .1s;white-space:nowrap;}
.chip:hover{color:var(--t);border-color:var(--a2);}
.chip.active{background:linear-gradient(135deg,var(--a),var(--a2));color:#fff;border-color:transparent;}
.chip .count{font-size:9px;opacity:.7;margin-left:3px;}
.chip.active .count{opacity:.9;}
.partner-list{flex:1;overflow-y:auto;}
.pitem{padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--b);transition:background .1s;}
.pitem:hover,.pitem.active{background:var(--s2);}
.pitem.active{border-left:2px solid var(--a);}
.pitem-name{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pitem-meta{font-size:10px;color:var(--dim);margin-top:2px;}
.pitem-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;}
.sidebar-settings{padding:12px 14px;border-top:1px solid var(--b);}
.settings-field{display:flex;flex-direction:column;gap:3px;margin-bottom:8px;}
.settings-field label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--dim);}
.settings-field input{background:var(--s2);border:1px solid var(--b);border-radius:5px;color:var(--t);font:12px var(--font);padding:5px 8px;outline:none;width:100%;}
.settings-field input:focus{border-color:var(--a);}
.btn-save{width:100%;padding:6px;background:var(--b);border:none;border-radius:5px;color:var(--m);font:600 11px var(--font);cursor:pointer;transition:color .15s;}
.btn-save:hover{color:var(--a);}

/* ── Partner header ── */
.p-header{padding:14px 20px;background:var(--s);border-bottom:1px solid var(--b);display:flex;align-items:center;gap:16px;flex-shrink:0;}
.p-avatar{width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,var(--a),var(--a2));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#fff;flex-shrink:0;}
.p-info{flex:1;min-width:0;}
.p-name{font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.p-sub{font-size:12px;color:var(--m);margin-top:2px;}
.tier-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:4px;flex-shrink:0;}
.tier-platinum{background:#f0ebff;color:#6f42c1;border:1px solid #d4b8ff;}
.tier-gold{background:#fff8e1;color:#996500;border:1px solid #ffd54f;}
.tier-silver{background:#f0f4f8;color:#4a6785;border:1px solid #b0c4d8;}
.tier-authorised{background:#e8f5ee;color:#2d9e5f;border:1px solid #a8d5b8;}
.tier-default{background:var(--s2);color:var(--m);border:1px solid var(--b);}
.health-ring{width:50px;height:50px;flex-shrink:0;position:relative;}
.health-ring svg{transform:rotate(-90deg);}
.health-score{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;}
.p-actions{display:flex;gap:8px;flex-shrink:0;}
.p-btn{padding:6px 12px;border:1px solid var(--b);border-radius:var(--r);background:transparent;color:var(--m);font:600 11px var(--font);cursor:pointer;transition:color .15s,border-color .15s;}
.p-btn:hover{color:var(--a);border-color:var(--a);}
.p-btn.primary{background:linear-gradient(135deg,var(--a),var(--a2));border:none;color:#fff;}

/* ── Status pills row ── */
.pills-row{display:flex;gap:6px;padding:8px 20px;background:var(--s2);border-bottom:1px solid var(--b);flex-shrink:0;overflow-x:auto;flex-wrap:nowrap;}
.spill{font-size:11px;padding:3px 9px;border-radius:4px;white-space:nowrap;background:var(--s2);color:var(--m);border:1px solid var(--b);}
.spill strong{color:var(--t);}
.spill.green{background:#e8f5ee;color:var(--green);border-color:#a8d5b8;}
.spill.red{background:#ffeaea;color:var(--red);border-color:#f5b8b8;}
.spill.amber{background:#fff3e0;color:var(--amber);border-color:#ffd08a;}
.spill.blue{background:#e3f2fd;color:var(--blue);border-color:#90caf9;}

/* ── Tabs ── */
.tabs{display:flex;background:var(--s);border-bottom:1px solid var(--b);flex-shrink:0;overflow-x:auto;}
.tab{padding:10px 16px;font-size:12px;font-weight:600;cursor:pointer;color:var(--m);border-bottom:2px solid transparent;transition:color .15s,border-color .15s;white-space:nowrap;user-select:none;}
.tab:hover{color:var(--t);}
.tab.active{color:var(--a);border-bottom-color:var(--a);}

/* ── Content ── */
.content{flex:1;overflow-y:auto;padding:16px 20px;}

/* ── Metric cards ── */
.metrics-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px;}
.metric-card{background:var(--s);border:1px solid var(--b);border-radius:var(--r);padding:12px 14px;}
.mc-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:var(--dim);margin-bottom:6px;}
.mc-value{font-size:20px;font-weight:600;color:var(--t);}
.mc-sub{font-size:11px;color:var(--m);margin-top:3px;}
.mc-value.green{color:var(--green);}
.mc-value.amber{color:var(--amber);}
.mc-value.red{color:var(--red);}

/* ── Two-col ── */
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.three-col{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.section{background:var(--s);border:1px solid var(--b);border-radius:var(--r2);margin-bottom:12px;overflow:hidden;}
.section-head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--b);}
.section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--m);}
.section-count{font-size:11px;color:var(--dim);margin-left:auto;}
.section-body{padding:0;}

/* ── Data table ── */
.dtable{width:100%;border-collapse:collapse;}
.dtable th{padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--dim);text-align:left;border-bottom:1px solid var(--b);}
.dtable td{padding:8px 12px;font-size:12px;border-bottom:1px solid var(--b);vertical-align:middle;}
.dtable tr:last-child td{border-bottom:none;}
.dtable tr:hover td{background:var(--s2);}

/* ── Note cards ── */
.note-card{padding:10px 14px;border-bottom:1px solid var(--b);cursor:pointer;transition:background .1s;}
.note-card:hover{background:var(--s2);}
.note-card:last-child{border:none;}

/* Notes v2 — expanded by default, timeline-style */
.note-card-v2{padding:12px 16px;border-bottom:1px solid var(--b);transition:background .1s;}
.note-card-v2:hover{background:var(--s2);}
.note-card-v2:last-child{border-bottom:none;}
.note-head-row{display:flex;align-items:center;gap:10px;}
.note-head-row .note-subj{flex:1;font-weight:600;font-size:13px;color:var(--t);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.note-head-row .note-date{font-size:11px;color:var(--dim);flex-shrink:0;}
.note-meta-row{display:flex;gap:12px;margin-top:4px;font-size:11px;color:var(--m);}
.note-meta-row .note-poster{color:#6b8fa8;}
.note-meta-row .note-reminder{color:var(--amber);}
.note-body-v2{margin-top:8px;padding:10px 12px;background:var(--s2);border:1px solid var(--b);border-radius:var(--r);font-size:12px;line-height:1.55;white-space:pre-wrap;color:var(--t);max-height:320px;overflow-y:auto;}

.notes-filter-bar{display:flex;flex-wrap:wrap;gap:14px;padding:10px 16px;background:var(--s2);border-bottom:1px solid var(--b);}

/* ── Clickable license key (Keys tab) ── */
.key-link{color:var(--a);text-decoration:none;font-weight:600;border-bottom:1px dashed transparent;transition:border-color .1s,color .1s;}
.key-link:hover{color:var(--a2);border-bottom-color:var(--a2);}

/* ── Orders tab ── */
.order-link{color:var(--a);text-decoration:none;font-weight:600;}
.order-link:hover{text-decoration:underline;}
.order-status{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;padding:2px 7px;border-radius:4px;background:var(--s2);color:var(--m);border:1px solid var(--b);}
.order-status.green{background:#e8f5ee;color:var(--green);border-color:#a8d5b8;}
.order-status.amber{background:#fff3e0;color:var(--amber);border-color:#ffd08a;}
.order-status.red{background:#ffeaea;color:var(--red);border-color:#f5b8b8;}
.order-status.blue{background:#e3f2fd;color:var(--blue);border-color:#90caf9;}
.order-keys{padding:6px 8px !important;line-height:1.9;}
.order-key-chip{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-family:monospace;padding:3px 8px;margin-right:4px;border-radius:12px;background:var(--s2);border:1px solid var(--b);color:var(--t);text-decoration:none;transition:border-color .1s;white-space:nowrap;}
.order-key-chip:hover{border-color:var(--a2);color:var(--a);}
.order-key-ed{font-size:9px;font-weight:800;padding:1px 5px;border-radius:3px;letter-spacing:.3px;}
.order-nokey{color:var(--dim);font-size:11px;font-style:italic;}

/* ── Retired key rows ── */
.key-row-disabled{opacity:.55;}
.key-row-disabled:hover{opacity:.85;}
.key-retired-tag{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;padding:1px 5px;margin-left:5px;border-radius:3px;background:var(--s2);color:var(--m);border:1px solid var(--b);}

/* ── Quick Note modal ── */
.qn-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:998;display:none;}
.qn-backdrop.open{display:block;}
.qn-modal{position:fixed;top:70px;right:24px;width:380px;max-width:calc(100vw - 48px);background:var(--s);border:1px solid var(--b);border-radius:var(--r2);box-shadow:0 12px 40px rgba(0,0,0,.45);z-index:999;display:none;flex-direction:column;overflow:hidden;}
.qn-modal.open{display:flex;animation:qnIn .15s ease-out;}
@keyframes qnIn{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:none;}}
.qn-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--b);background:var(--s2);}
.qn-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--m);}
.qn-close{background:none;border:none;color:var(--m);font-size:22px;line-height:1;cursor:pointer;padding:0 4px;transition:color .1s;}
.qn-close:hover{color:var(--red);}
.qn-body{padding:12px 14px;display:flex;flex-direction:column;gap:9px;}
.qn-partner-hint{font-size:11px;color:var(--dim);}
.qn-partner-hint strong{color:var(--t);font-weight:600;}
.qn-row{display:flex;gap:8px;}
.qn-row select{flex:0 0 auto;}
.qn-row input{flex:1;}
.qn-modal input, .qn-modal select, .qn-modal textarea{background:var(--s2);border:1px solid var(--b);border-radius:var(--r);color:var(--t);font:12px var(--font);padding:6px 9px;outline:none;transition:border-color .1s;}
.qn-modal input:focus, .qn-modal select:focus, .qn-modal textarea:focus{border-color:var(--a);}
.qn-modal textarea{resize:vertical;min-height:90px;font-family:var(--font);line-height:1.5;}
.qn-customer{width:100%;}
.qn-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:2px;}
.qn-status{flex:1;font-size:11px;color:var(--dim);}
.qn-status.ok{color:var(--green);}
.qn-status.err{color:var(--red);}
.qn-status.busy{color:var(--a2);}
.note-top{display:flex;align-items:baseline;gap:8px;}
.note-badge{font-size:9px;font-weight:700;text-transform:uppercase;padding:1px 5px;border-radius:3px;flex-shrink:0;}
.nb-contact{background:#e3f2fd;color:#0077b6;}
.nb-support{background:#ffeaea;color:#dc3545;}
.nb-call{background:#e8f5ee;color:#2d9e5f;}
.nb-project{background:#f0ebff;color:#6f42c1;}
.nb-commitments{background:#fff3e0;color:#e67e00;}
.nb-email{background:#fffde7;color:#856404;}
.note-subj{font-size:12px;font-weight:500;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.note-date{font-size:10px;color:var(--dim);white-space:nowrap;}
.note-poster{font-size:10px;color:#6b8fa8;margin-top:2px;}
.note-body-expand{display:none;margin-top:6px;padding:7px 9px;background:var(--s2);border:1px solid var(--b);border-radius:var(--r);font-size:11px;line-height:1.6;white-space:pre-wrap;max-height:120px;overflow-y:auto;}
.note-card.open .note-body-expand{display:block;}

/* ── Post note form ── */
.form-row{display:flex;gap:10px;margin-bottom:10px;}
.form-group{display:flex;flex-direction:column;gap:4px;flex:1;}
.form-group label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--dim);}
.form-group input,.form-group select,.form-group textarea{background:var(--s2);border:1px solid var(--b);border-radius:var(--r);color:var(--t);font:13px var(--font);padding:7px 10px;outline:none;width:100%;transition:border-color .15s;}
.form-group input:focus,.form-group select:focus,.form-group textarea:focus{border-color:var(--a);}
.form-group textarea{resize:vertical;min-height:100px;line-height:1.5;}
.form-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;}
.btn{padding:8px 16px;border:none;border-radius:var(--r);font:600 12px var(--font);cursor:pointer;transition:opacity .15s;}
.btn:disabled{opacity:.45;cursor:not-allowed;}
.btn-primary{background:linear-gradient(135deg,var(--a),var(--a2));color:#fff;}
.btn-primary:hover:not(:disabled){opacity:.9;}
.btn-secondary{background:var(--b);color:var(--m);}
.btn-ai{background:linear-gradient(135deg,#7c4dff,#651fff);color:#fff;}
.btn-ai:hover:not(:disabled){opacity:.9;}

/* ── Gmail / Comms ── */
.email-card{padding:10px 14px;border-bottom:1px solid var(--b);cursor:pointer;transition:background .1s;}
.email-card:hover{background:var(--s2);}
.email-top{display:flex;gap:8px;align-items:baseline;}
.email-cat{font-size:9px;font-weight:700;text-transform:uppercase;padding:1px 5px;border-radius:3px;flex-shrink:0;}
.ec-transcription{background:#e8f5ee;color:#2d9e5f;}
.ec-partner_comm{background:#e3f2fd;color:#0077b6;}
.ec-lead{background:#fff3e0;color:#e67e00;}
.ec-reseller_prospect{background:#f0ebff;color:#6f42c1;}
.ec-provider{background:var(--s2);color:var(--m);}
.email-subj{font-size:12px;font-weight:500;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.email-age{font-size:10px;color:var(--dim);}
.email-meta{font-size:11px;color:var(--m);margin-top:2px;}
.mood-pill{display:inline-block;font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:6px;}
.mp-positive{background:#e8f5ee;color:#2d9e5f;}
.mp-neutral{background:var(--s2);color:var(--m);}
.mp-at_risk{background:#ffeaea;color:#dc3545;}

/* ── AI bar ── */
.ai-bar{padding:10px 16px;background:#f0ebff;border-top:1px solid #d4b8ff;font-size:12px;line-height:1.6;color:#5a3d8a;flex-shrink:0;min-height:40px;}
.ai-bar .ai-label{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6f42c1;margin-right:8px;}

/* ── Status / empty ── */
.loading{padding:40px;text-align:center;color:var(--dim);font-size:13px;}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid var(--b);border-top-color:var(--a);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px;}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{padding:32px;text-align:center;color:var(--dim);font-size:12px;}

/* ── Renewal radar ── */
.renewal-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--b);}
.renewal-row:last-child{border:none;}
.rr-name{flex:1;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rr-tier{font-size:10px;padding:1px 5px;border-radius:3px;flex-shrink:0;}
.rr-due{font-size:11px;font-weight:600;flex-shrink:0;}
.rr-due.overdue{color:var(--red);}
.rr-due.soon{color:var(--amber);}
.rr-due.ok{color:var(--green);}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--b2);border-radius:3px;}
::-webkit-scrollbar-thumb:hover{background:var(--dim);}
</style>
</head>
<body>

<!-- Top bar -->
<div class="topbar">
  <div class="logo">3</div>
  <h1>Partner PRM</h1>
  <div class="divider"></div>
  <div class="search-wrap">
    <span class="si">⌕</span>
    <input type="text" id="searchInput" placeholder="Search partners…" autocomplete="off" />
    <div id="searchDrop"></div>
  </div>
  <div class="sp"></div>
  <div class="pill" id="btnSync">↻ Sync</div>
  <div class="pill" id="btnGmail">✉ Gmail</div>
  <div id="sessionDot" title="Checking session…"></div>
</div>

<!-- Layout -->
<div class="layout">

  <!-- Sidebar -->
  <div class="sidebar">
    <div class="sidebar-header">Partners</div>
    <div class="sidebar-filter">
      <input type="text" id="sidebarSearch" placeholder="Search partners…" autocomplete="off" />
      <div class="chip-group" id="levelChips">
        <div class="chip-group-label">Level</div>
        <div class="chip-row" id="levelChipRow">
          <div class="chip active" data-level="">All</div>
          <div class="chip" data-level="12">Titanium</div>
          <div class="chip" data-level="9">Platinum</div>
          <div class="chip" data-level="2">Gold</div>
          <div class="chip" data-level="3">Silver</div>
          <div class="chip" data-level="10">Bronze</div>
          <div class="chip" data-level="11">Trainee</div>
          <div class="chip" data-level="8">Affiliate</div>
        </div>
      </div>
      <div class="chip-group" id="agentChips" style="display:none">
        <div class="chip-group-label">Team Agent</div>
        <div class="chip-row" id="agentChipRow"></div>
      </div>
    </div>
    <div class="partner-list" id="partnerList">
      <div class="loading"><span class="spinner"></span>Loading…</div>
    </div>
    <div class="sidebar-settings">
      <div class="settings-field">
        <label>OpenAI Key</label>
        <input type="password" id="cfgOpenai" placeholder="sk-…" />
      </div>
      <div class="settings-field">
        <label>Sheet ID</label>
        <input type="text" id="cfgSheet" placeholder="Google Sheet ID" />
      </div>
      <button class="btn-save" id="btnSave">Save Settings</button>
    </div>
  </div>

  <!-- Main -->
  <div class="main" id="main">
    <div class="loading" style="margin:auto"><span class="spinner"></span>Select a partner to begin</div>
  </div>

</div>

<!-- Quick Note modal (anchored top-right, under the +Note button) -->
<div class="qn-backdrop" id="qnBackdrop"></div>
<div class="qn-modal" id="qnModal" role="dialog" aria-modal="true" aria-labelledby="qnTitle">
  <div class="qn-head">
    <div id="qnTitle" class="qn-title">Quick Note</div>
    <button class="qn-close" id="qnClose" aria-label="Close">×</button>
  </div>
  <div class="qn-body">
    <div class="qn-partner-hint" id="qnPartnerHint"></div>
    <div class="qn-row">
      <select id="qnType">
        <option value="0">Contact</option><option value="1">Support</option>
        <option value="2" selected>Call</option><option value="3">Project</option>
        <option value="4">Commitments</option><option value="5">Email</option>
      </select>
      <input type="text" id="qnSubject" placeholder="Subject…" />
    </div>
    <select id="qnCustomer" class="qn-customer">
      <option value="">Add customer to subject (optional)</option>
    </select>
    <textarea id="qnBody" rows="5" placeholder="Note body…"></textarea>
    <div class="qn-actions">
      <span id="qnStatus" class="qn-status"></span>
      <button class="btn btn-primary" id="qnPost">Post →</button>
    </div>
  </div>
</div>

<!-- AI bar -->
<div class="ai-bar" id="aiBar">
  <span class="ai-label">✦ AI</span>
  <span id="aiText">Select a partner and I'll analyse their situation.</span>
</div>

<script src="dashboard.js"></script>
</body>
</html>
