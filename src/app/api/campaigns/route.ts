import { z } from "zod";
import { MARKETS_BY_ID } from "@/lib/fanroute/markets";
import { createCampaign } from "@/lib/pledges/store";

export const runtime = "nodejs";

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
