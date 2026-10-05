// Run once a QLOO_API_KEY is available:
//   QLOO_API_KEY=... npx tsx scripts/qloo-probe.mts "Clairo"
// Hits every Qloo request shape Fanroute depends on and reports what came
// back, so parameter or response-shape mismatches show up in one place.
import { qlooGet, qlooMode } from "../src/lib/qloo/client";
import type { QlooParams } from "../src/lib/qloo/types";

if (qlooMode() !== "live") {
  console.error("Set QLOO_API_KEY first; without it every call returns demo data.");
  process.exit(1);
}

const artistName = process.argv[2] ?? "Clairo";
type Check = { name: string; path: string; params: QlooParams };

async function run({ name, path, params }: Check) {
  const started = Date.now();
  try {
    const res = await qlooGet(path, params);
    const r = res.results ?? {};
    const keys = Object.keys(r);
    const first = r.entities?.[0] ?? r.heatmap?.[0] ?? r.demographics?.[0] ?? r.trending?.[0] ?? r.tags?.[0];
    const count = r.entities?.length ?? r.heatmap?.length ?? r.demographics?.length ?? r.trending?.length ?? r.tags?.length ?? 0;
    console.log(`\n✔ ${name} (${Date.now() - started} ms) results=${keys.join(",") || "none"} count=${count}`);
    if (first) console.log(`  first: ${JSON.stringify(first).slice(0, 400)}`);
    return res;
  } catch (err) {
    console.log(`\n✘ ${name}: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}

const search = await run({ name: "search artist", path: "/search", params: { query: artistName, types: "urn:entity:artist", take: 3 } });
const id = search?.results?.entities?.[0]?.entity_id;
if (!id) {
  console.error(`\nNo artist found for "${artistName}"; stopping.`);
  process.exit(1);
}
console.log(`\nUsing ${search!.results!.entities![0].name} (${id})`);
const signal = { "signal.interests.entities": id };

const checks: Check[] = [
  { name: "entities by spotify id (Clairo)", path: "/entities", params: { "external.spotify.ids": "3l0CmX0FuQjFxr8SK7Vqag" } },
  {
    name: "region locality heatmap (rank_markets #1)",
    path: "/v2/insights",
    params: { "filter.type": "urn:heatmap", "filter.location": "POLYGON((-125 24,-66 24,-66 50,-125 50,-125 24))", "output.heatmap.boundary": "urn:entity:locality", ...signal },
  },
  { name: "destination affinity US (rank_markets #2)", path: "/v2/insights", params: { "filter.type": "urn:entity:destination", ...signal, "filter.geocode.country_code": "US", take: 20 } },
  { name: "city heatmap geohash (hotspots)", path: "/v2/insights", params: { "filter.type": "urn:heatmap", "filter.location.query": "Chicago", ...signal } },
  { name: "city heatmap localities (named hotspots)", path: "/v2/insights", params: { "filter.type": "urn:heatmap", "filter.location.query": "Chicago", "output.heatmap.boundary": "urn:entity:locality", ...signal } },
  { name: "tags: music venue (place category)", path: "/v2/tags", params: { "filter.query": "music venue", "filter.tag.types": "urn:tag:category:place", take: 5 } },
  { name: "tags: music venue (any type)", path: "/v2/tags", params: { "filter.query": "music venue", take: 10 } },
  { name: "places in Chicago, no tag filter", path: "/v2/insights", params: { "filter.type": "urn:entity:place", ...signal, "filter.location.query": "Chicago", take: 5 } },
  { name: "brands", path: "/v2/insights", params: { "filter.type": "urn:entity:brand", ...signal, take: 5 } },
  { name: "brands, popularity <= 0.9", path: "/v2/insights", params: { "filter.type": "urn:entity:brand", ...signal, "filter.popularity.max": 0.9, take: 5 } },
  { name: "similar artists in popularity band", path: "/v2/insights", params: { "filter.type": "urn:entity:artist", ...signal, "filter.exclude.entities": id, "filter.popularity.min": 0.3, "filter.popularity.max": 0.8, take: 5 } },
  { name: "podcasts", path: "/v2/insights", params: { "filter.type": "urn:entity:podcast", ...signal, take: 5 } },
  { name: "demographics", path: "/v2/insights", params: { "filter.type": "urn:demographics", ...signal } },
  {
    name: "trending 90 days",
    path: "/v2/trending",
    params: {
      "filter.type": "urn:entity:artist",
      ...signal,
      "filter.start_date": new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
      "filter.end_date": new Date().toISOString().slice(0, 10),
    },
  },
];

const tagRes = await (async () => {
  for (const c of checks) await run(c);
  return qlooGet("/v2/tags", { "filter.query": "music venue", take: 10 }).catch(() => undefined);
})();

const venueTag = tagRes?.results?.tags?.find((t) => t.id.includes(":place"))?.id;
if (venueTag) {
  await run({ name: `venues in Chicago via ${venueTag}`, path: "/v2/insights", params: { "filter.type": "urn:entity:place", ...signal, "filter.location.query": "Chicago", "filter.tags": venueTag, take: 5 } });
} else {
  console.log("\n! No place tag found for 'music venue'; venue scouting will fall back to untagged places.");
}
