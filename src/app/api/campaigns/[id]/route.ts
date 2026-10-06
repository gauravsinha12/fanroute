import { getCampaign, isOwner, listPledges, totals } from "@/lib/pledges/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });
  const pledges = await listPledges(id);
  const owner = isOwner(campaign, request.headers.get("x-owner-key"));
  const { ownerKeyHash: _hidden, ...publicCampaign } = campaign;
  void _hidden;
  return Response.json({
    campaign: publicCampaign,
    totals: totals(campaign, pledges),
    // Fans see totals only; the artist also sees individual pledges.
    pledges: owner ? pledges.map(({ authorizationId: _a, ...p }) => (void _a, p)) : undefined,
    owner,
  });
}
