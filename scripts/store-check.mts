// Exercises the pledge store against whichever backend the env selects
// (run with BLOB_READ_WRITE_TOKEN set to test the Vercel Blob backend).
//   npx tsx --env-file=.env.local scripts/store-check.mts            single process
//   npx tsx --env-file=.env.local scripts/store-check.mts add <id> <n> <tag>   used by the race test
import { addPledge, createCampaign, getCampaign, listPledges, storeMode, totals, updatePledges } from "../src/lib/pledges/store";

const [, , cmd, campaignArg, countArg, tag] = process.argv;

async function addMany(campaignId: string, n: number, label: string) {
  for (let i = 0; i < n; i++) {
    await addPledge({ campaignId, marketId: "chi", amount: 5, orderId: `${label}-${i}`, authorizationId: `auth-${label}-${i}` });
  }
}

if (cmd === "add") {
  await addMany(campaignArg, Number(countArg), tag);
  process.exit(0);
}

console.log("store:", storeMode());
const { campaign, ownerKey } = await createCampaign({
  artist: "Store check",
  title: "store check",
  currency: "USD",
  pledgeAmount: 5,
  goalPerCity: 20,
  cities: [
    { marketId: "chi", name: "Chicago", demand: 80 },
    { marketId: "det", name: "Detroit", demand: 60 },
  ],
});
console.log("campaign:", campaign.id, "owner key length", ownerKey.length);
const back = await getCampaign(campaign.id);
if (back?.artist !== "Store check") throw new Error("campaign did not round-trip");

const a = await addPledge({ campaignId: campaign.id, marketId: "chi", amount: 5, orderId: "o1", authorizationId: "a1" });
const again = await addPledge({ campaignId: campaign.id, marketId: "chi", amount: 5, orderId: "o1", authorizationId: "a1" });
if (a.id !== again.id) throw new Error("duplicate orderId created a second pledge");
await addPledge({ campaignId: campaign.id, marketId: "det", amount: 5, orderId: "o2", authorizationId: "a2" });

await updatePledges(campaign.id, async (all) => {
  for (const p of all) if (p.marketId === "chi") Object.assign(p, { status: "captured", captureId: "cap1" });
  return all;
});
const pledges = await listPledges(campaign.id);
console.log("pledges:", pledges.map((p) => `${p.orderId}:${p.status}`).join(", "));
console.log("totals:", JSON.stringify(totals(campaign, pledges).map((t) => [t.name, t.pledged, t.captured])));
if (pledges.length !== 2 || pledges.find((p) => p.orderId === "o1")?.status !== "captured") throw new Error("unexpected pledge state");
console.log("RACE_CAMPAIGN", campaign.id);
