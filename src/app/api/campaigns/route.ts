import { z } from "zod";
import { MARKETS_BY_ID } from "@/lib/fanroute/markets";
import { createCampaign, findCampaignsByArtist, listPledges, totals } from "@/lib/pledges/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public lookup used by voice and agent clients: GET /api/campaigns?artist=Name
// returns that artist's open pledge campaigns with city totals (no owner data).
export async function GET(request: Request) {
  const artist = new URL(request.url).searchParams.get("artist")?.trim();
  if (!artist || artist.length > 120) return Response.json({ error: "Pass ?artist=" }, { status: 400 });
  const campaigns = await findCampaignsByArtist(artist);
  const out = await Promise.all(
    campaigns.map(async (c) => {
      const { ownerKeyHash: _hidden, ...publicCampaign } = c;
      void _hidden;
      return { campaign: publicCampaign, totals: totals(c, await listPledges(c.id)), url: `/c/${c.id}` };
    }),
  );
  return Response.json({ artist, campaigns: out });
}

const Body = z.object({
  artist: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  pledgeAmount: z.number().min(1).max(100).default(5),
  goalPerCity: z.number().min(10).max(100_000).default(300),
  cities: z
    .array(z.object({ marketId: z.string().refine((id) => MARKETS_BY_ID.has(id)), demand: z.number().min(0).max(100) }))
    .min(1)
    .max(30),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { cities, ...rest } = parsed.data;
  const { campaign, ownerKey } = await createCampaign({
    ...rest,
    currency: "USD",
    cities: cities.map((c) => ({ ...c, name: MARKETS_BY_ID.get(c.marketId)!.name })),
  });
  const { ownerKeyHash: _hidden, ...publicCampaign } = campaign;
  void _hidden;
  return Response.json({ campaign: publicCampaign, ownerKey, url: `/c/${campaign.id}` });
}
