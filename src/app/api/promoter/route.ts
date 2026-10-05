import { z } from "zod";
import { venueReport } from "@/lib/fanroute/analysis";
import { MARKETS_BY_ID } from "@/lib/fanroute/markets";
import { qlooMode } from "@/lib/qloo/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  venueId: z.string().min(1).max(80),
  marketId: z.string().refine((id) => MARKETS_BY_ID.has(id), "Unknown city"),
  capacity: z.number().int().min(20).max(25000),
  venueName: z.string().max(160).optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const report = await venueReport(parsed.data.venueId, parsed.data.marketId, parsed.data.capacity, parsed.data.venueName);
    return Response.json({ report, mode: qlooMode() });
  } catch (err) {
    console.error("venue report failed", err);
    return Response.json({ error: err instanceof Error ? err.message : "Report failed" }, { status: 502 });
  }
}
