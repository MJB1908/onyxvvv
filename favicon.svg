"use strict";

const {
  partners,
  orders,
  licenseKeys,
  calls,
  emails,
  internalUsers,
  products,
  salesTeam,
  licenseTypes,
} = require("./mock/context");

function getRepByName(name) {
  return salesTeam.reps.find((r) => r.name === name);
}

function getNextCallsForSeller(sellerName, limit = 8) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mine = calls.filter((c) => c.seller === sellerName);
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

function insightsForSeller(sellerName) {
  const rep = getRepByName(sellerName);
  const owned = partners.filter((p) => p.accountOwnerName === sellerName);
  const ids = new Set(owned.map((p) => p.id));
  const myOrders = orders.filter((o) => ids.has(o.resellerId));
  const revenue = myOrders.reduce((s, o) => s + Number(o.totalUsd), 0);
  const myCalls = calls.filter((c) => c.seller === sellerName);
  const scheduled = calls.filter((c) => c.seller === sellerName && c.status === "scheduled").length;
  const today = new Date();
  const y = today.getFullYear();
  const sumYear = (yr) =>
    myOrders.filter((o) => new Date(o.date).getFullYear() === yr).reduce((s, o) => s + Number(o.totalUsd), 0);
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

  const largeScOrders = myOrders.filter((o) => Number(o.quantity) >= 16).length;

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

  /** From org benchmark deck (PDF): time in communication & pre/post meeting. */
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

function alertsForSeller(sellerName) {
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
    (o) => ids.has(o.resellerId) && Number(o.quantity) >= 16 && o.type === "New" && new Date(o.date) >= new Date(today.getFullYear(), today.getMonth() - 3, 1),
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

function preCallBrief(sellerName, partnerId) {
  const nextPack = getNextCallsForSeller(sellerName, 1);
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
  const revenue = myOrders.reduce((s, o) => s + Number(o.totalUsd), 0);
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

function prospectsForSeller(sellerName) {
  const rep = getRepByName(sellerName);
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

function formatMoneyCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.round(value || 0));
}

function toDateValue(isoDate) {
  return new Date(`${isoDate}T12:00:00`).getTime();
}

function stageFromOrder(order) {
  if (order.status === "Overdue") return "Escalate";
  if (order.status === "Pending") return "Negotiation";
  if (order.status === "Invoiced") return "Proposal sent";
  if (order.type === "Renewal") return "Renewal";
  if (order.type === "Upgrade") return "Discovery";
  return "Qualified";
}

function healthFromPartnerSignals(partner, partnerOrders, partnerCalls) {
  const overdue = partnerOrders.filter((o) => o.status === "Overdue").length;
  const pending = partnerOrders.filter((o) => o.status === "Pending").length;
  const positiveCalls = partnerCalls.filter((c) => c.status === "completed" && c.sentiment === "positive").length;
  const negativeCalls = partnerCalls.filter((c) => c.status === "completed" && c.sentiment === "negative").length;
  if (overdue >= 2 || negativeCalls >= 3) return "At risk";
  if (pending >= 2 || negativeCalls > positiveCalls) return "Needs attention";
  if (positiveCalls >= 2) return "Growing";
  return "Stable";
}

function homeDashboardForSeller(sellerName, partnerId) {
  const rep = getRepByName(sellerName);
  const ownedPartners = partners.filter((p) => p.accountOwnerName === sellerName);
  const partnerIds = new Set(ownedPartners.map((p) => p.id));
  const selectedPartner =
    typeof partnerId === "string" && partnerId && partnerId !== "all"
      ? ownedPartners.find((p) => p.id === partnerId) || null
      : null;
  const scopedIds = selectedPartner ? new Set([selectedPartner.id]) : partnerIds;
  const scopedPartners = selectedPartner ? [selectedPartner] : ownedPartners;
  const scopedOrders = orders.filter((o) => scopedIds.has(o.resellerId));
  const scopedCalls = calls.filter((c) => scopedIds.has(c.partnerId) && c.seller === sellerName);
  const scopedEmails = emails.filter((e) => scopedIds.has(e.partnerId));

  const installMix = scopedOrders.reduce(
    (acc, order) => {
      const d = String(order.description || "").toLowerCase();
      if (d.includes("enterprise")) acc.enterprise += 1;
      else if (d.includes("pro")) acc.pro += 1;
      else acc.basic += 1;
      return acc;
    },
    { enterprise: 0, pro: 0, basic: 0 },
  );
  const installTotal = installMix.enterprise + installMix.pro + installMix.basic;
  const installMixPct = {
    enterprise: installTotal ? Math.round((installMix.enterprise / installTotal) * 100) : 0,
    pro: installTotal ? Math.round((installMix.pro / installTotal) * 100) : 0,
    basic: installTotal ? Math.round((installMix.basic / installTotal) * 100) : 0,
  };

  const now = Date.now();
  const renewalOrders = scopedOrders
    .filter((o) => o.type === "Renewal")
    .sort((a, b) => toDateValue(a.date) - toDateValue(b.date));
  const dueSoon = renewalOrders.filter((o) => toDateValue(o.date) >= now).slice(0, 5);
  const renewalRate =
    renewalOrders.length > 0
      ? Math.round(((renewalOrders.length - scopedOrders.filter((o) => o.status === "Overdue" && o.type === "Renewal").length) / renewalOrders.length) * 100)
      : 0;

  const deals = scopedOrders
    .slice()
    .sort((a, b) => toDateValue(b.date) - toDateValue(a.date))
    .slice(0, 10)
    .map((o) => ({
      customer: o.company,
      license: o.description.includes("Enterprise")
        ? "128SC ENT"
        : o.description.includes("PRO")
          ? "32SC PRO"
          : "8SC Basic",
      stage: stageFromOrder(o),
      close: o.date,
      owner: sellerName,
      status: o.status,
      partnerId: o.resellerId,
      partnerName: o.resellerName,
    }));

  const ongoingDeals = scopedOrders
    .filter((o) => o.status !== "Paid")
    .slice()
    .sort((a, b) => toDateValue(a.date) - toDateValue(b.date))
    .slice(0, 5)
    .map((o) => ({
      customer: o.company,
      contract: o.description.includes("Enterprise")
        ? "128SC ENT"
        : o.description.includes("PRO")
          ? "32SC PRO"
          : "8SC Basic",
      type: o.type,
      stage: stageFromOrder(o),
      close: o.date,
      status: o.status,
      partnerId: o.resellerId,
    }));

  const communicationLog = scopedEmails
    .slice()
    .sort((a, b) => toDateValue(b.date) - toDateValue(a.date))
    .slice(0, 6)
    .map((e) => {
      const ageDays = Math.max(1, Math.floor((now - toDateValue(e.date)) / 86400000));
      return {
        customer: e.partnerName,
        lastContact: ageDays === 1 ? "1 day ago" : `${ageDays} days ago`,
        mood: e.sentiment,
        nextStep:
          e.sentiment === "negative"
            ? "Escalate"
            : e.sentiment === "neutral"
              ? "Follow-up call"
              : "Send revised proposal",
      };
    });

  const ownedRevenue = scopedOrders.reduce((sum, o) => sum + Number(o.totalUsd), 0);
  const installBase = scopedOrders.reduce((sum, o) => sum + Number(o.quantity || 0), 0);
  const upcomingProposals = scopedOrders.filter((o) => o.status === "Pending").length;
  const openOpportunities = scopedOrders.filter((o) => o.status !== "Paid").reduce((sum, o) => sum + Number(o.totalUsd), 0);
  const nextActionAlerts = alertsForSeller(sellerName).alerts
    .filter((a) => !selectedPartner || a.partnerId === selectedPartner.id)
    .slice(0, 3)
    .map((a) => a.title);

  const focusPartner = selectedPartner || scopedPartners[0] || null;
  const partnerHealth = focusPartner
    ? healthFromPartnerSignals(
        focusPartner,
        scopedOrders.filter((o) => o.resellerId === focusPartner.id),
        scopedCalls.filter((c) => c.partnerId === focusPartner.id),
      )
    : "Stable";

  return {
    rep: rep || { id: null, name: sellerName, region: "—" },
    scope: selectedPartner
      ? {
          mode: "partner",
          partner: {
            id: selectedPartner.id,
            companyName: selectedPartner.companyName,
            distributorLevel: selectedPartner.distributorLevel,
            salesRegion: selectedPartner.salesRegion,
          },
        }
      : { mode: "all" },
    kpis: {
      installBase,
      forecastLabel: `$${formatMoneyCompact(ownedRevenue)}`,
      renewalRate,
      yoyGrowth: Math.max(-99, Math.min(99, Math.round((scopedOrders.filter((o) => o.type === "Upgrade").length / Math.max(1, scopedOrders.length)) * 100))),
      trialKeys: scopedOrders.filter((o) => o.type === "New").length,
      providedLeads: communicationLog.length,
      qualified: scopedOrders.filter((o) => o.status === "Invoiced").length,
      upcomingProposals,
      openOpportunitiesUsd: Math.round(openOpportunities),
    },
    installMix: {
      total: installTotal,
      enterprisePct: installMixPct.enterprise,
      proPct: installMixPct.pro,
      basicPct: installMixPct.basic,
    },
    accountHeader: {
      name: focusPartner ? focusPartner.companyName : `${sellerName} portfolio`,
      level: focusPartner ? focusPartner.distributorLevel : "Portfolio view",
      region: rep?.region || "—",
      partnerHealth,
      openTickets: scopedOrders.filter((o) => o.status === "Overdue").length,
      newProjects: scopedOrders.filter((o) => o.type === "New").length,
      installBase,
      growthBadge: `+${Math.max(1, Math.round((scopedOrders.filter((o) => o.status === "Paid").length / Math.max(1, scopedOrders.length)) * 20))}%`,
    },
    newDeals: deals,
    ongoingDeals,
    communicationLog,
    renewalRadar: dueSoon.map((o) => ({
      customer: o.company,
      due: o.date,
      proposal: o.status === "Pending" ? "No" : "Yes",
    })),
    nextBestAction: {
      title: focusPartner ? `Schedule ${focusPartner.companyName} review this month` : "Schedule top partner reviews this month",
      bullets: nextActionAlerts.length ? nextActionAlerts : ["Share Q2 promotion with all qualified partners in pipeline."],
    },
  };
}

module.exports = {
  getRepByName,
  getNextCallsForSeller,
  insightsForSeller,
  alertsForSeller,
  preCallBrief,
  prospectsForSeller,
  homeDashboardForSeller,
  partners,
  orders,
  licenseKeys,
  calls,
  emails,
  internalUsers,
  products,
  salesTeam,
  licenseTypes,
};
