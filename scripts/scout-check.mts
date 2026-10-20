// Live scouting for a couple of markets: venues, neighborhoods, hangouts.
//   npx tsx --env-file=.env.local scripts/scout-check.mts bos nyc
import { resolveArtists, scoutMarket } from "../src/lib/fanroute/analysis";

const ids = process.argv.slice(2);
const [artist] = await resolveArtists(["Faye Webster"]);
const t0 = Date.now();
const scouts = await Promise.all((ids.length ? ids : ["bos", "nyc"]).map((id) => scoutMarket([artist.id], id)));
for (const s of scouts) {
  console.log(`${s.name}: venues ${s.venues.map((v) => v.name).join(" | ") || "NONE"}`);
  console.log(`   hangouts ${s.hangouts.map((v) => v.name).join(" | ") || "NONE"}; hotspots ${s.hotspots.length}`);
}
console.log(`${Date.now() - t0} ms`);
