// ============================================================
// 3CX Partner PRM  |  background.js  (service worker)
// ============================================================
// Handles ALL data fetching:
//   • staff.3cx.com scraping  (partner 360, all tabs)
//   • Google Sheet reading    (Gmail classifications from GAS)
//   • OpenAI API              (summaries, next best action)
//   • Session health check    (Cloudflare + ASP.NET)
// ============================================================

const BASE       = 'https://staff.3cx.com';
const EDIT_PATH  = '/partner/edit.aspx';
const CF_DOMAIN  = 'staff.3cx.com';

// ── Auth / session ────────────────────────────────────────────────────────────

async function checkSessionHealth() {
  const get = name => new Promise(r => chrome.cookies.get({ url: `https://${CF_DOMAIN}`, name }, r));
  const [cfAuth, erpAuth, sessionId, antiXsrf, cfApp] = await Promise.all([
    get('CF_Authorization'), get('.ERPAUTH'), get('ASP.NET_SessionId'),
    get('__AntiXsrfToken'), get('CF_AppSession')
  ]);
  const issues = [];
  let sessionInfo = null;

  // ── Cloudflare layer ──────────────────────────────────────────────────────
  // Either CF_Authorization JWT OR CF_AppSession is enough to confirm CF layer.
  // Try to decode JWT for expiry info but never fail just because decode throws.
  const hasCfLayer = !!(cfAuth || cfApp);
  if (!hasCfLayer) {
    issues.push({ code:'CF_EXPIRED', msg:'Not signed in — open staff.3cx.com and log in via Google' });
  } else if (cfAuth) {
    try {
      const parts = cfAuth.value.split('.');
      if (parts.length >= 2) {
        // Fix base64 padding robustly
        const raw  = parts[1].replace(/-/g,'+').replace(/_/g,'/');
        const pad  = raw.length % 4 === 0 ? '' : '='.repeat(4 - raw.length % 4);
        const p    = JSON.parse(atob(raw + pad));
        const now  = Math.floor(Date.now()/1000);
        const mins = Math.round(((p.exp ?? 0) - now) / 60);
        if (p.exp && now >= p.exp) {
          issues.push({ code:'CF_EXPIRED', msg:`Cloudflare session expired ${Math.abs(mins)}min ago — log in again` });
        }
        sessionInfo = {
          email:     p.email ?? 'unknown',
          minsLeft:  mins,
          expiresAt: p.exp ? new Date(p.exp*1000).toLocaleTimeString() : '?'
        };
      }
    } catch(e) {
      // JWT decode failed — cookie exists so we assume CF layer is OK.
      // Log for debugging but don't block.
      console.warn('PRM: CF_Authorization decode failed (non-fatal):', e.message);
      sessionInfo = { email: 'signed in', minsLeft: 999, expiresAt: '?' };
    }
  }

  // ── ASP.NET app layer ─────────────────────────────────────────────────────
  // Only ERPAUTH is strictly required — SessionId and AntiXsrf regenerate on
  // first request if missing, so treat them as warnings not hard failures.
  if (!erpAuth) {
    issues.push({ code:'APP_EXPIRED', msg:'Staff portal session expired — reload staff.3cx.com' });
  }
  // Soft warnings (don't block the green dot)
  const warnings = [];
  if (!sessionId) warnings.push('ASP.NET_SessionId absent');
  if (!antiXsrf)  warnings.push('__AntiXsrfToken absent');

  return {
    healthy:  issues.length === 0,
    issues,
    warnings,
    sessionInfo,
    // Raw cookie presence for debugging
    cookies: {
      cf_authorization: !!cfAuth,
      cf_app_session:   !!cfApp,
      erpauth:          !!erpAuth,
      session_id:       !!sessionId,
      anti_xsrf:        !!antiXsrf,
    }
  };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function extractFormFields(html) {
  const r = {};
  let m;
  const inputRe = /<input\b([^>]+)>/gi;
  while ((m=inputRe.exec(html))!==null) {
    const a=m[1], nm=a.match(/\bname="([^"]+)"/i), vm=a.match(/\bvalue="([^"]*)"/i), tm=a.match(/\btype="([^"]+)"/i);
    if (!nm) continue;
    const t=(tm?.[1]??'text').toLowerCase();
    if (['submit','image','button'].includes(t)) continue;
    if (['checkbox','radio'].includes(t)) { if (/\bchecked\b/i.test(a)) r[nm[1]]=vm?vm[1]:'on'; continue; }
    r[nm[1]] = vm?vm[1]:'';
  }
  const selRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((m=selRe.exec(html))!==null) {
    const nm=m[1].match(/\bname="([^"]+)"/i); if (!nm) continue;
    const sel=m[2].match(/value="([^"]*)"[^>]*selected/i)||m[2].match(/<option\b[^>]*value="([^"]*)"/i);
    if (sel) r[nm[1]]=sel[1];
  }
  const taRe = /<textarea\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/gi;
  while ((m=taRe.exec(html))!==null) r[m[1]]=m[2];
  return r;
}

function parseUpdatePanel(text) {
  const s={}; let pos=0;
  while (pos<text.length) {
    const le=text.indexOf('|',pos); if(le===-1) break;
    const len=parseInt(text.substring(pos,le),10); if(isNaN(len)) break;
    const te=text.indexOf('|',le+1); if(te===-1) break;
    const ie=text.indexOf('|',te+1); if(ie===-1) break;
    s[text.substring(te+1,ie)]={type:text.substring(le+1,te),content:text.substring(ie+1,ie+1+len)};
    pos=ie+1+len+1;
  }
  return s;
}

function detectAuthFailure(html) {
  if (html.includes('login.3cx.com')||html.includes('Account/ExternalLogin'))
    return { failed:true, code:'CF_EXPIRED', msg:'Cloudflare session expired — log in at staff.3cx.com' };
  if (html.includes('cf-turnstile'))
    return { failed:true, code:'CF_CHALLENGE', msg:'Cloudflare challenge — open staff.3cx.com in a tab' };
  if (html.includes('id="loginForm"'))
    return { failed:true, code:'APP_EXPIRED', msg:'Staff portal session expired' };
  return { failed:false };
}

