/**
 * Business insights for the admin dashboard (/admin/insights): top advertisers,
 * who texts the most, excessive-picture-request flags, an engagement
 * leaderboard, and bump/ad activity. Data is read in bounded/paged chunks from
 * the stores (lib/*-store) and aggregated here in pure functions, so it works
 * identically in file (dev) and Supabase modes and is easy to test.
 *
 * Everything is scoped to a rolling window (default 30 days) for the activity
 * metrics; ad counts and the funnel are all-time.
 */
import { parseCommand } from "@/lib/commands";
import {
  listAdsLite,
  listBumpsSince,
  listInboundSince,
  type InsightAd,
  type InsightBump,
  type InsightMessage,
} from "@/lib/engine-store";
import { listLedgerSince, listRevealsSince, type LedgerSince, type RevealSince } from "@/lib/store";
import { getEngineSettings } from "@/lib/settings";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TOP_N = 15;

export interface TopAdvertiser {
  phone: string;
  adsPosted: number;
  adsSold: number;
  creditsSpent: number; // in window
  bumps: number; // all-time
  lastActiveAt: string | null;
}
export interface TopSender {
  address: string;
  messages: number; // inbound, in window
  pics: number; // PIC requests, in window
}
export interface PicHeavy {
  address: string;
  pics1h: number;
  pics24h: number;
  pics7d: number;
  flagged: boolean;
}
/** Website number look-ups ("Show number", item 23) — the scraper signature. */
export interface RevealHeavy {
  phone: string;
  reveals24h: number;
  revealsWindow: number;
  flagged: boolean;
}
export interface EngagementRow {
  address: string;
  messages: number;
  ads: number;
  pics: number;
  bumps: number;
  purchases: number;
  score: number;
}
export interface Insights {
  windowDays: number;
  since: string;
  generatedAtMs: number;
  picThresholdPerDay: number;
  revealThresholdPerDay: number;
  totals: {
    inboundMessages: number;
    uniqueSenders: number;
    adsAllTime: number;
    adsInWindow: number;
    bumpsAllTime: number;
    bumpsInWindow: number;
    creditsSpentInWindow: number;
    creditsPurchasedInWindow: number;
  };
  adFunnel: {
    pending: number;
    approved: number;
    sold: number;
    rejected: number;
    expired: number;
  };
  topAdvertisers: TopAdvertiser[];
  topSenders: TopSender[];
  picHeavy: PicHeavy[];
  revealHeavy: RevealHeavy[];
  engagement: EngagementRow[];
  topBumpedAds: { adId: number; ownerPhone: string; bumps: number }[];
}

interface RawData {
  inbound: InsightMessage[];
  bumpsAll: InsightBump[];
  ads: InsightAd[];
  ledgerWindow: LedgerSince[];
  reveals: RevealSince[];
}

