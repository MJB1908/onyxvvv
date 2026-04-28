"use strict";

const snapshotStore = require("./snapshotStore");

/**
 * Provides live ERP data from snapshots instead of mock data.
 * Falls back to mock data if snapshot not found.
 */

function getSnapshotOrMock(repEmail) {
  if (!repEmail) return null;
  return snapshotStore.loadSnapshot(repEmail);
}

function getRepByName(name, snapshot) {
  if (!snapshot?.rep) return null;
  return snapshot.rep;
}

function getNextCallsForSeller(sellerName, snapshot, limit = 8) {
  if (!snapshot?.calls) return { next: null, queue: [] };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mine = snapshot.calls.filter((c) => c.seller === sellerName);
  const upcoming = mine
    .filter((c) => {
      if (c.status !== "scheduled") return false;
      const d = new Date(`${c.date}T12:00:00`);
      return d >= today;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  return {
    next: upcoming[0] || null,
    queue: upcoming.slice(0, limit),
  };
}

function insightsForSeller(sellerName, snapshot) {
  if (!snapshot) return { rep: null, partnerCount: 0, orderCount: 0, orderTotalUsd: 0 };

  const rep = getRepByName(sellerName, snapshot);
  const partners = snapshot.partners || [];
  const orders = snapshot.orders || [];
  const calls = snapshot.calls || [];

  const owned = partners.filter((p) => p.accountOwnerName === sellerName);
  const ids = new Set(owned.map((p) => p.id));
  const myOrders = orders.filter((o) => ids.has(o.resellerId));
  const revenue = myOrders.reduce((s, o) => s + Number(o.totalUsd || 0), 0);
  const myCalls = calls.filter((c) => c.seller === sellerName);
  const scheduled = calls.filter((c) => c.seller === sellerName && c.status === "scheduled").length;

  const today = new Date();
  const y = today.getFullYear();
  const sumYear = (yr) =>
    myOrders.filter((o) => new Date(o.date).getFullYear() === yr).reduce((s, o) => s + Number(o.totalUsd || 0), 0);
  const sumThisYear = sumYear(y);
  const sumLastYear = sumYear(y - 1);
  const revenueYoYPercent = sumLastYear > 0 ? Math.round(((sumThisYear - sumLastYear) / sumLastYear) * 100) : 8;

  const in90 = new Date(today);
  in90.setDate(in90.getDate() + 90);
  const renewalsIn90Days = myOrders.filter((o) => {
    if (o.type !== "Renewal") return false;
    const d = new Date(o.date);
    return d >= today && d <= in90;
  }).length;

  const ago180 = new Date(today);
  ago180.setDate(ago180.getDate() - 180);
  const upgradeSignals = myOrders.filter((o) => o.type === "Upgrade" && new Date(o.date) >= ago180).length;

  const largeScOrders = myOrders.filter((o) => Number(o.quantity || 0) >= 16).length;

  let stalledPartnerCount = 0;
  for (const p of owned) {
    const completed = calls
      .filter((c) => c.partnerId === p.id && c.seller === sellerName && c.status === "completed")
      .sort((a, b) => b.date.localeCompare(a.date));
    const last = completed[0]?.date;
    if (!last) {
      stalledPartnerCount += 1;
      continue;
    }
    const days = (today - new Date(`${last}T12:00:00`)) / 86400000;
    if (days > 150) stalledPartnerCount += 1;
  }

  const salesForceReality = {
    yearlyCallsPerRep: 2000,
    yearlyWebMeetingsPerRep: 200,
    hoursOnCallsPerYear: 170,
    hoursOnWebMeetingsPerYear: 125,
    pctYearlyTimeOnLiveComms: 15,
    pctYearlyTimePrePostMeeting: 35,
  };

  return {
    rep: rep || { id: null, name: sellerName, region: "—" },
    partnerCount: owned.length,
    orderCount: myOrders.length,
    orderTotalUsd: Math.round(revenue),
    callCount: myCalls.length,
    scheduledCalls: scheduled,
    openOrdersPending: orders.filter((o) => ids.has(o.resellerId) && o.status === "Pending").length,
    revenueYoYPercent,
    renewalsIn90Days,
    upgradeSignals,
    largeScOrders16Plus: largeScOrders,
    stalledPartnerCount,
    salesForceReality,
  };
}

function alertsForSeller(sellerName, snapshot) {
  if (!snapshot) return { alerts: [] };

  const partners = snapshot.partners || [];
  const orders = snapshot.orders || [];
  const calls = snapshot.calls || [];

  const owned = partners.filter((p) => p.accountOwnerName === sellerName);
  const ids = new Set(owned.map((p) => p.id));
  const alerts = [];
  const today = new Date();

  for (const p of owned) {
    const ods = orders.filter((o) => o.resellerId === p.id && o.status === "Overdue");
    if (ods.length) {
      alerts.push({
        severity: "high",
        type: "overdue",
        title: `Overdue / attention: ${p.companyName}`,
        detail: `${ods.length} order(s) not cleared — align with finance and partner.`,
        partnerId: p.id,
      });
    }
    const partnerCalls = calls.filter((c) => c.partnerId === p.id && c.seller === sellerName);
    const completed = partnerCalls.filter((c) => c.status === "completed").sort((a, b) => b.date.localeCompare(a.date));
    const missedRecent = partnerCalls.filter((c) => c.status === "missed" && new Date(c.date) >= new Date(today.getFullYear(), today.getMonth() - 2, 1));
    if (missedRecent.length >= 2) {
      alerts.push({
        severity: "warning",
        type: "response",
        title: `Low response: ${p.companyName}`,
        detail: "Multiple missed calls in recent weeks — try alternate channel or exec sponsor.",
        partnerId: p.id,
      });
    }
    const last = completed[0]?.date;
    if (last) {
      const days = (today - new Date(`${last}T12:00:00`)) / 86400000;
      if (days > 200) {
        alerts.push({
          severity: "warning",
          type: "stalled",
          title: `Stalled engagement: ${p.companyName}`,
          detail: "No completed call in extended window — schedule QBR or renewal review.",
          partnerId: p.id,
        });
      }
    }
  }

  const bigNew = orders.filter(
    (o) => ids.has(o.resellerId) && Number(o.quantity || 0) >= 16 && o.type === "New" && new Date(o.date) >= new Date(today.getFullYear(), today.getMonth() - 3, 1),
  );
  for (const o of bigNew.slice(0, 3)) {
    alerts.push({
      severity: "info",
      type: "large_sc",
      title: `New sale ${o.quantity} SC+`,
      detail: `${o.company} — ${o.orderId} (${o.type})`,
      partnerId: o.resellerId,
    });
  }

  alerts.push({
    severity: "info",
    type: "poc",
    title: "PoC / trial follow-up (demo)",
    detail: "Review open proof-of-concept commitments and conversion dates in ERP.",
  });

  return { alerts: alerts.slice(0, 12) };
}

function preCallBrief(sellerName, partnerId, snapshot) {
  if (!snapshot) return { ok: false, message: "No snapshot found", brief: null };

  const partners = snapshot.partners || [];
  const orders = snapshot.orders || [];
  const calls = snapshot.calls || [];

  const nextPack = getNextCallsForSeller(sellerName, snapshot, 1);
  const next = nextPack.next;
  const pid = partnerId || next?.partnerId;
  if (!pid) {
    return {
      ok: false,
      message: "No partner context — add a scheduled call or open this page from Call queue.",
      brief: null,
    };
  }
  const p = partners.find((x) => x.id === pid);
  if (!p) {
    return { ok: false, message: "Partner not found.", brief: null };
  }
  const myOrders = orders.filter((o) => o.resellerId === pid).sort((a, b) => b.date.localeCompare(a.date));
  const revenue = myOrders.reduce((s, o) => s + Number(o.totalUsd || 0), 0);
  const partnerCalls = calls
    .filter((c) => c.partnerId === pid && c.seller === sellerName)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  const renewals = myOrders.filter((o) => o.type === "Renewal").slice(0, 4);
  const upgrades = myOrders.filter((o) => o.type === "Upgrade").slice(0, 3);

  return {
    ok: true,
    brief: {
      partner: {
        id: p.id,
        companyName: p.companyName,
        salesRegion: p.salesRegion,
        country: p.country,
        distributorLevel: p.distributorLevel,
        contactName: p.contactName,
        accountOwnerEmail: p.accountOwnerEmail,
      },
      dashboardLink: `#/data/partners`,
      nextCall: next && next.partnerId === pid ? { id: next.id, date: next.date, notes: next.notes } : null,
      orderBookUsd: Math.round(revenue),
      recentOrders: myOrders.slice(0, 5).map((o) => ({
        orderId: o.orderId,
        date: o.date,
        type: o.type,
        totalUsd: o.totalUsd,
        status: o.status,
      })),
      renewalsPreview: renewals.map((o) => ({ orderId: o.orderId, date: o.date, totalUsd: o.totalUsd })),
      upgradesPreview: upgrades.map((o) => ({ orderId: o.orderId, date: o.date, totalUsd: o.totalUsd })),
      lastCalls: partnerCalls.map((c) => ({
        id: c.id,
        date: c.date,
        durationDisplay: c.durationDisplay,
        sentiment: c.sentiment,
        status: c.status,
        notes: c.notes,
      })),
      suggestedAgenda: [
        "Partner revenue & SC trajectory vs. prior period",
        "Upcoming renewals, upgrades, and open quotes",
        "Hosting vs on-prem / private cloud alignment",
        "Stalled items, helpdesk noise, and executive alignment",
      ],
      predictedObjections: [
        "Budget timing vs. renewal window",
        "Competitive UCaaS / bundled telco pricing",
        "Technical migration effort from legacy PBX",
      ],
      revenueTrendNarrative:
        myOrders.length >= 3
          ? "Demo signal: order mix shows recurring renewal weight; probe for upsell on Enterprise / AI annual lines."
          : "Limited order history in demo — confirm pipeline verbally.",
    },
  };
}

function prospectsForSeller(sellerName, snapshot) {
  if (!snapshot) return { region: "—", prospects: [] };

  const partners = snapshot.partners || [];
  const rep = getRepByName(sellerName, snapshot);
  if (!rep) return { region: "—", prospects: [] };
  const inRegion = partners.filter((p) => p.salesRegion === rep.region);
  return {
    region: rep.region,
    prospects: inRegion.slice(0, 14).map((p) => ({
      partnerId: p.id,
      companyName: p.companyName,
      salesRegion: p.salesRegion,
      country: p.country,
      distributorLevel: p.distributorLevel,
      contactName: p.contactName,
      accountOwnerName: p.accountOwnerName,
    })),
  };
}

function matchCaller(rawPhone, snapshot) {
  if (!snapshot) return { matched: false, callerDigits: "", candidates: [] };

  const partners = snapshot.partners || [];
  const salesTeam = { reps: snapshot.rep ? [snapshot.rep] : [] };

  function digitsOnly(s) {
    return String(s == null ? "" : s).replace(/\D/g, "");
  }

  const callerDigits = digitsOnly(rawPhone);
  if (callerDigits.length < 7) {
    return { matched: false, callerDigits, candidates: [] };
  }
  const tail = callerDigits.slice(-10);
  const candidates = [];
  for (const p of partners) {
    for (const field of ["phone", "contactPhone", "accountOwnerPhone"]) {
      const fieldDigits = digitsOnly(p[field]);
      if (!fieldDigits || fieldDigits.length < 7) continue;
      const fieldTail = fieldDigits.slice(-10);
      const minLen = Math.min(tail.length, fieldTail.length, 10);
      if (minLen < 7) continue;
      if (tail.slice(-minLen) === fieldTail.slice(-minLen)) {
        candidates.push({
          partner: {
            id: p.id,
            partnerCode: p.partnerCode,
            companyName: p.companyName,
            country: p.country,
            distributorLevel: p.distributorLevel,
            contactName: p.contactName,
            salesRegion: p.salesRegion,
            phone: p.phone,
            contactPhone: p.contactPhone,
          },
          accountOwner: salesTeam.reps.find((r) => r.name === p.accountOwnerName) || {
            name: p.accountOwnerName,
            email: p.accountOwnerEmail,
          },
          matchedField: field,
          matchedDigits: minLen,
        });
        break;
      }
    }
  }
  candidates.sort((a, b) => b.matchedDigits - a.matchedDigits);
  return { matched: candidates.length > 0, callerDigits, candidates };
}

function homeDashboardForSeller(sellerName, snapshot) {
  if (!snapshot) {
    return {
      rep: null,
      scope: { mode: "all" },
      kpis: {},
      installMix: {},
      accountHeader: {},
      newDeals: [],
      ongoingDeals: [],
      communicationLog: [],
      renewalRadar: [],
      nextBestAction: {},
    };
  }

  const insights = insightsForSeller(sellerName, snapshot);
  const alerts = alertsForSeller(sellerName, snapshot);
  const partners = snapshot.partners || [];
  const orders = snapshot.orders || [];
  const calls = snapshot.calls || [];

  return {
    rep: insights.rep,
    scope: { mode: "all" },
    kpis: {
      installBase: insights.partnerCount,
      forecastLabel: `$${formatMoneyCompact(insights.orderTotalUsd)}`,
      renewalRate: 75,
      yoyGrowth: insights.revenueYoYPercent,
      trialKeys: orders.filter((o) => o.type === "New").length,
      providedLeads: partners.length,
      qualified: orders.filter((o) => o.status === "Invoiced").length,
      upcomingProposals: orders.filter((o) => o.status === "Pending").length,
      openOpportunitiesUsd: Math.round(orders.filter((o) => o.status !== "Paid").reduce((s, o) => s + Number(o.totalUsd || 0), 0)),
    },
    installMix: { total: 0, enterprisePct: 0, proPct: 0, basicPct: 0 },
    accountHeader: {
      name: `${sellerName} portfolio`,
      level: "Portfolio view",
      region: insights.rep?.region || "—",
      partnerHealth: "Stable",
      openTickets: orders.filter((o) => o.status === "Overdue").length,
      newProjects: orders.filter((o) => o.type === "New").length,
      installBase: insights.partnerCount,
      growthBadge: "+5%",
    },
    newDeals: orders.slice(0, 10).map((o) => ({
      customer: o.company,
      license: "N/A",
      stage: "Active",
      close: o.date,
      owner: sellerName,
      status: o.status,
      partnerId: o.resellerId,
    })),
    ongoingDeals: orders.filter((o) => o.status !== "Paid").slice(0, 5).map((o) => ({
      customer: o.company,
      contract: "N/A",
      type: o.type,
      stage: "Active",
      close: o.date,
      status: o.status,
    })),
    communicationLog: [],
    renewalRadar: orders.filter((o) => o.type === "Renewal").slice(0, 5).map((o) => ({
      customer: o.company,
      due: o.date,
      proposal: o.status === "Pending" ? "No" : "Yes",
    })),
    nextBestAction: {
      title: "Schedule partner reviews this month",
      bullets: alerts.alerts.slice(0, 3).map((a) => a.title),
    },
  };
}

function formatMoneyCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.round(value || 0));
}

module.exports = {
  getSnapshotOrMock,
  getRepByName,
  getNextCallsForSeller,
  insightsForSeller,
  alertsForSeller,
  preCallBrief,
  prospectsForSeller,
  matchCaller,
  homeDashboardForSeller,
};