function htmlDecode(s) {
  return String(s??'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#160;/g,' ').replace(/&nbsp;/g,' ').trim();
}

// ── Table parser — nested-table-safe ────────────────────────────────────────
// Finds <table id="Main_dg"> and extracts full content using depth counting.
// First row always treated as headers (staff.3cx.com uses <td> not <th>).

function extractMainDgHtml(html) {
  const tableIdx = html.indexOf('id="Main_dg"');
  if (tableIdx === -1) return null;
  const tableStart = html.lastIndexOf('<table', tableIdx);
  if (tableStart === -1) return null;
  let depth = 0, pos = tableStart, tableEnd = -1;
  while (pos < html.length) {
    const no = html.indexOf('<table', pos);
    const nc = html.indexOf('</table>', pos);
    if (nc === -1) break;
    if (no !== -1 && no < nc) { depth++; pos = no + 6; }
    else { depth--; if (depth === 0) { tableEnd = nc + 8; break; } pos = nc + 8; }
  }
  return tableEnd > 0 ? html.substring(tableStart, tableEnd) : html.substring(tableStart);
}

function parseMainDg(html) {
  const tableHtml = extractMainDgHtml(html);
  if (!tableHtml) return { headers: [], rows: [], rowAttrs: [] };
  const rowMatches = [...tableHtml.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  if (!rowMatches.length) return { headers: [], rows: [], rowAttrs: [] };
  // First row = headers
  const headerCells = [...rowMatches[0][2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(m => htmlDecode(m[1].replace(/<[^>]+>/g, '')).trim());
  const rows = [];
  const rowAttrs = [];
  for (let i = 1; i < rowMatches.length; i++) {
    const cells = [...rowMatches[i][2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (!cells.length) continue;
    rows.push(cells);
    rowAttrs.push(rowMatches[i][1] || '');
  }
  return { headers: headerCells, rows, rowAttrs };
}

function isDisabledRow(attrStr) {
  const m = (attrStr || '').match(/\bclass="([^"]*)"/i);
  return m ? /\bdisabled\b/.test(m[1]) : false;
}

// Backward-compat wrapper
function parseDatagrid(html) {
  const { headers, rows } = parseMainDg(html);
  if (!rows.length) return [];
  const cleanRows = rows.map(cells =>
    cells.map(c => htmlDecode(c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')))
  );
  return [{ headers, rows: cleanRows }];
}

function rowsToObjects(headers, rows) {
  return rows.map(cells => {
    const obj = {};
    headers.forEach((h, i) => { if (h.trim()) obj[h.trim()] = cells[i] ?? ''; });
    return obj;
  });
}

// Cell value helpers
function cellText(raw) {
  if (!raw) return '';
  const t = raw.match(/title="([^"]+)"/);
  if (t) return htmlDecode(t[1]);
  return htmlDecode(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// ── License keys parser ───────────────────────────────────────────────────────
// Columns (keys.aspx): [0]chk [1]key [2]product [3]purchased [4]activatedOn
//   [5]SC [6]L2 [7]maxExt [8]expiry [9]version [10]issuedTo [11]reseller
//   [12]registration [13]assignedUser [14]activations [15]LE [16]PoC

function parseKeysHtml(html) {
  const { rows, rowAttrs } = parseMainDg(html);
  return rows.map((cells, i) => {
    if (cells.length < 9) return null;
    const disabled = isDisabledRow(rowAttrs[i]);
    const prodMain = htmlDecode((cells[2].match(/lblProductDescription[^>]*>([^<]+)/) || [])[1] || '');
    const prodBill = htmlDecode((cells[2].match(/lblAdditionalDescription[^>]*>([^<]+)/) || [])[1] || '');
    const product  = prodBill ? `${prodMain} (${prodBill})` : prodMain || cellText(cells[2]);
    // Extract key string + internal keyId from the LicenseKeyLink anchor
    const linkM    = cells[1].match(/LicenseKeyLink_\d+"[^>]*href="([^"]*)"[^>]*>([^<]+)</);
    const keyHref  = linkM ? htmlDecode(linkM[1].replace(/&amp;/g, '&')) : '';
    const keyIdM   = keyHref.match(/[?&]i=(\d+)/);
    const keyStr   = linkM ? htmlDecode(linkM[2]).trim() : cellText(cells[1]);
    return {
      key:          keyStr,
      keyId:        keyIdM ? keyIdM[1] : '',
      disabled,
      product,
      purchased:    cellText(cells[3]),
      activatedOn:  cellText(cells[4]),
      sc:           cellText(cells[5]),
      maxExt:       cellText(cells[7]),
      expiry:       cellText(cells[8]),
      version:      cellText(cells[9]),
      issuedTo:     cellText(cells[10]),
      reseller:     cellText(cells[11]).replace(/\s+/g, ' ').trim(),
      registration: cellText(cells[12]).replace(/\s+/g, ' ').trim(),
      assignedUser: cellText(cells[13]),
      activations:  cellText(cells[14]),
    };
  }).filter(Boolean).filter(k => k.key);
}

// ── Orders parser ─────────────────────────────────────────────────────────────
// Extracts only the useful financial fields per order, dropping the duplicate
// From (seller = 3CX Ltd) and s (buyer = your own company) address blocks.
function parseOrdersHtml(html) {
  const { rows, rowAttrs } = parseMainDg(html);
  const orders = [];
  rows.forEach((cells, i) => {
    if (isDisabledRow(rowAttrs[i])) return;
    // Combine all cell HTML so we can fish fields by label id regardless of column count
    const raw = cells.join('');
    const lbl = (field) => {
      const m = raw.match(new RegExp(`<span[^>]*\\bid="Main_dg_lbl${field}_\\d+"[^>]*>([\\s\\S]*?)<\\/span>`, 'i'));
      return m ? htmlDecode(m[1].replace(/<[^>]+>/g, '')).trim().replace(/\s+/g, ' ') : '';
    };
    // Order number (hyperlinked to order/view.aspx)
    const orderLinkM = raw.match(/<a[^>]*\bid="Main_dg_HyperLink0_\d+"[^>]*href="([^"]*)"[^>]*>([^<]+)</);
    const orderHref  = orderLinkM ? htmlDecode(orderLinkM[1].replace(/&amp;/g, '&')) : '';
    const orderIdM   = orderHref.match(/[?&]i=(\d+)/);
    const orderNo    = orderLinkM ? htmlDecode(orderLinkM[2]).trim() : '';

    if (!orderNo && !lbl('Amount')) return;

    orders.push({
      orderNo,
      orderId:    orderIdM ? orderIdM[1] : '',
      orderUrl:   orderHref ? (orderHref.startsWith('http') ? orderHref : `https://staff.3cx.com/${orderHref.replace(/^\//, '')}`) : '',
      status:     lbl('Status'),
      proformaNo: lbl('ProformaNo'),
      created:    lbl('Created'),
      country:    lbl('PostCountry'),
      payment:    lbl('Payment'),
      txnId:      lbl('TxnID'),
      currency:   lbl('CurrencyID'),
      amount:     lbl('Amount'),
      tax:        lbl('Tax'),
    });
  });
  return orders;
}

// ── Users parser ──────────────────────────────────────────────────────────────
// Parses the Users tab grid (id="Main_CustomerEditUsers_dg"). Each row is a
// partner user with roles, cert level, and last-login.
function parseUsersHtml(html) {
  const tblIdx = html.indexOf('id="Main_CustomerEditUsers_dg"');
  if (tblIdx < 0) return [];
  const tblStart = html.lastIndexOf('<table', tblIdx);
  const tblEnd   = html.indexOf('</table>', tblIdx);
  if (tblStart < 0 || tblEnd < 0) return [];
  const tbl = html.substring(tblStart, tblEnd + 8);

  const rowMatches = [...tbl.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  if (rowMatches.length < 2) return [];

  const users = [];
  for (let i = 1; i < rowMatches.length; i++) {
    const attrs = rowMatches[i][1];
    if (isDisabledRow(attrs)) continue;  // (no disabled rows seen yet, but safe)
    const cellsRaw = [...rowMatches[i][2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (cellsRaw.length < 8) continue;
    const strip = (s) => htmlDecode(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const emailCell = cellsRaw[2];
    const userHrefM = emailCell.match(/href="[^"]*\/user\/edit\.aspx\?i=(\d+)"/i);
    const roles = strip(cellsRaw[4]).split(/,\s*/).filter(Boolean);
    users.push({
      firstName: strip(cellsRaw[0]),
      lastName:  strip(cellsRaw[1]),
      email:     strip(cellsRaw[2]),
      userId:    userHrefM ? userHrefM[1] : '',
      phone:     strip(cellsRaw[3]),
      roles,
      cert:      strip(cellsRaw[5]),
      status:    strip(cellsRaw[6]),
      lastLogin: strip(cellsRaw[7]),
    });
  }
  return users;
}

function parseTableById(html, tableId) {
  const idx = html.indexOf(`id="${tableId}"`);
  if (idx < 0) return [];
  const tblStart = html.lastIndexOf('<table', idx);
  if (tblStart < 0) return [];
  // Depth count to handle nesting
  let depth = 0, pos = tblStart, tblEnd = -1;
  while (pos < html.length) {
    const no = html.indexOf('<table', pos);
    const nc = html.indexOf('</table>', pos);
    if (nc < 0) break;
    if (no >= 0 && no < nc) { depth++; pos = no + 6; }
    else { depth--; if (depth === 0) { tblEnd = nc + 8; break; } pos = nc + 8; }
  }
  const tblHtml = html.substring(tblStart, tblEnd > 0 ? tblEnd : html.length);
  const rows = [...tblHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rows.length < 2) return [];
  // Header row uses <td class="l"> not <th>
  const headers = [...rows[0][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(m => htmlDecode(m[1].replace(/<[^>]+>/g, '')).trim());
  return rows.slice(1).map(row => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    const obj = {};
    headers.forEach((h, i) => {
      if (h && cells[i] !== undefined) {
        // Extract href for email/link cells
        const hrefM = cells[i].match(/href="\/user\/edit\.aspx\?i=(\d+)"/);
        obj[h] = htmlDecode(cells[i].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        if (hrefM) obj[h + '_id'] = hrefM[1];
      }
    });
    return obj;
  }).filter(r => Object.values(r).some(v => v));
}

// ── parseBillingHtml — extract billing fields from form ──────────────────────
function parseBillingHtml(html) {
  const get = (id) => {
    const m = html.match(new RegExp(`id="Main_CustomerEditBilling_${id}"[^>]*value="([^"]*)"`));
    return m ? htmlDecode(m[1]) : '';
  };
  const getSel = (id) => {
    const m = html.match(new RegExp(`id="Main_CustomerEditBilling_${id}"[^>]*>([\\s\\S]*?)<\\/select>`));
    if (!m) return '';
    const sel = m[1].match(/value="([^"]*)"[^>]*selected/i);
    if (!sel) return '';
    const label = m[1].match(new RegExp(`value="${sel[1]}"[^>]*>([^<]+)`));
    return label ? htmlDecode(label[1].trim()) : sel[1];
  };
  return {
    address:    get('tbAddressLine1'),
    city:       get('tbCity'),
    zip:        get('tbZipCode'),
    country:    getSel('ddlCountry'),
    state:      getSel('ddlState'),
    vat:        get('tbVat'),
    sageId:     get('tbSageID'),
    currency:   getSel('ddlCurrency'),
    payMethod:  getSel('ddlPaymentMethod'),
  };
}

// ── parseCertificationsHtml — extract cert exam results ─────────────────────
function parseCertificationsHtml(html) {
  const results = [];
  // Find all TestAttemptGrid_N tables
  const gridIds = [...new Set([...html.matchAll(/id="(Main_CustomerEditCertification_TestAttemptGrid_\d+)"/gi)]
    .map(m => m[1]))];
  for (const gid of gridIds) {
    const rows = parseTableById(html, gid);
    // Columns: exam name, date, start, end, lang, score, email, total q, correct q, serial
    rows.forEach(row => {
      const vals = Object.values(row).map(v => v?.toString() ?? '');
      if (vals[0]) {
        results.push({
          exam:    vals[0],
          date:    vals[1] ?? '',
          email:   vals[6] ?? '',
          score:   vals[8] && vals[7] ? `${vals[8]}/${vals[7]}` : '',
          passed:  vals[8] && vals[7] ? parseInt(vals[8]) >= parseInt(vals[7]) * 0.6 : false,
        });
      }
    });
  }
  return results;
}


// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const r = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'text/html,application/xhtml+xml', 'Referer': BASE }
  });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  const html = await r.text();
  const fail = detectAuthFailure(html);
  if (fail.failed) throw Object.assign(new Error(fail.msg), { code: fail.code });
  return html;
}

async function fetchPartnerPage(partnerId) {
  return fetchPage(`${BASE}${EDIT_PATH}?i=${encodeURIComponent(partnerId)}`);
}

async function postPanel(partnerId, formData) {
  const url = `${BASE}${EDIT_PATH}?i=${encodeURIComponent(partnerId)}`;
  const r = await fetch(url, {
    method: 'POST', credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': '*/*', 'Origin': BASE, 'Referer': `${BASE}/`,
      'X-MicrosoftAjax': 'Delta=true', 'X-Requested-With': 'XMLHttpRequest'
    },
    body: new URLSearchParams(formData).toString()
  });
  if (!r.ok) throw new Error(`POST partner/edit → ${r.status}`);
  return r.text();
}

// ── Tab fetcher (generic) ─────────────────────────────────────────────────────

async function fetchTab(partnerId, fields, eventTarget) {
  const tabFields = {
    ...fields,
    '__ASYNCPOST':'true',
    '__EVENTTARGET': eventTarget,
    '__EVENTARGUMENT':'',
    'ctl00$ScriptManager1': `ctl00$Main$CustomerEditUpdatePanel|${eventTarget}`
  };
  // Remove any lingering button values
  ['ctl00$Main$CustomerNotes$AddBtn','ctl00$Main$CustomerNotes$OKBtn'].forEach(k=>delete tabFields[k]);
  return postPanel(partnerId, tabFields);
}

// ── Partner 360 — fetch all tabs ──────────────────────────────────────────────

async function fetchPartner360(partnerId) {
  broadcast('partner360_status', 'Loading partner page…');
  const html   = await fetchPartnerPage(partnerId);
  const fields = extractFormFields(html);

  // ── Extract basic info (attribute-order-agnostic) ─────────────────────────
  // 3CX renders input tags as: name="..." type="..." value="..." ... id="..."
  // so we match the whole tag by id then pull value/content out of it.
  const inputVal = (id) => {
    const tag = html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`, 'i'));
    if (!tag) return '';
    const v = tag[0].match(/\bvalue="([^"]*)"/);
    return v ? htmlDecode(v[1]) : '';
  };
  const textAreaVal = (id) => {
    const m = html.match(new RegExp(`<textarea[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/textarea>`, 'i'));
    return m ? htmlDecode(m[1]) : '';
  };
  const labelText = (id) => {
    const m = html.match(new RegExp(`<span[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/span>`, 'i'));
    return m ? htmlDecode(m[1].replace(/<[^>]+>/g, '')).trim() : '';
  };
  const selectedOption = (id) => {
    const sel = html.match(new RegExp(`<select[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/select>`, 'i'));
    if (!sel) return '';
    const m = sel[1].match(/<option[^>]*\bselected[^>]*>([^<]+)/i) ||
              sel[1].match(/value="[^"]*"[^>]*selected[^>]*>([^<]+)/i);
    return m ? htmlDecode(m[1]).trim() : '';
  };
  const checkboxChecked = (id) =>
    !!html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*\\bchecked\\b`, 'i'));

  const base = {
    id:          partnerId,
    publicId:    labelText('Main_CustomerEditGeneral_lblSupportCustID'),  // 3CX external partner ID
    company:     inputVal('Main_CustomerEditContact_tbCompany'),
    contact:     `${inputVal('Main_CustomerEditContact_tbContactFirstName')} ${inputVal('Main_CustomerEditContact_tbContactLastName')}`.trim(),
    email:       inputVal('Main_CustomerEditContact_tbEmail'),
    phone:       inputVal('Main_CustomerEditContact_tbPhone'),
    website:     inputVal('Main_CustomerEditContact_tbURL'),
    description: textAreaVal('Main_CustomerEditBanner_tbProfileDescription'),
    type:        selectedOption('Main_CustomerEditGeneral_ddlCustomerType'),
    category:    selectedOption('Main_CustomerEditGeneral_ddlPartnerCategories'),
    enabled:     checkboxChecked('Main_CustomerEditGeneral_cbEnabled'),
    sageId:      inputVal('Main_CustomerEditBilling_tbSageID'),
    address:     [
                   inputVal('Main_CustomerEditBilling_tbAddressLine1'),
                   inputVal('Main_CustomerEditBilling_tbCity'),
                   inputVal('Main_CustomerEditBilling_tbZipCode')
                 ].filter(Boolean).join(', '),
    country:     selectedOption('Main_CustomerEditBilling_ddlCountry'),
    revenue:     labelText('Main_CustomerEditGeneral_lblRevenue'),
    upToDate:    labelText('Main_CustomerEditGeneral_lblCustomersUpToDate'),
    supportPin:  labelText('Main_CustomerEditGeneral_lblSupportPIN'),
    discounts:   {
      product:     inputVal('Main_CustomerEditGeneral_tbProductDiscount')     || '0',
      maintenance: inputVal('Main_CustomerEditGeneral_tbMaintenanceDiscount') || '0',
      hosting:     inputVal('Main_CustomerEditGeneral_tbHostingDiscount')     || '0'
    },
    fetchedAt: Date.now()
  };

  // Fetch tabs sequentially (share VIEWSTATE)
  const tabs = [
    { key:'users',    target:'ctl00$Main$btnUsers' },
    { key:'billing',  target:'ctl00$Main$btnBilling' },
    { key:'certs',    target:'ctl00$Main$btnCertification' },
    { key:'notes',    target:'ctl00$Main$btnNotes' },
    { key:'points',   target:'ctl00$Main$btnPoints' },
    { key:'stats',    target:'ctl00$Main$btnStatistics' },
  ];

  const tabData = {};
  let currentFields = { ...fields };

  for (const tab of tabs) {
    try {
      broadcast('partner360_status', `Loading ${tab.key}…`);
      const resp = await fetchTab(partnerId, currentFields, tab.target);
      const sections = parseUpdatePanel(resp);
      // Update VIEWSTATE for next call
      if (sections['__VIEWSTATE']?.content) currentFields['__VIEWSTATE'] = sections['__VIEWSTATE'].content;
      // Parse datagrid tables from the update panel HTML
      const allHtml = Object.values(sections).map(s=>s.content).join('\n');
      if (tab.key === 'users') {
        // Specialist: users grid has id="Main_CustomerEditUsers_dg", not "Main_dg"
        tabData.users = parseUsersHtml(allHtml);
        console.log(`[users] parsed ${tabData.users.length} users`);
      } else {
        const grids = parseDatagrid(allHtml);
        tabData[tab.key] = grids.map(g => rowsToObjects(g.headers, g.rows));
      }
    } catch(e) {
      tabData[tab.key] = [];
      console.warn(`Tab ${tab.key} failed:`, e.message);
    }
  }

  // Keys — dedicated page with specialist parser
  // Staff portal's pagination is STATEFUL across sessions — it remembers which page
  // the user last visited. So our initial GET may land on any page. We detect the
  // current page and rewind to page 1 before collecting.
  try {
    broadcast('partner360_status', 'Loading keys…');
    let keysHtml    = await fetchPage(`${BASE}/keys.aspx?c=${partnerId}`);
    let keysFields  = extractFormFields(keysHtml);

    const postKeysPage = async (button) => {
      const body = {
        ...keysFields,
        '__EVENTTARGET':   `ctl00$Main$NavigatorControl$${button}`,
        '__EVENTARGUMENT': '',
        '__ASYNCPOST':     'true',
        'ctl00$ScriptManager1': `ctl00$Main$LicenseKeysUpdatePanel|ctl00$Main$NavigatorControl$${button}`,
      };
      const r = await fetch(`${BASE}/keys.aspx?c=${partnerId}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': '*/*', 'Origin': BASE, 'X-MicrosoftAjax': 'Delta=true',
          'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams(body).toString()
      });
      const rt    = await r.text();
      const sects = parseUpdatePanel(rt);
      if (sects['__VIEWSTATE']?.content) keysFields['__VIEWSTATE'] = sects['__VIEWSTATE'].content;
      return Object.values(sects).map(s => s.content).join('\n');
    };

    // If we landed past page 1, rewind via FirstButton
    const curM  = keysHtml.match(/Page (\d+) of (\d+)/);
    const startPage = curM ? parseInt(curM[1]) : 1;
    const totalPages = curM ? parseInt(curM[2]) : 1;
    console.log(`[keys] initial page=${startPage} of ${totalPages}`);
    if (startPage > 1) {
      try {
        keysHtml = await postKeysPage('FirstButton');
        console.log('[keys] rewound to FirstButton');
      } catch(e) {
        console.warn('[keys] FirstButton failed:', e.message);
      }
    }

    // Collect page 1
    tabData.keys = parseKeysHtml(keysHtml);
    console.log(`[keys] page 1: ${tabData.keys.length} rows`);

    // Forward-paginate up to 10 pages (stops if a page returns empty)
    for (let p = 2; p <= Math.min(totalPages, 10); p++) {
      try {
        const ph = await postKeysPage('NextButton');
        const pageKeys = parseKeysHtml(ph);
        console.log(`[keys] page ${p}: ${pageKeys.length} rows`);
        if (!pageKeys.length) break;
        tabData.keys.push(...pageKeys);
      } catch(e) {
        console.warn(`[keys] page ${p} failed:`, e.message);
        break;
      }
    }
    console.log(`[keys] final total: ${tabData.keys.length} rows`);
  } catch(e) {
    console.warn('Keys fetch failed:', e.message);
    tabData.keys = [];
  }

  // Orders — specialist parser (strips address boilerplate, keeps financial fields)
  try {
    broadcast('partner360_status', 'Loading orders…');
    const ordersHtml = await fetchPage(`${BASE}/orders.aspx?c=${partnerId}`);
    tabData.orders = parseOrdersHtml(ordersHtml);
  } catch(e) {
    tabData.orders = [];
  }

  // Leads — generic datagrid parse
  try {
    broadcast('partner360_status', 'Loading leads…');
    const html2 = await fetchPage(`${BASE}/leads.aspx?c=${partnerId}`);
    const grids = parseDatagrid(html2);
    tabData.leads = grids.map(g => rowsToObjects(g.headers, g.rows));
  } catch(e) {
    tabData.leads = [];
  }

  // Also parse notes specifically
  try {
    const notesHtml = Object.values(parseUpdatePanel(
      await fetchTab(partnerId, currentFields, 'ctl00$Main$btnNotes')
    )).map(s=>s.content).join('\n');
    tabData.notesParsed = parseNotesFromHtml(notesHtml);
  } catch(e) { tabData.notesParsed = []; }

  broadcast('partner360_status', 'Done');
  return { ...base, tabs: tabData };
}

// ── Notes parser (precise, from first HAR) ────────────────────────────────────

function parseNotesFromHtml(html) {
  const count = (html.match(/Main_CustomerNotes_dg_EditBtn_\d+/g)??[]).length;
  const notes = [];
  for (let i=0; i<count; i++) {
    const pos    = html.indexOf(`Main_CustomerNotes_dg_EditBtn_${i}`);
    const rowS   = html.lastIndexOf('<tr>',pos);
    const rowE   = html.indexOf('</tr>',rowS);
    if (rowS===-1||rowE===-1) continue;
    const row    = html.substring(rowS,rowE+5);
    const tds    = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
                     .map(m=>htmlDecode(m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')));
    if (tds.length<6) continue;
    notes.push({ index:i, type:tds[2]??'', modified:tds[3]??'', reminder:tds[4]??'',
                 poster:tds[5]??'', subject:tds[6]??'', body:tds[7]??'' });
  }
  return notes;
}

// ── Post note (3-step UpdatePanel flow) ───────────────────────────────────────

async function postCallNote({ partnerId, subject, body, noteType=2 }) {
  const trace = { partnerId, steps: [] };
  const logStep = (name, detail) => {
    trace.steps.push({ name, ...detail });
    console.log(`[postNote] ${name}`, detail);
  };
  try {
    const health = await checkSessionHealth();
    if (!health.healthy) throw Object.assign(new Error(health.issues[0].msg),{code:health.issues[0].code});

    const html   = await fetchPartnerPage(partnerId);
    let fields   = extractFormFields(html);
    logStep('init', { htmlLen: html.length, fieldCount: Object.keys(fields).length, hasViewState: !!fields['__VIEWSTATE'] });

    // Step 1: btnNotes
    broadcast('note_progress','Opening Notes tab…');
    const s1 = { ...fields, '__ASYNCPOST':'true', '__EVENTTARGET':'ctl00$Main$btnNotes',
      '__EVENTARGUMENT':'', 'ctl00$ScriptManager1':'ctl00$Main$CustomerEditUpdatePanel|ctl00$Main$btnNotes' };
    delete s1['ctl00$Main$CustomerNotes$AddBtn']; delete s1['ctl00$Main$CustomerNotes$OKBtn'];
    const r1 = await postPanel(partnerId,s1);
    const sects1 = parseUpdatePanel(r1);
    const vs1 = sects1['__VIEWSTATE']?.content;
    logStep('step1_btnNotes', { responseLen: r1.length, sections: Object.keys(sects1).slice(0,10), hasViewState: !!vs1 });
    if (!vs1) throw new Error(`Step 1 (btnNotes) returned no VIEWSTATE. Response preview: ${r1.substring(0,200)}`);
    fields['__VIEWSTATE'] = vs1;

    // Step 2: AddBtn
    broadcast('note_progress','Opening Add Note…');
    const s2 = { ...fields, '__ASYNCPOST':'true', '__EVENTTARGET':'',
      'ctl00$Main$CustomerNotes$AddBtn':'Add New Note',
      'ctl00$Main$CustomerNotes$ddlNoteType':String(noteType),
      'ctl00$ScriptManager1':'ctl00$Main$CustomerNotes$CustomerNotesUpdatePanel|ctl00$Main$CustomerNotes$AddBtn' };
    delete s2['ctl00$Main$btnNotes'];
    const r2 = await postPanel(partnerId,s2);
    const sects2 = parseUpdatePanel(r2);
    const vs2 = sects2['__VIEWSTATE']?.content;
    logStep('step2_AddBtn', { responseLen: r2.length, sections: Object.keys(sects2).slice(0,10), hasViewState: !!vs2 });
    if (!vs2) throw new Error(`Step 2 (AddBtn) returned no VIEWSTATE. Response preview: ${r2.substring(0,200)}`);
    fields['__VIEWSTATE'] = vs2;

    // Step 3: OKBtn
    broadcast('note_progress','Saving…');
    const s3 = { ...fields, '__ASYNCPOST':'true', '__EVENTTARGET':'',
      'ctl00$Main$CustomerNotes$OKBtn':'OK',
      'ctl00$Main$CustomerNotes$tbSubject':subject,
      'ctl00$Main$CustomerNotes$tbBody':body,
      'ctl00$Main$CustomerNotes$ddlNoteType':String(noteType),
      'ctl00$ScriptManager1':'ctl00$Main$CustomerNotes$PopupUpdatePanel|ctl00$Main$CustomerNotes$OKBtn' };
    delete s3['ctl00$Main$CustomerNotes$AddBtn'];
    const r3 = await postPanel(partnerId,s3);
    const sects3 = parseUpdatePanel(r3);
    const err = sects3['Main_MessageBoxUpdatePanel']?.content?.trim()??'';
    logStep('step3_OKBtn', { responseLen: r3.length, sections: Object.keys(sects3).slice(0,10), hasError: !!err && err!=='&#160;' });
    if (err && err!=='&#160;' && !err.startsWith('<!--'))
      throw new Error(err.replace(/<[^>]+>/g,' ').trim().substring(0,200));

    console.log('[postNote] SUCCESS', trace);
    return { success:true, partnerId, subject, trace };
  } catch (e) {
    console.error('[postNote] FAILED at', trace.steps[trace.steps.length-1]?.name ?? 'init', '—', e.message);
    e.trace = trace;
    throw e;
  }
}

// ── Partner lookup ────────────────────────────────────────────────────────────

async function lookupPartner(partnerId) {
  const html     = await fetchPartnerPage(partnerId);
  const companyM = html.match(/id="Main_CustomerEditContact_tbCompany"[^>]*value="([^"]+)"/);
  const nameM    = html.match(/Edit Partner '([^']+)'/);
  return { id:partnerId, name:companyM?.[1]??nameM?.[1]??`Partner #${partnerId}` };
}

// ── Partner list (customers.aspx) ─────────────────────────────────────────────

// ── customers.aspx partner list parser ───────────────────────────────────────
// Table: id="Main_dg", class="datagrid"
// Headers: first <tr class="header"> uses <td> links (not <th>)
// API ID: from href="/partner/edit.aspx?i=XXXXX" in cell[2]
// Company: from title="Full Name" attribute in cell[2] div wrapper
// Pagination: 50/page, up to 43 pages via NavigatorControl$NextButton POST

async function fetchPartnerList() {
  const html1 = await fetchPage(`${BASE}/customers.aspx?m=1`);

  // Parse inline — same logic as debug handler (verified working)
  const page1 = parsePartnersFromHtml(html1);

  if (!page1.length) {
    throw new Error(`No partner data found on customers.aspx — HTML: ${html1.length} chars`);
  }

  // Check for additional pages
  const pageInfo  = html1.match(/Page 1 of (\d+)/);
  const totalPages = pageInfo ? parseInt(pageInfo[1]) : 1;
  const MAX_PAGES  = Math.min(totalPages, 5);
  let all = [...page1];

  if (MAX_PAGES > 1) {
    const fields = extractFormFields(html1);
    let currentFields = { ...fields };

    for (let page = 2; page <= MAX_PAGES; page++) {
      try {
        broadcast('partner360_status', `Loading partner list page ${page}/${MAX_PAGES}…`);
        const postFields = {
          ...currentFields,
          '__EVENTTARGET':   'ctl00$Main$NavigatorControl$NextButton',
          '__EVENTARGUMENT': '',
          '__ASYNCPOST':     'true',
          'ctl00$ScriptManager1':
            'ctl00$Main$CustomersUpdatePanel|ctl00$Main$NavigatorControl$NextButton',
        };
        const resp = await fetch(`${BASE}/customers.aspx?m=1`, {
          method: 'POST', credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': '*/*', 'Origin': BASE,
            'X-MicrosoftAjax': 'Delta=true',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: new URLSearchParams(postFields).toString()
        });
        const respText = await resp.text();
        const sections = parseUpdatePanel(respText);
        if (sections['__VIEWSTATE']?.content)
          currentFields['__VIEWSTATE'] = sections['__VIEWSTATE'].content;

        const combinedHtml = Object.values(sections).map(s => s.content).join('\n');
        const pageData = parsePartnersFromHtml(combinedHtml);
        if (!pageData.length) break;
        all = all.concat(pageData);
      } catch(e) {
        console.warn(`PRM partner list page ${page} failed:`, e.message);
        break;
      }
    }
  }

  return all;
}

// Parse the Main_dg partners table — extracted as standalone function
// so it can be tested independently via DEBUG_FETCH_CUSTOMERS
// ── Partner list filter (server-side by partner level) ───────────────────────
// levelId values: '' = all, '12' = Titanium, '9' = Platinum, '2' = Gold,
//                 '3' = Silver, '10' = Bronze, '11' = Trainee, '8' = Affiliate

async function fetchPartnerListFiltered(levelId) {
  // First GET the page to harvest VIEWSTATE + form fields
  const html1   = await fetchPage(`${BASE}/customers.aspx?m=1`);
  const fields  = extractFormFields(html1);

  // If no filter, just return unfiltered list
  if (!levelId) return fetchPartnerList();

  // POST with ddlType filter
  const postFields = {
    ...fields,
    '__ASYNCPOST':              'true',
    '__EVENTTARGET':            'ctl00$Main$ddlType',
    '__EVENTARGUMENT':          '',
    'ctl00$Main$ddlType':       levelId,
    'ctl00$Main$ddlEnabled':    'both',
    'ctl00$Main$ddlFreeText':   'City',
    'ctl00$ScriptManager1':
      'ctl00$Main$CustomersUpdatePanel|ctl00$Main$ddlType',
  };

  const resp = await fetch(`${BASE}/customers.aspx?m=1`, {
    method: 'POST', credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': '*/*', 'Origin': BASE,
      'X-MicrosoftAjax': 'Delta=true', 'X-Requested-With': 'XMLHttpRequest',
    },
    body: new URLSearchParams(postFields).toString()
  });

  const respText  = await resp.text();
  const sections  = parseUpdatePanel(respText);
  const html2     = Object.values(sections).map(s => s.content).join('\n');

  // Debug: log what came back
  console.log('PRM filter response length:', respText.length);
  console.log('PRM filter sections:', Object.keys(sections));
  console.log('PRM filter combined html length:', html2.length);
  console.log('PRM filter has Main_dg:', html2.includes('id="Main_dg"'));
  console.log('PRM filter has datagrid:', html2.includes('datagrid'));
  // Check record count in response
  const recCount = html2.match(/(\d+) of [\d,]+ record/);
  console.log('PRM filter record count match:', recCount?.[0]);

  const page1     = parsePartnersFromHtml(html2);
  console.log('PRM filter page1 length:', page1.length);

  if (!page1.length) {
    // Maybe the filter returned 0 real results (Titanium might have 0 partners)
    // Check if the response is valid but empty
    const hasNavigator = html2.includes('NavigatorControl');
    throw new Error(`Filter returned ${page1.length} partners. hasNavigator=${hasNavigator} htmlLen=${html2.length}`);
  }

  // Check for more pages and fetch them
  const pageInfo   = html2.match(/Page 1 of (\d+)/);
  const totalPages = pageInfo ? parseInt(pageInfo[1]) : 1;
  const MAX_PAGES  = Math.min(totalPages, 10); // allow up to 500 when filtered
  let all = [...page1];

  let currentFields = { ...fields };
  if (sections['__VIEWSTATE']?.content)
    currentFields['__VIEWSTATE'] = sections['__VIEWSTATE'].content;

  for (let page = 2; page <= MAX_PAGES; page++) {
    try {
      broadcast('partner360_status', `Loading filtered list page ${page}/${MAX_PAGES}…`);
      const nextFields = {
        ...currentFields,
        '__ASYNCPOST':           'true',
        '__EVENTTARGET':         'ctl00$Main$NavigatorControl$NextButton',
        '__EVENTARGUMENT':       '',
        'ctl00$Main$ddlType':    levelId,
        'ctl00$Main$ddlEnabled': 'both',
        'ctl00$Main$ddlFreeText':'City',
        'ctl00$ScriptManager1':
          'ctl00$Main$CustomersUpdatePanel|ctl00$Main$NavigatorControl$NextButton',
      };
      const r2  = await fetch(`${BASE}/customers.aspx?m=1`, {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': '*/*', 'Origin': BASE,
          'X-MicrosoftAjax': 'Delta=true', 'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams(nextFields).toString()
      });
      const rt2    = await r2.text();
      const sects2 = parseUpdatePanel(rt2);
      if (sects2['__VIEWSTATE']?.content)
        currentFields['__VIEWSTATE'] = sects2['__VIEWSTATE'].content;
      const html3 = Object.values(sects2).map(s => s.content).join('\n');
      const pageData = parsePartnersFromHtml(html3);
      if (!pageData.length) break;
      all = all.concat(pageData);
    } catch(e) {
      console.warn(`Filtered page ${page} failed:`, e.message);
      break;
    }
  }

  return all;
}


function parsePartnersFromHtml(html) {
  const tableIdx   = html.indexOf('id="Main_dg"');
  if (tableIdx < 0) return [];
  const tableStart = html.lastIndexOf('<table', tableIdx);
  if (tableStart < 0) return [];

  // Depth-count nested tables to find correct closing tag
  let depth = 0, pos = tableStart, tableEnd = -1;
  while (pos < html.length) {
    const no = html.indexOf('<table', pos);
    const nc = html.indexOf('</table>', pos);
    if (nc < 0) break;
    if (no >= 0 && no < nc) { depth++; pos = no + 6; }
    else { depth--; if (depth === 0) { tableEnd = nc + 8; break; } pos = nc + 8; }
  }
  const tableHtml = html.substring(tableStart, tableEnd > 0 ? tableEnd : html.length);

  // Extract rows (first row = header). Capture tr attrs so we can skip disabled partners.
  const rowMatches = [...tableHtml.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  if (rowMatches.length < 2) return [];

  const headerCells = [...rowMatches[0][2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(m => htmlDecode(m[1].replace(/<[^>]+>/g, ' ')).trim());

  const partners = [];
  for (let i = 1; i < rowMatches.length; i++) {
    if (isDisabledRow(rowMatches[i][1])) continue;  // skip disabled partners
    const cells = [...rowMatches[i][2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1]);
    if (cells.length < 3) continue;

    // API ID from href in cell[2]
    const hrefM = cells[2].match(/\/partner\/edit\.aspx\?i=(\d+)/i);
    if (!hrefM) continue;
    const id = hrefM[1];

    // Full company name from title attribute on the div wrapper
    const titleM = cells[2].match(/title="([^"]+)"/);
    const company = titleM
      ? htmlDecode(titleM[1])
      : htmlDecode(cells[2].replace(/<[^>]+>/g, ' ')).trim().replace(/\s+/g, ' ');

    const row = { id, company };
    headerCells.forEach((h, idx) => {
      if (!h || idx < 2 || idx >= cells.length) return;
      const val = htmlDecode(cells[idx].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (val && val !== '\u00a0') row[h] = val;
    });

    if (!row.category && row['Partner Category']) row.category = row['Partner Category'];
    if (!row.country  && row['Country'])          row.country  = row['Country'];
    if (!row.cert     && row['Cert'])              row.cert     = row['Cert'];
    if (!row.region   && row['Sales Region'])      row.region   = row['Sales Region'];
    if (!row.agent    && row['Team Agent'])        row.agent    = row['Team Agent'];
    if (!row.revenue  && row['Annual Revenue'])    row.revenue  = row['Annual Revenue'];

    partners.push(row);
  }
  return partners;
}


// ── Google Sheet reader ───────────────────────────────────────────────────────
// Sheet must be shared "anyone with link can view" OR user is signed in to Google.

async function fetchSheetData(sheetId, gid='0') {
  const url  = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const resp = await fetch(url, { credentials:'include' });
  if (!resp.ok) throw new Error(`Sheet fetch failed: ${resp.status}`);
  const csv  = await resp.text();
  return parseCSV(csv);
}

function parseCSV(csv) {
  const lines  = csv.split(/\r?\n/).filter(l=>l.trim());
  if (!lines.length) return [];
  const headers = parseCSVRow(lines[0]);
  return lines.slice(1).map(l => {
    const cells = parseCSVRow(l);
    const obj = {};
    headers.forEach((h,i) => { obj[h.trim()] = cells[i]??''; });
    return obj;
  });
}

function parseCSVRow(line) {
  const cells = []; let cur='', inQ=false;
  for (let i=0; i<line.length; i++) {
    const c=line[i];
    if (c==='"') { inQ=!inQ; }
    else if (c===',' && !inQ) { cells.push(cur); cur=''; }
    else cur+=c;
  }
  cells.push(cur);
  return cells;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function callOpenAI(messages, onChunk) {
  const { openaiKey } = await chrome.storage.local.get('openaiKey');
  if (!openaiKey) throw new Error('No OpenAI API key set — add it in Settings');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${openaiKey}` },
    body: JSON.stringify({ model:'gpt-4o-mini', max_tokens:600, stream:!!onChunk, messages })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(()=>({}));
    throw new Error(err.error?.message ?? `OpenAI ${resp.status}`);
  }
  if (!onChunk) {
    const data = await resp.json();
    return data.choices[0].message.content;
  }
  // Streaming
  const reader = resp.body.getReader(); const dec = new TextDecoder();
  let full = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    for (const line of dec.decode(value).split('\n')) {
      const s = line.replace(/^data: /,'').trim();
      if (!s||s==='[DONE]') continue;
      try {
        const t = JSON.parse(s).choices?.[0]?.delta?.content??'';
        full += t; onChunk(t, full);
      } catch {}
    }
  }
  return full;
}

async function summariseTranscription(emailBody) {
  return callOpenAI([
    { role:'system', content:'You are a B2B sales assistant. Summarise this call transcription in 3-4 concise bullet points: key topics discussed, decisions made, action items, and any concerns. Be specific, no filler.' },
    { role:'user',   content: emailBody }
  ]);
}

async function generateNextBestAction(partnerData) {
  const ctx = JSON.stringify({
    company:    partnerData.company,
    type:       partnerData.type,
    category:   partnerData.category,
    discounts:  partnerData.discounts,
    recentNotes:partnerData.tabs?.notesParsed?.slice(0,5).map(n=>({type:n.type,subject:n.subject,body:n.body?.substring(0,200)})),
    recentComms:partnerData.recentComms?.slice(0,5)
  });
  return callOpenAI([
    { role:'system', content:'You are a 3CX channel sales advisor. Based on partner data, suggest the single most impactful next action in 1-2 sentences. Be specific and actionable.' },
    { role:'user',   content: ctx }
  ]);
}

async function classifyEmail(subject, body) {
  return callOpenAI([
    { role:'system', content:'Classify this email into exactly one category: transcription|partner_comm|lead|provider|reseller_prospect|other. Then extract: summary (1 sentence), sentiment (positive/neutral/at_risk), urgency (high/medium/low). Respond as JSON only: {"category":"...","summary":"...","sentiment":"...","urgency":"..."}' },
    { role:'user',   content:`Subject: ${subject}\n\n${body?.substring(0,1500)}` }
  ]);
}

// ── Broadcaster ───────────────────────────────────────────────────────────────

function broadcast(type, payload) {
  chrome.runtime.sendMessage({ type, payload }).catch(()=>{});
}

// ── Alarm for sheet sync ──────────────────────────────────────────────────────

chrome.alarms.create('syncSheet', { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name==='syncSheet') syncSheetToStorage();
});

async function syncSheetToStorage() {
  const { sheetId } = await chrome.storage.local.get('sheetId');
  if (!sheetId) return;
  try {
    const rows = await fetchSheetData(sheetId);
    await chrome.storage.local.set({ sheetData: rows, sheetSyncedAt: Date.now() });
    broadcast('sheet_synced', { count: rows.length });
  } catch(e) { console.warn('Sheet sync failed:', e.message); }
}

// ── Message router ────────────────────────────────────────────────────────────

// ── Single consolidated message router (MV3 requires one listener) ──────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const dispatch = {
    CHECK_SESSION:      () => checkSessionHealth(),
    LOOKUP_PARTNER:     () => lookupPartner(msg.partnerId),
    FETCH_PARTNER360:   () => fetchPartner360(msg.partnerId),
    FETCH_NOTES:        () => fetchPartnerPage(msg.partnerId)
      .then(h => fetchTab(msg.partnerId, extractFormFields(h), 'ctl00$Main$btnNotes'))
      .then(r => parseNotesFromHtml(
        Object.values(parseUpdatePanel(r)).map(s => s.content).join('\n')
      )),
    FETCH_PARTNER_LIST: () => fetchPartnerList(),
    FETCH_PARTNER_LIST_FILTERED: () => fetchPartnerListFiltered(msg.levelId),
    FETCH_SHEET:        () => fetchSheetData(msg.sheetId, msg.gid),
    SYNC_SHEET:         () => syncSheetToStorage(),
    POST_NOTE:          () => postCallNote(msg.payload),
    SUMMARISE:          () => summariseTranscription(msg.body),
    NEXT_BEST_ACTION:   () => generateNextBestAction(msg.partnerData),
    CLASSIFY_EMAIL:     () => classifyEmail(msg.subject, msg.body),
    MATCH_CALLER:       () => matchCaller(msg.number),
    DEBUG_FETCH_CUSTOMERS: () => (async () => {
      const html    = await fetchPage(`${BASE}/customers.aspx?m=1`);
      const results = parsePartnersFromHtml(html);
      const sample  = results.slice(0, 3).map(p => ({ id: p.id, company: p.company, cert: p.cert }));
      return {
        htmlLength: html.length,
        partnersFound: results.length,
        sample,
        hasMainDg:   html.includes('id="Main_dg"'),
        hasDatagrid: html.includes('datagrid'),
      };
    })(),
  };

  const handler = dispatch[msg.type];
  if (!handler) return false;

  Promise.resolve(handler())   // call the function, not just pass it
    .then(r  => sendResponse({ ok: true,  result: r }))
    .catch(e => sendResponse({ ok: false, error: e.message, code: e.code }));
  return true; // keep channel open
});