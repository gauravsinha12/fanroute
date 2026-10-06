import { z } from "zod";
import { captureAuthorization, voidAuthorization } from "@/lib/paypal/client";
import { getCampaign, isOwner, listPledges, totals, updatePledges } from "@/lib/pledges/store";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  campaignId: z.string().min(1).max(80),
  marketId: z.string().min(1).max(20),
  action: z.enum(["capture", "void"]),
});

// Artist-only: confirm a city (capture every held pledge) or release it (void
// them, so fans are never charged). Each authorization is settled on its own;
// one failure doesn't block the rest, and the response reports both.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { campaignId, marketId, action } = parsed.data;
  const campaign = await getCampaign(campaignId);
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });
  if (!isOwner(campaign, request.headers.get("x-owner-key"))) return Response.json({ error: "Only the artist can do this" }, { status: 403 });

  const failures: string[] = [];
  let settled = 0;
  await updatePledges(campaignId, async (all) => {
    for (const p of all) {
      if (p.marketId !== marketId || p.status !== "authorized") continue;
      try {
        if (action === "capture") {
          const cap = await captureAuthorization(p.authorizationId);
          p.status = "captured";
          p.captureId = cap.id;
        } else {
          await voidAuthorization(p.authorizationId);
          p.status = "voided";
        }
        settled++;
      } catch (err) {
        failures.push(`${p.id}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    return all;
  });

  return Response.json({ action, settled, failures, totals: totals(campaign, await listPledges(campaignId)) });
}
