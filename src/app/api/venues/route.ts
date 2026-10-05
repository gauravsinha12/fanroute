import { searchVenues } from "@/lib/fanroute/analysis";
import { MARKETS_BY_ID } from "@/lib/fanroute/markets";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const market = params.get("market") ?? "";
  if (q.length < 2 || !MARKETS_BY_ID.has(market)) return Response.json({ venues: [] });
  try {
    return Response.json({ venues: await searchVenues(q, market) });
  } catch (err) {
    console.error("venue search failed", err);
    return Response.json({ venues: [], error: "Venue search is unavailable right now" }, { status: 502 });
  }
}
