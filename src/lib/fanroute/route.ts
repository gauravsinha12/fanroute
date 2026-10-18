import type { Market } from "./markets";

export interface ScoredMarket {
  market: Market;
  score: number; // 0..100 demand index
}

export interface RouteLeg {
  from: string;
  to: string;
  km: number;
  driveHours: number;
  crossing?: string; // ferry or tunnel needed on this leg
}

export interface TourDay {
  date: string; // ISO date
  kind: "show" | "travel" | "off";
  marketId: string;
  note?: string;
}

export interface RoutePlan {
  stops: ScoredMarket[];
  legs: RouteLeg[];
  days: TourDay[];
  totalKm: number;
  longestDriveHours: number;
}

export interface RouteOptions {
  shows: number;
  startId?: string;
  endId?: string;
  startDate?: string;
  maxDriveHours?: number;
  // How many demand points one extra 100 km of driving is worth giving up.
  travelPenaltyPer100Km?: number;
}

const EARTH_KM = 6371;
const ROAD_FACTOR = 1.22; // straight-line to typical road distance
const AVG_KMH = 88; // highway average including fuel stops

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

const ISLANDS: Record<string, string> = { GB: "Great Britain", IE: "Ireland" };

// Legs between Great Britain, Ireland and the continent need a ferry or the
// Channel Tunnel, which straight-line distance does not show.
export function waterCrossing(a: Market, b: Market): string | undefined {
  const ia = ISLANDS[a.country];
  const ib = ISLANDS[b.country];
  if (ia === ib) return undefined;
  if (ia && ib) return "Irish Sea ferry";
  if (ia === "Great Britain" || ib === "Great Britain") return "Channel crossing (ferry or Eurotunnel)";
  return "Ferry from Ireland";
}

export function roadKm(a: Market, b: Market): number {
  return Math.round(haversineKm(a, b) * ROAD_FACTOR);
}

// Distance used when choosing and ordering stops: a water crossing costs about
// as much time as 350 km of extra driving.
function costKm(a: Market, b: Market): number {
  return roadKm(a, b) + (waterCrossing(a, b) ? 350 : 0);
}

