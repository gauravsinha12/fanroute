import { qlooGet } from "@/lib/qloo/client";
import type { QlooEntity, QlooHeatmapPoint, QlooParams } from "@/lib/qloo/types";
import { haversineKm } from "./route";
import { MARKETS_BY_ID, marketsIn, type Market, type Region } from "./markets";

export interface ArtistRef {
  id: string;
  name: string;
  popularity?: number;
  genres: string[];
  image?: string;
  disambiguation?: string;
}

export interface MarketScore {
  marketId: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  affinity: number; // Qloo affinity of this market's people for the artist's taste profile, 0..1
  demand: number; // 0..100 blend of affinity (75%) and metro size (25%)
  rank: number;
}

export interface MarketRanking {
  method: "destination-affinity" | "city-heatmaps";
  markets: MarketScore[];
}

export interface PlaceRef {
  id: string;
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
  affinity?: number;
  rating?: number;
  tags: string[];
}

export interface Hotspot {
  name?: string;
  lat: number;
  lon: number;
  affinity: number;
}

export interface MarketScout {
  marketId: string;
  name: string;
  hotspots: Hotspot[];
  venues: PlaceRef[];
  hangouts: PlaceRef[];
}

export interface BrandRef {
  id: string;
  name: string;
  affinity?: number;
  popularity?: number;
  categories: string[];
}

export interface AudienceProfile {
  age: Record<string, number>;
  gender: Record<string, number>;
  skew: string;
}

