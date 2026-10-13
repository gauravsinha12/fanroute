// End-to-end check of every analysis function against the live Qloo API.
//   npx tsx --env-file=.env.local scripts/qloo-live-check.mts "Clairo"
import { qlooMode } from "../src/lib/qloo/client";
import {
  audienceProfile,
  findCoBill,
  findSponsors,
  momentum,
  promoChannels,
  rankMarkets,
  resolveArtists,
  scoutMarket,
  searchVenues,
  venueReport,
} from "../src/lib/fanroute/analysis";

if (qlooMode() !== "live") {
  console.error("Set QLOO_API_KEY first.");
  process.exit(1);
}

async function timed<T>(label: string, fn: () => Promise<T>, show: (v: T) => string): Promise<T | undefined> {
  const t0 = Date.now();
  try {
    const v = await fn();
    console.log(`✔ ${label} (${Date.now() - t0} ms): ${show(v)}`);
    return v;
  } catch (err) {
    console.log(`✘ ${label} (${Date.now() - t0} ms): ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}

const name = process.argv[2] ?? "Clairo";
const artists = await timed("resolveArtists", () => resolveArtists([name]), (a) => a.map((x) => `${x.name} pop=${x.popularity?.toFixed(2)} genres=${x.genres.join("/")}`).join("; "));
const ids = artists?.map((a) => a.id) ?? [];
if (!ids.length) process.exit(1);

for (const region of ["north-america", "europe"] as const) {
  await timed(`rankMarkets ${region}`, () => rankMarkets(ids, region), (r) => `${r.method}, ${r.markets.length} markets, top: ${r.markets.slice(0, 6).map((m) => `${m.name} ${m.demand}`).join(", ")}`);
}
await timed("scoutMarket chi", () => scoutMarket(ids, "chi"), (s) => `hotspots=${s.hotspots.length} [${s.hotspots.slice(0, 4).map((h) => h.name ?? `${h.lat.toFixed(2)},${h.lon.toFixed(2)}`).join(", ")}] venues=${s.venues.map((v) => v.name).slice(0, 4).join(", ")} hangouts=${s.hangouts.map((v) => v.name).slice(0, 3).join(", ")}`);
await timed("findSponsors", () => findSponsors(ids, { attainableOnly: true, take: 5 }), (b) => b.map((x) => x.name).join(", "));
await timed("findCoBill", () => findCoBill(ids, artists![0].popularity, 5), (b) => b.map((x) => x.name).join(", "));
await timed("promoChannels", () => promoChannels(ids, 4), (b) => b.map((x) => x.name).join(", "));
await timed("audienceProfile", () => audienceProfile(ids), (a) => a.skew);
await timed("momentum", () => momentum(ids[0]), (m) => `${m.points.length} points: ${m.summary}`);
const venues = await timed("searchVenues", () => searchVenues("Empty Bottle", "chi", 3), (v) => v.map((x) => x.name).join(", "));
if (venues?.[0]) {
  await timed("venueReport", () => venueReport(venues[0].id, "chi", 400), (r) => `${r.venue.name}: artists=${r.artists.slice(0, 4).map((a) => a.name).join(", ")} sponsors=${r.sponsors.length} audience=${r.audience?.skew}`);
}
