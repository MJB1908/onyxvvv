"use strict";

/**
 * Generates PBX-oriented mock CRM files under src/mock/.
 * Run: node scripts/generate-pbx-mocks.js
 */

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "src", "mock");

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x3cb02026);

function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}

function pickInt(min, max) {
  return Math.floor(rnd() * (max - min + 1)) + min;
}

function guid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (rnd() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const REGIONS = [
  "South & Central America",
  "Scandinavia",
  "UK & Ireland",
  "Central Europe",
  "DACH North",
  "DACH South",
  "Eastern Europe",
  "Africa",
  "United States",
  "Central",
  "North East",
  "South East",
  "West",
  "Italy",
  "Australiasia",
  "Middle East North Aftica",
  "France",
  "France North",
  "France South",
  "BeNeLux",
  "Iberia",
  "Canada",
  "Asia",
  "Russia",
];

const COUNTRIES_BY_REGION = {
  "South & Central America": ["Brazil", "Mexico", "Argentina", "Colombia"],
  Scandinavia: ["Sweden", "Norway", "Denmark", "Finland"],
  "UK & Ireland": ["United Kingdom", "Ireland"],
  "Central Europe": ["Poland", "Czech Republic", "Hungary"],
  "DACH North": ["Germany"],
  "DACH South": ["Austria", "Switzerland"],
  "Eastern Europe": ["Romania", "Bulgaria", "Ukraine"],
  Africa: ["South Africa", "Kenya", "Nigeria"],
  "United States": ["United States"],
  Central: ["United States"],
  "North East": ["United States"],
  "South East": ["United States"],
  West: ["United States"],
  Italy: ["Italy"],
  Australiasia: ["Australia", "New Zealand"],
  "Middle East North Aftica": ["UAE", "Israel", "Morocco"],
  France: ["France"],
  "France North": ["France"],
  "France South": ["France"],
  BeNeLux: ["Belgium", "Netherlands", "Luxembourg"],
  Iberia: ["Spain", "Portugal"],
  Canada: ["Canada"],
  Asia: ["Singapore", "Japan", "India"],
  Russia: ["Russia"],
};

const US_STATES = ["CA", "TX", "NY", "FL", "IL", "WA", "MA", "CO"];
const LEVELS = ["Platinum", "Gold", "Silver"];
const PAYMENT = ["Wire transfer", "Credit card", "Monthly"];
const ORDER_TYPES = ["Renewal", "Upgrade", "New", "Hosting"];
const ORDER_STATUS = ["Paid", "Paid", "Paid", "Pending", "Invoiced", "Overdue"];
const DEPLOYED = ["Hosted cloud", "Private cloud", "On premise"];

/** SC = 2^power for power 2…10; names omit vendor prefix (see licenseTypes.json). */
const LICENSE_TYPES = [
  { power: 2, primaryLicenseSc: 4, productEdition: "Phone System Basic" },
  { power: 3, primaryLicenseSc: 8, productEdition: "Phone System Professional" },
  { power: 4, primaryLicenseSc: 16, productEdition: "Phone System Enterprise Edition" },
  { power: 5, primaryLicenseSc: 32, productEdition: "Phone System - Basic Annual" },
  { power: 6, primaryLicenseSc: 64, productEdition: "Phone System Professional - Annual" },
  { power: 7, primaryLicenseSc: 128, productEdition: "Phone System Enterprise / AI Edition - Annual" },
  { power: 8, primaryLicenseSc: 256, productEdition: "SMB PRO" },
  { power: 9, primaryLicenseSc: 512, productEdition: "SMB PRO" },
  { power: 10, primaryLicenseSc: 1024, productEdition: "Phone System Enterprise PLUS Edition" },
];

/** Each rep has a primary sales region (for routing / territories). */
const SALES_TEAM = [
  { name: "Alex Chen", region: "United States" },
  { name: "Jordan Lee", region: "UK & Ireland" },
  { name: "Sam Rivera", region: "Iberia" },
  { name: "Morgan Blake", region: "DACH North" },
  { name: "Priya Desai", region: "Asia" },
  { name: "Chris Okonkwo", region: "Africa" },
  { name: "Elena Vogel", region: "Italy" },
  { name: "Tomasz Kowalski", region: "Central Europe" },
  { name: "Sofia Martins", region: "South & Central America" },
  { name: "James Whitaker", region: "Canada" },
];

const PARTNER_NAMES = [
  "VoIP Partners Nordic",
  "TeleConnect Iberia",
  "CloudVoice DACH",
  "Unified Comms UK",
  "Atlantic PBX Group",
  "Baltic Telecom Solutions",
  "Mediterranean UC",
  "Alpine Voice Systems",
  "Pacific Ring Networks",
  "Great Lakes UC",
  "Sunbelt Communications",
  "Metro Connect France",
  "Rhine Valley IT",
  "Danube Digital",
  "Caspian Telecom",
  "Red Sea Voice",
  "Sahara UC Partners",
  "Cape Town Comms",
  "Lagos Connect",
  "Nairobi Voice Hub",
  "Singapore Ring",
  "Tokyo UC Partners",
  "Seoul Voice Pro",
  "Mumbai Telecom Hub",
  "Sydney PBX Group",
  "Melbourne Voice",
  "Auckland Connect",
  "Toronto UC",
  "Vancouver Voice",
  "Montreal Telecom",
  "Mexico City VoIP",
  "São Paulo Ring",
  "Bogotá Connect",
  "Buenos Aires UC",
  "Warsaw Voice Partners",
  "Prague Ring",
  "Budapest Connect",
  "Bucharest UC",
  "Sofia Voice",
  "Athens Telecom",
  "Lisbon Ring",
  "Madrid Voice Hub",
  "Brussels Connect",
  "Amsterdam UC",
  "Dublin Voice",
  "Glasgow Ring",
  "Manchester Connect",
  "Edinburgh UC",
  "Oslo Voice",
  "Stockholm Ring",
  "Helsinki Connect",
];

function fmtMoney(n) {
  return Math.round(n * 100) / 100;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function buildPartners() {
  const partners = [];
  for (let i = 0; i < 50; i++) {
    const region = REGIONS[i % REGIONS.length];
    const country = pick(COUNTRIES_BY_REGION[region] || ["United States"]);
    const state = country === "United States" ? pick(US_STATES) : "";
    const level = pick(LEVELS);
    const start = new Date(2018 + pickInt(0, 5), pickInt(0, 11), pickInt(1, 28));
    const credit = pickInt(25, 500) * 1000;
    const revenue = pickInt(200, 8000) * 1000;
    const subPartners = pickInt(3, 120);
    const orderCount = pickInt(5, 180);
    const id = `prt-${String(i + 1).padStart(3, "0")}`;
    const owner = SALES_TEAM[i % SALES_TEAM.length].name;
    const contactFirst = ["Marco", "Ingrid", "Luis", "Fatima", "Henrik", "Yuki", "Diego", "Ana", "Viktor", "Zara"][i % 10];
    const contactLast = ["Silva", "Berg", "García", "Hassan", "Larsson", "Tanaka", "Ruiz", "Popescu", "Novak", "Khan"][i % 10];

    partners.push({
      id,
      partnerCode: `P-${1000 + i}`,
      companyName: PARTNER_NAMES[i],
      startingDate: isoDate(start),
      salesRegion: region,
      country,
      state,
      contactName: `${contactFirst} ${contactLast}`,
      distributorLevel: level,
      creditLimitUsd: credit,
      annualRevenueUsd: revenue,
      subPartnerCount: subPartners,
      orderCountApprox: orderCount,
      listedOnWebsite: rnd() > 0.25,
      accountOwnerName: owner,
      accountOwnerEmail: `${owner.split(" ")[0].toLowerCase()}.${owner.split(" ")[1].toLowerCase()}@3cx-sales.example`,
      accountOwnerPhone: `+1-555-${String(2000 + i).padStart(4, "0")}`,
      notes:
        i % 7 === 0
          ? "Focus on mid-market; strong hosting attach."
          : i % 5 === 0
            ? "Renewal-heavy region; proactive QBRs recommended."
            : "Standard partner health; quarterly business reviews.",
    });
  }
  return partners;
}

function buildInternalUsers() {
  const roles = [
    "IT Director",
    "Telecom Manager",
    "Systems Admin",
    "CTO",
    "Operations Lead",
  ];
  const users = [];
  for (let i = 0; i < 10; i++) {
    users.push({
      id: `usr-${String(i + 1).padStart(3, "0")}`,
      fullName: [
        "Daniel Frost",
        "Mei Lin",
        "Oliver Grant",
        "Aisha Rahman",
        "Stefan Mueller",
        "Carla Mendes",
        "Ryan O'Connell",
        "Nadia Petrov",
        "Emma Walsh",
        "Hiro Taneda",
      ][i],
      email: `admin.user${i + 1}@customer-portal.example`,
      role: roles[i % roles.length],
      companyHint: ["Logistics", "Clinic chain", "Retail group", "Manufacturer", "School board"][i % 5],
    });
  }
  return users;
}

function buildOrders(partners) {
  const orders = [];
  const start = new Date("2023-03-01");
  const end = new Date("2026-04-19");
  const range = end - start;

  for (let i = 0; i < 500; i++) {
    const p = pick(partners);
    const t = new Date(start.getTime() + rnd() * range);
    const inv = new Date(t);
    inv.setDate(inv.getDate() + pickInt(0, 14));
    const type = pick(ORDER_TYPES);
    const qty = pickInt(1, 48);
    const rrp = pickInt(120, 890);
    const discPct = pick([0, 5, 10, 15, 20, 25]);
    const line = rrp * qty * (1 - discPct / 100);
    const cust = `${pick(["Acme", "Northwind", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli"])} ${pick(["Industries", "Group", "Holdings", "Ltd", "SpA", "GmbH"])}`;
    const custSlug = cust.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const email = `procurement@${custSlug.slice(0, 24)}.example`;

    orders.push({
      orderId: `ord-${String(i + 1).padStart(6, "0")}`,
      date: isoDate(t),
      invoiceDate: isoDate(inv),
      status: pick(ORDER_STATUS),
      company: cust,
      paymentMethod: pick(PAYMENT),
      resellerId: p.id,
      resellerName: p.companyName,
      customerDetails: `${cust} — ${pick(["HQ rollout", "Branch refresh", "Contact center expansion", "SIP trunk migration"])}`,
      customerEmail: email,
      type,
      description: `${type} — ${pick(LICENSE_TYPES).productEdition} (${qty} SC)`,
      rrpUsd: fmtMoney(rrp),
      quantity: qty,
      discountPercent: discPct,
      totalUsd: fmtMoney(line),
    });
  }
  orders.sort((a, b) => a.date.localeCompare(b.date));
  return orders;
}

function buildLicenseKeys(partners, users) {
  const keys = [];
  for (let i = 0; i < 55; i++) {
    const deployed = pick(DEPLOYED);
    const lt = pick(LICENSE_TYPES);
    const sc = lt.primaryLicenseSc;
    const edition = lt.productEdition;
    const ver = `${pickInt(2, 2)}.${pickInt(0, 3)}.${pickInt(0, 3)}`;
    const expired = rnd() < 0.35;
    const unassignedReseller = rnd() < 0.2;
    const partner = unassignedReseller ? null : pick(partners);
    const user = rnd() < 0.75 ? pick(users) : null;
    const hostExp = new Date();
    hostExp.setMonth(hostExp.getMonth() + (expired ? -pickInt(1, 18) : pickInt(1, 24)));
    const licExp = new Date(hostExp);
    licExp.setDate(licExp.getDate() + pickInt(-30, 60));

    keys.push({
      licenseKey: guid(),
      deployedAs: deployed,
      company: `${pick(["VoiceFirst", "CallStream", "RingCentral-ish Local", "TalkBright", "LineWave"])} ${pick(["LLC", "SARL", "AB", "Sp z o.o."])}`,
      country: pick(["United States", "Germany", "France", "Australia", "Poland", "Brazil"]),
      assignedUserId: user ? user.id : null,
      assignedUserName: user ? user.fullName : null,
      version: ver,
      primaryLicenseSc: sc,
      productEdition: edition,
      licenseExpires: isoDate(licExp),
      hostingExpires: isoDate(hostExp),
      fqdn: `${pick(["pbx", "voip", "uc"])}-${pickInt(10, 99)}.${pick(["customer", "corp", "voice"])}.example`,
      assignedResellerId: partner ? partner.id : null,
      assignedResellerName: partner ? partner.companyName : null,
      originalResellerId: partner ? partner.id : null,
      originalResellerName: partner ? partner.companyName : null,
      updateCode: guid().slice(0, 8).toUpperCase(),
      flags: {
        licenseExpired: expired,
        notAssignedToReseller: unassignedReseller,
      },
    });
  }
  return keys;
}

function wordsForSeconds(seconds) {
  /** ~0.35 words/sec keeps JSON transcript length plausible vs. duration (1m+ calls). */
  const n = Math.min(200, Math.max(40, Math.floor(seconds * 0.35)));
  const pool = [
    "extension",
    "queue",
    "SIP trunk",
    "failover",
    "HA",
    "license",
    "SC",
    "renewal",
    "quote",
    "discount",
    "Enterprise",
    "hosting",
    "FQDN",
    "certificate",
    "firewall",
    "port",
    "softphone",
    "deskphone",
    "CRM",
    "call recording",
    "compliance",
    "partner portal",
    "next steps",
    "follow up",
    "proposal",
    "budget",
    "QBR",
  ];
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(pick(pool));
  return parts.join(" ");
}

function buildTranscriptJson(partnerName, seller, seconds, outcome) {
  const lines = [
    { speaker: seller, text: `Hi, calling about your PBX license renewal and any expansion needs for ${partnerName}.` },
    {
      speaker: "Partner",
      text: "We're comparing options—need clarity on SC pricing and hosting versus on-prem.",
    },
    {
      speaker: seller,
      text: `For ${seconds}s context: I can walk through edition fit, ${outcome === "positive" ? "and we can reserve discount bands" : "and we should align on technical blockers first"}.`,
    },
    { speaker: "Partner", text: wordsForSeconds(Math.max(20, seconds - 40)) },
    { speaker: seller, text: outcome === "positive" ? "I'll send a formal quote today." : "Let's schedule a technical deep-dive with SE." },
  ];
  return JSON.stringify({ durationSec: seconds, partner: partnerName, lines });
}

function buildCalls(partners) {
  const calls = [];
  const outcomes = ["positive", "neutral", "stalled", "positive", "neutral"];
  let idx = 0;

  for (let c = 0; c < 95; c++) {
    const seller = pick(SALES_TEAM).name;
    const partner = pick(partners);
    const future = rnd() < 0.12;
    const missed = !future && rnd() < 0.08;
    const t = new Date(2024, pickInt(0, 15), pickInt(1, 28), pickInt(8, 17), pickInt(0, 59), 0);

    if (future) {
      const ft = new Date();
      ft.setDate(ft.getDate() + pickInt(1, 21));
      calls.push({
        id: `call-${String(++idx).padStart(4, "0")}`,
        partnerId: partner.id,
        partnerName: partner.companyName,
        seller,
        date: isoDate(ft),
        durationSec: null,
        durationDisplay: null,
        sentiment: null,
        status: "scheduled",
        transcript: "",
        notes: "Discovery call — agenda: renewal timeline and SC growth.",
      });
      continue;
    }

    if (missed) {
      calls.push({
        id: `call-${String(++idx).padStart(4, "0")}`,
        partnerId: partner.id,
        partnerName: partner.companyName,
        seller,
        date: isoDate(t),
        durationSec: 0,
        durationDisplay: "0:00",
        sentiment: "n/a",
        status: "missed",
        transcript: "",
        notes: "No answer; left voicemail about license renewal.",
      });
      continue;
    }

    const seconds = pickInt(65, 840);
    const outcome = pick(outcomes);
    const sentiment =
      outcome === "positive" ? "positive" : outcome === "stalled" ? "negative" : "neutral";
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;

    calls.push({
      id: `call-${String(++idx).padStart(4, "0")}`,
      partnerId: partner.id,
      partnerName: partner.companyName,
      seller,
      date: isoDate(t),
      durationSec: seconds,
      durationDisplay: `${mm}:${String(ss).padStart(2, "0")}`,
      sentiment,
      status: "completed",
      transcript: buildTranscriptJson(partner.companyName, seller, seconds, outcome),
      notes:
        outcome === "positive"
          ? "Partner asked for quote; warm."
          : outcome === "stalled"
            ? "Price sensitivity; competitor mentioned."
            : "Needs internal approval; follow-up email sent.",
    });
  }

  return calls;
}

function buildEmails(partners) {
  const emails = [];
  for (let e = 0; e < 72; e++) {
    const seller = pick(SALES_TEAM).name;
    const partner = pick(partners);
    const fromSales = rnd() > 0.45;
    const t = new Date(2024, pickInt(0, 15), pickInt(1, 28), pickInt(8, 17), pickInt(0, 59), 0);
    const future = rnd() < 0.1;

    const subj = pick([
      "PBX renewal options",
      "SC expansion quote",
      "Hosting renewal — next steps",
      "Follow-up: partner QBR",
      "License alignment check",
      "Meeting recap & action items",
    ]);

    const body = fromSales
      ? `Hello ${partner.contactName},\n\nFollowing our discussion on ${partner.companyName}'s deployment, attached is the ${pick(["Pro", "Enterprise", "Standard"])} outline with SC counts.\n\n${seller.split(" ")[0]}`
      : `${partner.contactName} wrote:\nWe need pricing for ${pickInt(16, 256)} SC and clarity on private cloud vs hosted.\n\nThanks`;

    emails.push({
      id: `eml-${String(e + 1).padStart(4, "0")}`,
      partnerId: partner.id,
      partnerName: partner.companyName,
      from: fromSales
        ? `${seller.split(" ")[0].toLowerCase()}.${seller.split(" ")[1].toLowerCase()}@3cx-sales.example`
        : `${partner.contactName.toLowerCase().replace(/\s+/g, ".")}@${partner.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`,
      to: fromSales
        ? `${partner.contactName.toLowerCase().replace(/\s+/g, ".")}@${partner.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`
        : `${seller.split(" ")[0].toLowerCase()}.${seller.split(" ")[1].toLowerCase()}@3cx-sales.example`,
      date: future ? isoDate(new Date(Date.now() + pickInt(1, 14) * 86400000)) : isoDate(t),
      subject: subj,
      sentiment: pick(["positive", "neutral", "neutral", "negative"]),
      status: future ? "scheduled_draft" : "sent",
      body,
    });
  }
  return emails;
}

function main() {
  const partners = buildPartners();
  const internalUsers = buildInternalUsers();
  const orders = buildOrders(partners);
  const licenseKeys = buildLicenseKeys(partners, internalUsers);
  const calls = buildCalls(partners);
  const emails = buildEmails(partners);

  fs.mkdirSync(OUT, { recursive: true });

  const write = (name, data) => {
    fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2), "utf8");
  };

  write("partners.json", partners);
  write("orders.json", orders);
  write("licenseKeys.json", licenseKeys);
  write("internalUsers.json", internalUsers);
  write("calls.json", calls);
  write("emails.json", emails);
  write("salesTeam.json", {
    reps: SALES_TEAM.map((r, i) => ({
      id: `rep-${String(i + 1).padStart(3, "0")}`,
      name: r.name,
      region: r.region,
    })),
  });
  write(
    "licenseTypes.json",
    { types: LICENSE_TYPES.map((t) => ({ power: t.power, primaryLicenseSc: t.primaryLicenseSc, productEdition: t.productEdition })) },
  );
  write("products.json", [
    {
      sku: "PBX-ENT-AI-ANN",
      name: "Phone System Enterprise / AI Edition - Annual (per SC / year)",
      priceUsd: 210,
      billing: "annual per simultaneous call",
      highlights: ["Enterprise + AI features", "Provisioning API", "Advanced queues"],
    },
    {
      sku: "PBX-PRO-ANN",
      name: "Phone System Professional - Annual (per SC / year)",
      priceUsd: 145,
      billing: "annual per simultaneous call",
      highlights: ["CRM integration", "Call flows", "Reporting"],
    },
    {
      sku: "PBX-BASIC-ANN",
      name: "Phone System - Basic Annual (per SC / year)",
      priceUsd: 95,
      billing: "annual per simultaneous call",
      highlights: ["Basic queues", "Softphones", "Standard reporting"],
    },
    {
      sku: "PBX-HOST",
      name: "Hosted cloud PBX",
      priceUsd: 0,
      billing: "usage + hosting tier",
      highlights: ["Managed updates", "Elastic capacity", "SBC options"],
    },
  ]);

  console.log("Wrote PBX mock files to", OUT);
}

main();