export interface Momentum {
  points: { date: string; percentile: number }[];
  changePts: number;
  summary: string;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const entitiesOf = (res: { results?: { entities?: QlooEntity[] } }) => res.results?.entities ?? [];

function toArtist(e: QlooEntity): ArtistRef {
  return {
    id: e.entity_id,
    name: e.name,
    popularity: e.popularity,
    genres: (e.tags ?? []).filter((t) => (t.type ?? t.id).includes("genre")).map((t) => t.name).slice(0, 5),
    image: e.properties?.image?.url,
    disambiguation: e.disambiguation,
  };
}

function toPlace(e: QlooEntity): PlaceRef {
  return {
    id: e.entity_id,
    name: e.name,
    address: e.properties?.address,
    lat: e.location?.lat,
    lon: e.location?.lon ?? e.location?.lng,
    affinity: e.query?.affinity,
    rating: e.properties?.business_rating,
    tags: (e.tags ?? []).map((t) => t.name).slice(0, 4),
  };
}

// ---------------------------------------------------------------- artists

export async function searchArtists(query: string, take = 6): Promise<ArtistRef[]> {
  const res = await qlooGet("/search", { query, types: "urn:entity:artist", take });
  return entitiesOf(res).map(toArtist);
}

export async function artistsByIds(ids: string[]): Promise<ArtistRef[]> {
  if (ids.length === 0) return [];
  const res = await qlooGet("/entities", { entity_ids: ids });
  return entitiesOf(res).map(toArtist);
}

// Accepts open.spotify.com/artist/<id> links or bare Spotify artist IDs.
export async function artistFromSpotify(link: string): Promise<ArtistRef | undefined> {
  const id = link.match(/artist[/:]([A-Za-z0-9]{22})/)?.[1] ?? (/^[A-Za-z0-9]{22}$/.test(link) ? link : undefined);
  if (!id) return undefined;
  const res = await qlooGet("/entities", { "external.spotify.ids": id });
  const found = entitiesOf(res)[0];
  return found ? toArtist(found) : undefined;
}

export async function resolveArtists(names: string[]): Promise<ArtistRef[]> {
  const found = await mapLimit(names, 4, async (name) => (await searchArtists(name, 1))[0]);
  return found.filter((a): a is ArtistRef => Boolean(a));
}

// ---------------------------------------------------------------- markets

function demandScores(raw: { market: Market; affinity: number }[]): MarketScore[] {
  const affs = raw.map((r) => r.affinity);
  const lo = Math.min(...affs);
  const hi = Math.max(...affs);
  const sizes = raw.map((r) => Math.log(r.market.metroMillions + 0.5));
  const sLo = Math.min(...sizes);
  const sHi = Math.max(...sizes);
  return raw
    .map((r, i) => {
      const a = hi > lo ? (r.affinity - lo) / (hi - lo) : 0.5;
      const s = sHi > sLo ? (sizes[i] - sLo) / (sHi - sLo) : 0.5;
      return {
        marketId: r.market.id,
        name: r.market.name,
        country: r.market.country,
        lat: r.market.lat,
        lon: r.market.lon,
        affinity: round(r.affinity, 3),
        demand: Math.round(100 * (0.75 * a + 0.25 * s)),
        rank: 0,
      };
    })
    .sort((a, b) => b.demand - a.demand)
    .map((m, i) => ({ ...m, rank: i + 1 }));
}

function nearestMarket(markets: Market[], lat: number, lon: number, maxKm: number): Market | undefined {
  let best: { market: Market; km: number } | undefined;
  for (const market of markets) {
    const km = haversineKm(market, { lat, lon });
    if (km <= maxKm && (!best || km < best.km)) best = { market, km };
  }
  return best?.market;
}

const sameName = (market: Market, e: QlooEntity) => {
  const names = [e.name, e.properties?.geocode?.name].filter(Boolean).map((n) => n!.toLowerCase());
  return names.includes(market.name.toLowerCase()) || names.includes(market.query.toLowerCase());
};

// Destination affinity: how strongly this taste profile gravitates to each
// city. Qloo scores destinations on one global scale, so cities are comparable.
// A country-wide list covers the strongest cities in one call; any market not
// in it gets its own call restricted to that city (about 0.4 s each).
async function rankByDestinations(signal: string[], region: Region): Promise<{ market: Market; affinity: number }[]> {
  const markets = marketsIn(region);
  const best = new Map<string, number>();
  const record = (e: QlooEntity, candidates: Market[]) => {
    const affinity = e.query?.affinity;
    if (affinity === undefined) return;
    const lat = e.location?.lat;
    const lon = e.location?.lon ?? e.location?.lng;
    const market = candidates.find((m) => sameName(m, e)) ?? (lat !== undefined && lon !== undefined ? nearestMarket(candidates, lat, lon, 45) : undefined);
    if (market) best.set(market.id, Math.max(best.get(market.id) ?? 0, affinity));
  };

  const countries = [...new Set(markets.map((m) => m.country))];
  const lists = await mapLimit(countries, 4, (country) =>
    qlooGet("/v2/insights", {
      "filter.type": "urn:entity:destination",
      "signal.interests.entities": signal,
      "filter.geocode.country_code": country,
      take: 50,
    })
      .then(entitiesOf)
      .catch(() => []),
  );
  for (const e of lists.flat()) record(e, markets);

  const missing = markets.filter((m) => !best.has(m.id));
  await mapLimit(missing, 6, async (market) => {
    const local = await qlooGet("/v2/insights", {
      "filter.type": "urn:entity:destination",
      "signal.interests.entities": signal,
      "filter.location.query": market.query,
      take: 3,
    })
      .then(entitiesOf)
      .catch(() => []);
    for (const e of local) record(e, [market]);
  });
  return markets.filter((m) => best.has(m.id)).map((m) => ({ market: m, affinity: best.get(m.id)! }));
}

// Last resort: a heatmap per city, scored by how popular the taste profile is
// in that city's strongest cells.
async function rankByCityHeatmaps(signal: string[], region: Region): Promise<{ market: Market; affinity: number }[]> {
  const markets = marketsIn(region);
  const scored = await mapLimit(markets, 6, async (market) => {
    try {
      const res = await qlooGet("/v2/insights", {
        "filter.type": "urn:heatmap",
        "filter.location.query": market.query,
        "signal.interests.entities": signal,
      });
      const pops = (res.results?.heatmap ?? []).map((p) => p.query.popularity ?? 0).sort((a, b) => b - a).slice(0, 10);
      return pops.length ? { market, affinity: pops.reduce((s, v) => s + v, 0) / pops.length } : undefined;
    } catch {
      return undefined;
    }
  });
  return scored.filter((s): s is { market: Market; affinity: number } => Boolean(s));
}

export async function rankMarkets(artistIds: string[], region: Region): Promise<MarketRanking> {
  const total = marketsIn(region).length;
  const strategies: [MarketRanking["method"], typeof rankByDestinations][] = [
    ["destination-affinity", rankByDestinations],
    ["city-heatmaps", rankByCityHeatmaps],
  ];
  let fallback: MarketRanking | undefined;
  for (const [method, run] of strategies) {
    try {
      const raw = await run(artistIds, region);
      if (raw.length >= total * 0.6) return { method, markets: demandScores(raw) };
      if (raw.length > (fallback?.markets.length ?? 0)) fallback = { method, markets: demandScores(raw) };
    } catch {
      // try the next strategy
    }
  }
  if (fallback) return fallback;
  throw new Error("Qloo returned no market data for this artist profile");
}

// ---------------------------------------------------------------- city scouting

const tagCache = new Map<string, string[]>();

// Resolves a plain-language place category to Qloo tag IDs.
async function placeTags(query: string): Promise<string[]> {
  const cached = tagCache.get(query);
  if (cached) return cached;
  let tags = (await qlooGet("/v2/tags", { "filter.query": query, "filter.tag.types": "urn:tag:category:place", take: 5 })).results?.tags ?? [];
  if (tags.length === 0) tags = (await qlooGet("/v2/tags", { "filter.query": query, take: 10 })).results?.tags ?? [];
  // Tag search is fuzzy ("music venue" also returns wedding venues and music
  // schools), so keep only tags whose name contains the whole phrase.
  const phrase = query.toLowerCase();
  const ids = tags
    .filter((t) => t.id.includes(":place") && t.name.toLowerCase().includes(phrase))
    .map((t) => t.id)
    .slice(0, 3);
  tagCache.set(query, ids);
  return ids;
}

const PLACE_KINDS = {
  venue: { tags: ["music venue", "concert hall", "live music"], match: /music|venue|concert|club|theat|hall|ballroom|amphithe|auditorium|live/i },
  hangout: { tags: ["record store", "cocktail bar", "coffee shop"], match: /record|vinyl|music store|bar|pub|brew|tap|coffee|cafe|café|cocktail|lounge/i },
};

async function placesNear(signal: string[], market: Market, kind: keyof typeof PLACE_KINDS, take: number): Promise<PlaceRef[]> {
  const { tags, match } = PLACE_KINDS[kind];
  const tagIds = (await mapLimit(tags, 3, placeTags)).flat();
  const params: QlooParams = {
    "filter.type": "urn:entity:place",
    "signal.interests.entities": signal,
    "filter.location.query": market.query,
    take: tagIds.length ? take : 50,
  };
  if (tagIds.length) {
    params["filter.tags"] = tagIds;
    params["operator.filter.tags"] = "union";
  }
  const places = entitiesOf(await qlooGet("/v2/insights", params)).map(toPlace);
  if (tagIds.length) return places;
  // Without a category tag the results are any places this audience likes;
  // keep only the ones whose tags or name say what kind of place they are.
  return places.filter((p) => match.test(`${p.name} ${p.tags.join(" ")}`)).slice(0, take);
}

// Average of a WKT outline's vertices: close enough to place a neighborhood pin.
export function wktCentroid(wkt: string): { lat: number; lon: number } | undefined {
  let lon = 0;
  let lat = 0;
  let n = 0;
  for (const [, x, y] of wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    lon += Number(x);
    lat += Number(y);
    n++;
  }
  return n ? { lat: lat / n, lon: lon / n } : undefined;
}

async function hotspots(signal: string[], market: Market): Promise<Hotspot[]> {
  const pick = (points: QlooHeatmapPoint[]) =>
    points
      .map((p) => ({ name: p.name, lat: p.location.latitude, lon: p.location.longitude, affinity: round(p.query.affinity ?? p.query.affinity_rank ?? 0, 3) }))
      .sort((a, b) => b.affinity - a.affinity);
  try {
    // With a locality boundary, the heatmap comes back as named neighborhoods
    // (entities with a WKT outline) instead of geohash cells.
    const named = await qlooGet("/v2/insights", {
      "filter.type": "urn:heatmap",
      "filter.location.query": market.query,
      "output.heatmap.boundary": "urn:entity:locality",
      "signal.interests.entities": signal,
    });
    const neighborhoods: Hotspot[] = [];
    for (const e of entitiesOf(named)) {
      const at = e.boundary ? wktCentroid(e.boundary) : undefined;
      // Drop outlines centred far away, such as the whole country.
      if (!at || haversineKm(market, at) > 60) continue;
      neighborhoods.push({ name: e.name, lat: at.lat, lon: at.lon, affinity: round(e.query?.affinity ?? 0, 3) });
    }
    const points = neighborhoods.length ? neighborhoods.sort((a, b) => b.affinity - a.affinity) : pick(named.results?.heatmap ?? []);
    if (points.length >= 3) return points.slice(0, 40);
  } catch {
    // fall through to the default geohash grid
  }
  const grid = await qlooGet("/v2/insights", {
    "filter.type": "urn:heatmap",
    "filter.location.query": market.query,
    "signal.interests.entities": signal,
  });
  return pick(grid.results?.heatmap ?? []).slice(0, 80);
}

export async function scoutMarket(artistIds: string[], marketId: string): Promise<MarketScout> {
  const market = MARKETS_BY_ID.get(marketId);
  if (!market) throw new Error(`Unknown market ${marketId}`);
  const [spots, venues, hangouts] = await Promise.all([
    hotspots(artistIds, market).catch(() => []),
    placesNear(artistIds, market, "venue", 6).catch(() => []),
    placesNear(artistIds, market, "hangout", 5).catch(() => []),
  ]);
  return { marketId, name: market.name, hotspots: spots, venues, hangouts };
}

// ---------------------------------------------------------------- partners, peers, promo

export async function findSponsors(artistIds: string[], opts: { attainableOnly?: boolean; take?: number } = {}): Promise<BrandRef[]> {
  const res = await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:brand",
    "signal.interests.entities": artistIds,
    "filter.popularity.max": opts.attainableOnly ? 0.9 : undefined,
    take: opts.take ?? 12,
  });
  return entitiesOf(res).map((e) => ({
    id: e.entity_id,
    name: e.name,
    affinity: e.query?.affinity,
    popularity: e.popularity,
    categories: (e.tags ?? []).map((t) => t.name).slice(0, 3),
  }));
}

