import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createPledgeOrder, PayPalError } from "@/lib/paypal/client";
import { getCampaign } from "@/lib/pledges/store";

export const runtime = "nodejs";

const Body = z.object({ campaignId: z.string().min(1).max(80), marketId: z.string().min(1).max(20) });

// Step 1 of a pledge: create a PayPal order with intent AUTHORIZE for this
// campaign city. The amount comes from the campaign, never from the client.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const campaign = await getCampaign(parsed.data.campaignId);
  const city = campaign?.cities.find((c) => c.marketId === parsed.data.marketId);
  if (!campaign || !city) return Response.json({ error: "Unknown campaign or city" }, { status: 404 });
  try {
    const order = await createPledgeOrder({
      amount: campaign.pledgeAmount,
      currency: campaign.currency,
      customId: `${campaign.id}:${city.marketId}`,
      description: `Pledge: bring ${campaign.artist} to ${city.name}`,
      requestId: randomUUID(),
    });
    return Response.json({ id: order.id });
  } catch (err) {
    const status = err instanceof PayPalError ? err.status : 500;
    console.error("create pledge order failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Could not start the pledge" }, { status: status >= 500 ? 502 : status });
  }
}
