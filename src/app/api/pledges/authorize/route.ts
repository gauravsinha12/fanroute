import { z } from "zod";
import { authorizeOrder, PayPalError } from "@/lib/paypal/client";
import { addPledge, getCampaign, listPledges, totals } from "@/lib/pledges/store";

export const runtime = "nodejs";

const Body = z.object({
  campaignId: z.string().min(1).max(80),
  marketId: z.string().min(1).max(20),
  orderId: z.string().min(1).max(64),
});

// Step 2: after the fan approves in PayPal, authorize (hold) the payment and
// record the pledge. Nothing is charged until the artist confirms the city.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { campaignId, marketId, orderId } = parsed.data;
  const campaign = await getCampaign(campaignId);
  if (!campaign || !campaign.cities.some((c) => c.marketId === marketId)) {
    return Response.json({ error: "Unknown campaign or city" }, { status: 404 });
  }
  const already = (await listPledges(campaignId)).find((p) => p.orderId === orderId);
  if (already) return Response.json({ pledge: already, totals: totals(campaign, await listPledges(campaignId)) });
  try {
    const auth = await authorizeOrder(orderId);
    const pledge = await addPledge({
      campaignId,
      marketId,
      amount: campaign.pledgeAmount,
      orderId,
      authorizationId: auth.authorizationId,
      payerName: auth.payerName,
    });
    const { authorizationId: _a, ...publicPledge } = pledge;
    void _a;
    return Response.json({ pledge: publicPledge, totals: totals(campaign, await listPledges(campaignId)) });
  } catch (err) {
    const status = err instanceof PayPalError ? err.status : 500;
    console.error("authorize pledge failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Could not confirm the pledge" }, { status: status >= 500 ? 502 : status });
  }
}