/** Pure aggregation — no I/O, so it is straightforward to unit test. */
export function computeInsights(
  data: RawData,
  opts: {
    nowMs: number;
    windowDays: number;
    picThresholdPerDay: number;
    revealThresholdPerDay: number;
  },
): Insights {
  const { nowMs, windowDays, picThresholdPerDay, revealThresholdPerDay } = opts;
  const sinceMs = nowMs - windowDays * DAY;
  const since = new Date(sinceMs).toISOString();

  // ---- ads: owner map, per-owner tallies, funnel ----
  const adOwner = new Map<number, string>();
  const adFunnel = { pending: 0, approved: 0, sold: 0, rejected: 0, expired: 0 };
  const owner = new Map<
    string,
    { adsPosted: number; adsSold: number; adsInWindow: number; lastAdAt: number }
  >();
  const ownerOf = (p: string) => {
    let o = owner.get(p);
    if (!o) owner.set(p, (o = { adsPosted: 0, adsSold: 0, adsInWindow: 0, lastAdAt: 0 }));
    return o;
  };
  let adsInWindow = 0;
  for (const ad of data.ads) {
    adOwner.set(ad.id, ad.ownerPhone);
    if (ad.status in adFunnel) adFunnel[ad.status as keyof typeof adFunnel]++;
    if (ad.ownerPhone) {
      const o = ownerOf(ad.ownerPhone);
      o.adsPosted++;
      if (ad.status === "sold") o.adsSold++;
      const created = Date.parse(ad.createdAt);
      o.lastAdAt = Math.max(o.lastAdAt, created);
      if (created >= sinceMs) {
        o.adsInWindow++;
        adsInWindow++;
      }
    }
  }

  // ---- bumps: totals, per-ad, per-owner ----
  const bumpsPerAd = new Map<number, number>();
  const bumpsPerOwner = new Map<string, number>();
  let bumpsInWindow = 0;
  for (const b of data.bumpsAll) {
    bumpsPerAd.set(b.adId, (bumpsPerAd.get(b.adId) ?? 0) + 1);
    const o = adOwner.get(b.adId);
    if (o) bumpsPerOwner.set(o, (bumpsPerOwner.get(o) ?? 0) + 1);
    if (Date.parse(b.requestedAt) >= sinceMs) bumpsInWindow++;
  }
  const topBumpedAds = [...bumpsPerAd.entries()]
    .map(([adId, bumps]) => ({ adId, ownerPhone: adOwner.get(adId) ?? "", bumps }))
    .sort((a, b) => b.bumps - a.bumps || a.adId - b.adId)
    .slice(0, TOP_N);

  // ---- inbound messages: sender counts, pic requests ----
  const sender = new Map<
    string,
    { messages: number; pics: number; adsTexted: number; bumpTexted: number; lastAt: number; picTimes: number[] }
  >();
  const senderOf = (a: string) => {
    let s = sender.get(a);
    if (!s) sender.set(a, (s = { messages: 0, pics: 0, adsTexted: 0, bumpTexted: 0, lastAt: 0, picTimes: [] }));
    return s;
  };
  for (const m of data.inbound) {
    if (!m.address) continue;
    const s = senderOf(m.address);
    s.messages++;
    s.lastAt = Math.max(s.lastAt, Date.parse(m.createdAt));
    const cmd = parseCommand(m.body || "");
    if (cmd.kind === "pic") {
      s.pics++;
      s.picTimes.push(Date.parse(m.createdAt));
    } else if (cmd.kind === "ad") {
      s.adsTexted++;
    } else if (cmd.kind === "bump") {
      s.bumpTexted++;
    }
  }

  const topSenders: TopSender[] = [...sender.entries()]
    .map(([address, s]) => ({ address, messages: s.messages, pics: s.pics }))
    .sort((a, b) => b.messages - a.messages || a.address.localeCompare(b.address))
    .slice(0, TOP_N);

  const picHeavy: PicHeavy[] = [...sender.entries()]
    .filter(([, s]) => s.pics > 0)
    .map(([address, s]) => {
      const pics1h = s.picTimes.filter((t) => t >= nowMs - HOUR).length;
      const pics24h = s.picTimes.filter((t) => t >= nowMs - DAY).length;
      const pics7d = s.picTimes.filter((t) => t >= nowMs - 7 * DAY).length;
      return {
        address,
        pics1h,
        pics24h,
        pics7d,
        flagged: picThresholdPerDay > 0 && pics24h > picThresholdPerDay,
      };
    })
    .sort((a, b) => b.pics24h - a.pics24h || b.pics1h - a.pics1h || a.address.localeCompare(b.address))
    .slice(0, TOP_N);

  // ---- website number look-ups (item 23): excessive-reveal flags ----
  // One log row per (member, ad), so these counts are DISTINCT sellers'
  // numbers revealed — free repeats never inflate them.
  const revealTimes = new Map<string, number[]>();
  for (const r of data.reveals) {
    let times = revealTimes.get(r.phone);
    if (!times) revealTimes.set(r.phone, (times = []));
    times.push(Date.parse(r.at));
  }
  const revealHeavy: RevealHeavy[] = [...revealTimes.entries()]
    .map(([phone, times]) => {
      const reveals24h = times.filter((t) => t >= nowMs - DAY).length;
      return {
        phone,
        reveals24h,
        revealsWindow: times.length,
        flagged: revealThresholdPerDay > 0 && reveals24h > revealThresholdPerDay,
      };
    })
    .sort(
      (a, b) =>
        b.reveals24h - a.reveals24h ||
        b.revealsWindow - a.revealsWindow ||
        a.phone.localeCompare(b.phone),
    )
    .slice(0, TOP_N);

  // ---- ledger: spend / purchases per phone (window) ----
  const spentPerPhone = new Map<string, number>();
  const purchasesPerPhone = new Map<string, number>();
  let creditsSpentInWindow = 0;
  let creditsPurchasedInWindow = 0;
  for (const l of data.ledgerWindow) {
    if (l.kind === "spend") {
      const amt = -l.delta; // spends are negative deltas
      spentPerPhone.set(l.phone, (spentPerPhone.get(l.phone) ?? 0) + amt);
      creditsSpentInWindow += amt;
    } else if (l.kind === "purchase") {
      purchasesPerPhone.set(l.phone, (purchasesPerPhone.get(l.phone) ?? 0) + 1);
      creditsPurchasedInWindow += l.delta;
    }
  }

  // ---- top advertisers (rank by ads posted, then credits spent) ----
  const topAdvertisers: TopAdvertiser[] = [...owner.entries()]
    .map(([phone, o]) => {
      const lastMsg = sender.get(phone)?.lastAt ?? 0;
      const lastActiveMs = Math.max(o.lastAdAt, lastMsg);
      return {
        phone,
        adsPosted: o.adsPosted,
        adsSold: o.adsSold,
        creditsSpent: spentPerPhone.get(phone) ?? 0,
        bumps: bumpsPerOwner.get(phone) ?? 0,
        lastActiveAt: lastActiveMs ? new Date(lastActiveMs).toISOString() : null,
      };
    })
    .sort((a, b) => b.adsPosted - a.adsPosted || b.creditsSpent - a.creditsSpent || a.phone.localeCompare(b.phone))
    .slice(0, TOP_N);

  // ---- engagement leaderboard (composite score) ----
  const everyone = new Set<string>([...owner.keys(), ...sender.keys()]);
  const engagement: EngagementRow[] = [...everyone]
    .map((address) => {
      const s = sender.get(address);
      const o = owner.get(address);
      const messages = s?.messages ?? 0;
      const ads = o?.adsPosted ?? 0;
      const pics = s?.pics ?? 0;
      const bumps = bumpsPerOwner.get(address) ?? 0;
      const purchases = purchasesPerPhone.get(address) ?? 0;
      // Weight the actions that signal real value higher than raw chatter.
      const score = messages + ads * 3 + pics + bumps * 2 + purchases * 5;
      return { address, messages, ads, pics, bumps, purchases, score };
    })
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
    .slice(0, TOP_N);

  return {
    windowDays,
    since,
    generatedAtMs: nowMs,
    picThresholdPerDay,
    revealThresholdPerDay,
    totals: {
      inboundMessages: data.inbound.length,
      uniqueSenders: sender.size,
      adsAllTime: data.ads.length,
      adsInWindow,
      bumpsAllTime: data.bumpsAll.length,
      bumpsInWindow,
      creditsSpentInWindow,
      creditsPurchasedInWindow,
    },
    adFunnel,
    topAdvertisers,
    topSenders,
    picHeavy,
    revealHeavy,
    engagement,
    topBumpedAds,
  };
}

/** Fetch the raw rows and aggregate. Window in days (default 30). */
export async function getInsights(windowDays = 30): Promise<Insights> {
  const nowMs = Date.now();
  const since = new Date(nowMs - windowDays * DAY).toISOString();
  const settings = await getEngineSettings();
  const [inbound, bumpsAll, ads, ledgerWindow, reveals] = await Promise.all([
    listInboundSince(since),
    listBumpsSince(null),
    listAdsLite(),
    listLedgerSince(since),
    listRevealsSince(since), // degrades to [] when migration 9979 is unpasted
  ]);
  return computeInsights(
    { inbound, bumpsAll, ads, ledgerWindow, reveals },
    {
      nowMs,
      windowDays,
      picThresholdPerDay: settings.picAbusePerDay,
      revealThresholdPerDay: settings.revealAbusePerDay,
    },
  );
}