export async function findCoBill(artistIds: string[], popularity?: number, take = 8): Promise<ArtistRef[]> {
  const p = popularity ?? 0.6;
  const res = await qlooGet("/v2/insights", {
    "filter.type": "urn:entity:artist",
    "signal.interests.entities": artistIds,
    "filter.exclude.entities": artistIds,
    "filter.popularity.min": round(Math.max(0, p - 0.25)),
    "filter.popularity.max": round(Math.min(1, p + 0.1)),
    take,
  });
  return entitiesOf(res).map((e) => ({ ...toArtist(e), disambiguation: e.query?.affinity !== undefined ? `affinity ${round(e.query.affinity)}` : e.disambiguation }));
}

export async function promoChannels(artistIds: string[], take = 6): Promise<BrandRef[]> {
  const res = await qlooGet("/v2/insights", { "filter.type": "urn:entity:podcast", "signal.interests.entities": artistIds, take });
  return entitiesOf(res).map((e) => ({ id: e.entity_id, name: e.name, affinity: e.query?.affinity, popularity: e.popularity, categories: ["podcast"] }));
}

export async function audienceProfile(artistIds: string[]): Promise<AudienceProfile> {
  const res = await qlooGet("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": artistIds });
  const rows = res.results?.demographics ?? [];
  const avg = (key: "age" | "gender") => {
    const out: Record<string, number> = {};
    for (const row of rows) for (const [k, v] of Object.entries(row.query[key] ?? {})) out[k] = (out[k] ?? 0) + v / rows.length;
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, round(v)]));
  };
  const age = avg("age");
  const gender = avg("gender");
  const topAge = Object.entries(age).sort((a, b) => b[1] - a[1])[0]?.[0]?.replace(/_/g, " ");
  const g = (gender.female ?? 0) - (gender.male ?? 0);
  const lean = Math.abs(g) < 0.08 ? "an even gender split" : g > 0 ? "a female lean" : "a male lean";
  return { age, gender, skew: topAge ? `Strongest with ${topAge}, ${lean}` : "No demographic signal returned" };
}