function pathKm(path: Market[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += costKm(path[i - 1], path[i]);
  return total;
}

// Cheapest place to insert `candidate` into `path`. Anchored ends never move:
// nothing goes before a fixed start or after a fixed end.
function bestInsertion(
  path: Market[],
  candidate: Market,
  fixedFirst: boolean,
  fixedLast: boolean,
): { index: number; addedKm: number } | undefined {
  let best: { index: number; addedKm: number } | undefined;
  for (let i = 0; i <= path.length; i++) {
    if (i === 0 && fixedFirst && path.length > 0) continue;
    if (i === path.length && fixedLast && path.length > 0) continue;
    let added: number;
    if (path.length === 0) added = 0;
    else if (i === 0) added = costKm(candidate, path[0]);
    else if (i === path.length) added = costKm(path[i - 1], candidate);
    else added = costKm(path[i - 1], candidate) + costKm(candidate, path[i]) - costKm(path[i - 1], path[i]);
    if (!best || added < best.addedKm) best = { index: i, addedKm: added };
  }
  return best;
}

// Reverse segments while it shortens the drive. The first stop stays put; the
// last one only when it's a fixed end (otherwise the tail may be reversed too).
function twoOpt(path: Market[], fixLast = true): Market[] {
  let best = path.slice();
  let improved = true;
  const lastK = fixLast ? 1 : 0;
  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 1 - lastK; i++) {
      for (let k = i + 1; k < best.length - lastK; k++) {
        const candidate = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        if (pathKm(candidate) + 1 < pathKm(best)) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function planRoute(candidates: ScoredMarket[], options: RouteOptions): RoutePlan {
  const maxDrive = options.maxDriveHours ?? 7;
  const penalty = options.travelPenaltyPer100Km ?? 2.5;
  const byId = new Map(candidates.map((c) => [c.market.id, c]));
  const sorted = candidates.slice().sort((a, b) => b.score - a.score);

  const start = options.startId ? byId.get(options.startId) : undefined;
  let end = options.endId ? byId.get(options.endId) : undefined;
  // Ending where you started is a round trip: the drive home is a leg, not a show.
  const roundTrip = Boolean(start && end && start.market.id === end.market.id);
  if (roundTrip) end = undefined;
  const shows = Math.max(1, Math.min(options.shows, candidates.length));

  const path: Market[] = [];
  const chosen = new Set<string>();
  if (start) {
    path.push(start.market);
    chosen.add(start.market.id);
  }
  if (end && !chosen.has(end.market.id)) {
    path.push(end.market);
    chosen.add(end.market.id);
  }
  if (path.length === 0 && sorted.length > 0) {
    path.push(sorted[0].market);
    chosen.add(sorted[0].market.id);
  }

  // Greedy: add the market with the best demand-minus-driving trade-off.
  while (chosen.size < shows) {
    let pick: { c: ScoredMarket; index: number; value: number } | undefined;
    for (const c of sorted) {
      if (chosen.has(c.market.id)) continue;
      const probe = roundTrip ? [...path, start!.market] : path;
      const ins = bestInsertion(probe, c.market, Boolean(start), Boolean(end) || roundTrip);
      if (!ins) continue;
      const value = c.score - (ins.addedKm / 100) * penalty;
      if (!pick || value > pick.value) pick = { c, index: Math.min(ins.index, path.length), value };
    }
    if (!pick) break;
    path.splice(pick.index, 0, pick.c.market);
    chosen.add(pick.c.market.id);
  }

  const order = (p: Market[]) => (p.length > 3 ? (roundTrip ? twoOpt([...p, start!.market]).slice(0, -1) : twoOpt(p, Boolean(end))) : p);
  const value = (p: Market[]) =>
    p.reduce((sum, m) => sum + (byId.get(m.id)?.score ?? 0), 0) - (pathKm(roundTrip ? [...p, start!.market] : p) / 100) * penalty;

  // Greedy insertion locks in early picks near the start. Swap pass: replace a
  // stop with an unused market whenever that raises demand minus driving.
  let ordered = order(path);
  let best = value(ordered);
  const fixed = new Set([start?.market.id, end?.market.id].filter((id): id is string => Boolean(id)));
  for (let round = 0, improved = true; improved && round < 40; round++) {
    improved = false;
    for (const out of ordered) {
      if (fixed.has(out.id)) continue;
      const without = ordered.filter((m) => m.id !== out.id);
      for (const c of sorted) {
        if (chosen.has(c.market.id)) continue;
        const probe = roundTrip ? [...without, start!.market] : without;
        const ins = bestInsertion(probe, c.market, Boolean(start), Boolean(end) || roundTrip);
        if (!ins) continue;
        const trial = without.slice();
        trial.splice(Math.min(ins.index, trial.length), 0, c.market);
        const reordered = order(trial);
        const v = value(reordered);
        if (v > best + 0.5) {
          chosen.delete(out.id);
          chosen.add(c.market.id);
          ordered = reordered;
          best = v;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  const stops = ordered.map((market) => byId.get(market.id)!);
  const legPath = roundTrip ? [...ordered, start!.market] : ordered;

  const legs: RouteLeg[] = [];
  for (let i = 1; i < legPath.length; i++) {
    const km = roadKm(legPath[i - 1], legPath[i]);
    const crossing = waterCrossing(legPath[i - 1], legPath[i]);
    // A crossing adds roughly half a day of check-in, sailing and customs.
    const hours = km / AVG_KMH + (crossing ? 4 : 0);
    legs.push({ from: legPath[i - 1].id, to: legPath[i].id, km, driveHours: Math.round(hours * 10) / 10, ...(crossing ? { crossing } : {}) });
  }

  // Calendar: one show per day; legs longer than the drive limit get travel
  // days, and a day off follows every five straight shows.
  const days: TourDay[] = [];
  let date = options.startDate ?? addDays(new Date().toISOString().slice(0, 10), 60);
  let showsSinceOff = 0;
  stops.forEach((stop, i) => {
    if (i > 0) {
      const leg = legs[i - 1];
      const travelDays = Math.max(0, Math.ceil(leg.driveHours / maxDrive) - 1);
      for (let t = 0; t < travelDays; t++) {
        days.push({ date, kind: "travel", marketId: stop.market.id, note: `${leg.driveHours} h drive to ${stop.market.name}, split over ${travelDays + 1} days` });
        date = addDays(date, 1);
      }
      if (showsSinceOff >= 5 && travelDays === 0) {
        days.push({ date, kind: "off", marketId: stop.market.id, note: "Rest day" });
        date = addDays(date, 1);
        showsSinceOff = 0;
      }
    }
    days.push({ date, kind: "show", marketId: stop.market.id });
    date = addDays(date, 1);
    showsSinceOff++;
  });
  if (roundTrip && legs.length >= stops.length) {
    const home = legs[legs.length - 1];
    days.push({ date, kind: "travel", marketId: start!.market.id, note: `${home.driveHours} h drive home to ${start!.market.name}` });
  }

  return {
    stops,
    legs,
    days,
    totalKm: legs.reduce((sum, leg) => sum + leg.km, 0),
    longestDriveHours: legs.reduce((max, leg) => Math.max(max, leg.driveHours), 0),
  };
}
