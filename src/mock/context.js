"use strict";

const partners = require("./partners.json");
const orders = require("./orders.json");
const licenseKeys = require("./licenseKeys.json");
const internalUsers = require("./internalUsers.json");
const calls = require("./calls.json");
const emails = require("./emails.json");
const products = require("./products.json");
const salesTeam = require("./salesTeam.json");
const licenseTypes = require("./licenseTypes.json");

const MAX_TRANSCRIPT_IN_PROMPT = 220;
const MAX_ORDER_DETAIL = 56;
const MAX_EMAIL_BODY = 140;
const MAX_COMPANY = 32;
const MAX_EMAIL = 40;

function trunc(s, max) {
  if (!s || s.length <= max) return s || "";
  return `${s.slice(0, max)}…`;
}

/**
 * Compact string for system prompt — mock ERP/CRM snapshot (no DB).
 */
function getMockContextString() {
  const lines = [];
  lines.push("### Mock ERP + CRM snapshot (PBX distributor demo, read-only)");
  lines.push("");
  lines.push("**Internal sales team (channel / direct)**");
  for (const rep of salesTeam.reps) {
    lines.push(`- ${rep.name} — region: ${rep.region} (${rep.id})`);
  }
  lines.push("");
  lines.push("**Internal users (license assignees / customer-side admins, sample)**");
  for (const u of internalUsers) {
    lines.push(
      `- ${u.id}: ${u.fullName} (${u.role}, ${u.companyHint}) <${u.email}>`,
    );
  }
  lines.push("");
  lines.push("**Distributors / resellers (partners)**");
  for (const p of partners) {
    lines.push(
      `- ${p.id} [${p.partnerCode}] ${p.companyName} — region ${p.salesRegion}, ${p.country}${p.state ? `, ${p.state}` : ""} — level ${p.distributorLevel} — contact ${p.contactName} — credit $${p.creditLimitUsd.toLocaleString("en-US")} — est. annual revenue $${p.annualRevenueUsd.toLocaleString("en-US")} — ~${p.subPartnerCount} sub-partners — ~${p.orderCountApprox} orders — website listing ${p.listedOnWebsite ? "yes" : "no"} — account owner ${p.accountOwnerName} <${p.accountOwnerEmail}> ${p.accountOwnerPhone} — ${p.notes}`,
    );
  }
  lines.push("");
  lines.push("**License type catalog (Primary License SC = 2^power)**");
  for (const t of licenseTypes.types) {
    lines.push(`- 2^${t.power} → SC ${t.primaryLicenseSc}: ${t.productEdition}`);
  }
  lines.push("");
  lines.push("**ERP license keys**");
  const expired = licenseKeys.filter((k) => k.flags.licenseExpired);
  const unassigned = licenseKeys.filter((k) => k.flags.notAssignedToReseller);
  lines.push(
    `- Total keys in dataset: ${licenseKeys.length} (expired: ${expired.length}; not assigned to reseller: ${unassigned.length})`,
  );
  for (const k of licenseKeys) {
    const flags = [];
    if (k.flags.licenseExpired) flags.push("expired");
    if (k.flags.notAssignedToReseller) flags.push("not_assigned_to_reseller");
    lines.push(
      `- ${k.licenseKey} — ${k.deployedAs} — ${k.company} (${k.country}) — v${k.version} — edition ${k.productEdition} — SC ${k.primaryLicenseSc} — license exp ${k.licenseExpires} — hosting exp ${k.hostingExpires} — FQDN ${k.fqdn} — assignee ${k.assignedUserName || "none"} — reseller ${k.assignedResellerName || "none"} — original reseller ${k.originalResellerName || "none"} — update ${k.updateCode}${flags.length ? ` — [${flags.join(", ")}]` : ""}`,
    );
  }
  lines.push("");
  lines.push("**Products (list price hints)**");
  for (const p of products) {
    lines.push(
      `- ${p.sku}: ${p.name} — $${p.priceUsd} ${p.billing} — ${p.highlights.join(", ")}`,
    );
  }
  lines.push("");
  lines.push("**ERP orders (500 rows, compact)**");
  lines.push(
    "Format: orderId | date | inv | status | type | pay | resellerId | company | custEmail | qty | disc% | rrp | total | description | customerDetails (reseller name is on partner rows)",
  );
  for (const o of orders) {
    const desc = trunc(o.description, MAX_ORDER_DETAIL);
    const det = trunc(o.customerDetails, MAX_ORDER_DETAIL);
    lines.push(
      `${o.orderId}|${o.date}|${o.invoiceDate}|${o.status}|${o.type}|${o.paymentMethod}|${o.resellerId}|${trunc(o.company, MAX_COMPANY)}|${trunc(o.customerEmail, MAX_EMAIL)}|${o.quantity}|${o.discountPercent}|${o.rrpUsd}|${o.totalUsd}|${desc}|${det}`,
    );
  }
  lines.push("");
  lines.push("**Partner calls**");
  lines.push(
    "Includes completed (duration ≥ 1m where applicable), scheduled future calls (empty duration/sentiment/transcript), and missed calls.",
  );
  for (const c of calls) {
    const t =
      c.transcript && c.transcript.length > MAX_TRANSCRIPT_IN_PROMPT
        ? trunc(c.transcript, MAX_TRANSCRIPT_IN_PROMPT)
        : c.transcript;
    lines.push(
      `- ${c.id} | ${c.partnerName} (${c.partnerId}) | seller ${c.seller} | ${c.date} | ${c.status} | duration ${c.durationDisplay ?? "—"} | sentiment ${c.sentiment ?? "—"} | ${c.notes} | transcript: ${t || "—"}`,
    );
  }
  lines.push("");
  lines.push("**Partner emails**");
  for (const e of emails) {
    lines.push(
      `- ${e.id} | ${e.partnerName} (${e.partnerId}) | ${e.status} | ${e.date} | ${e.sentiment} | ${e.subject} | from ${e.from} → to ${e.to} | body: ${trunc(e.body.replace(/\n/g, " "), MAX_EMAIL_BODY)}`,
    );
  }
  return lines.join("\n");
}

module.exports = {
  getMockContextString,
  partners,
  orders,
  licenseKeys,
  internalUsers,
  calls,
  emails,
  products,
  salesTeam,
  licenseTypes,
};
