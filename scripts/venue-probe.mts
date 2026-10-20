// Why do venue lists come back empty? Calls Qloo directly for the venue tag
// lookup and a venue insight in a few cities, printing status and limits.
//   npx tsx --env-file=.env.local scripts/venue-probe.mts
const base = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const key = process.env.QLOO_API_KEY!;

async function get(path: string, params: Record<string, string>) {
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { "X-Api-Key": key } });
  const limits = [...res.headers].filter(([k]) => /rate|limit|retry/i.test(k)).map(([k, v]) => `${k}=${v}`).join(" ");
  const body = await res.text();
  return { status: res.status, limits, body };
}

const artist = await get("/search", { query: "Faye Webster", types: "urn:entity:artist", take: "1" });
const id = (JSON.parse(artist.body).results ?? [])[0]?.entity_id;
console.log("search", artist.status, artist.limits, "id", id);

const tags = await get("/v2/tags", { "filter.query": "music venue", "filter.parents.types": "urn:entity:place", take: "10" });
console.log("tags", tags.status, tags.limits, tags.body.slice(0, 300));

for (const city of ["Boston", "New York", "Washington, DC"]) {
  const r = await get("/v2/insights", {
    "filter.type": "urn:entity:place",
    "signal.interests.entities": id,
    "filter.location.query": city,
    take: "50",
  });
  let names = "";
  try {
    names = (JSON.parse(r.body).results?.entities ?? []).slice(0, 6).map((e: { name: string }) => e.name).join(" | ");
  } catch {
    names = r.body.slice(0, 200);
  }
  console.log(city, r.status, r.limits, names);
}