// Qloo's trending endpoint returns nothing for a 90-day window but does answer
// for a year, newest first and capped at `take`. So ask for the year and keep
// the 90 days up to the newest point.
export async function momentum(artistId: string): Promise<Momentum> {
  const end = new Date();
  const start = new Date(end.getTime() - 365 * 86_400_000);
  const res = await qlooGet("/v2/trending", {
    "filter.type": "urn:entity:artist",
    "signal.interests.entities": artistId,
    "filter.start_date": start.toISOString().slice(0, 10),
    "filter.end_date": end.toISOString().slice(0, 10),
    take: 50,
  });
  const all = (res.results?.trending ?? [])
    .filter((p) => p.population_percentile !== undefined && p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const newest = all.length ? Date.parse(all[all.length - 1].date) : 0;
  const points = all
    .filter((p) => Date.parse(p.date) >= newest - 90 * 86_400_000)
    .map((p) => ({ date: p.date, percentile: round(p.population_percentile!, 1) }));
  const changePts = points.length >= 2 ? round(points[points.length - 1].percentile - points[0].percentile, 1) : 0;
  const summary =
    points.length < 2
      ? "Not enough trend data"
      : Math.abs(changePts) < 2
        ? "Holding steady over the last 90 days"
        : changePts > 0
          ? `Rising: up ${changePts} percentile points in 90 days`
          : `Cooling: down ${Math.abs(changePts)} percentile points in 90 days`;
  return { points, changePts, summary };
}

// ---------------------------------------------------------------- promoter mode

export interface VenueReport {
  venue: PlaceRef;
  market: { id: string; name: string };
  capacity: number;
  band: { min: number; max: number };
  artists: ArtistRef[];
  sponsors: BrandRef[];
  audience?: AudienceProfile;
}

// Rough popularity band an act needs to fill a room of this size. A heuristic,
// shown to the user as one.
export function popularityBand(capacity: number): { min: number; max: number } {
  if (capacity < 200) return { min: 0.15, max: 0.6 };
  if (capacity < 500) return { min: 0.35, max: 0.75 };
  if (capacity < 1500) return { min: 0.55, max: 0.9 };
  return { min: 0.75, max: 1 };
}

export async function searchVenues(query: string, marketId: string, take = 6): Promise<PlaceRef[]> {
  const market = MARKETS_BY_ID.get(marketId);
  if (!market) throw new Error(`Unknown market ${marketId}`);
  const res = await qlooGet("/search", {
    query,
    types: "urn:entity:place",
    "filter.location": `${market.lat},${market.lon}`,
    "filter.radius": 30,
    take,
  });
  return entitiesOf(res).map(toPlace);
}

// The venue itself is the taste signal: who does this room's crowd love?
export async function venueReport(venueId: string, marketId: string, capacity: number, venueName?: string): Promise<VenueReport> {
  const market = MARKETS_BY_ID.get(marketId);
  if (!market) throw new Error(`Unknown market ${marketId}`);
  const band = popularityBand(capacity);
  const [venueRes, artistsRes, sponsors, audience] = await Promise.all([
    qlooGet("/entities", { entity_ids: venueId }),
    qlooGet("/v2/insights", {
      "filter.type": "urn:entity:artist",
      "signal.interests.entities": venueId,
      "filter.popularity.min": band.min,
      "filter.popularity.max": band.max,
      take: 15,
    }),
    findSponsors([venueId], { attainableOnly: true, take: 8 }).catch(() => []),
    audienceProfile([venueId]).catch(() => undefined),
  ]);
  const venue = entitiesOf(venueRes).map(toPlace)[0] ?? { id: venueId, name: venueName ?? "Your venue", tags: [] };
  if (venueName && venue.name !== venueName && venue.name.endsWith("(demo)")) venue.name = venueName;
  const artists = entitiesOf(artistsRes).map((e) => ({ ...toArtist(e), disambiguation: e.query?.affinity !== undefined ? `affinity ${round(e.query.affinity)}` : e.disambiguation }));
  return { venue, market: { id: market.id, name: market.name }, capacity, band, artists, sponsors, audience };
}
