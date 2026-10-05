import { artistFromSpotify, searchArtists } from "@/lib/fanroute/analysis";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ artists: [] });
  try {
    if (q.includes("spotify.com/artist") || q.startsWith("spotify:artist:")) {
      const artist = await artistFromSpotify(q);
      return Response.json({ artists: artist ? [artist] : [] });
    }
    return Response.json({ artists: await searchArtists(q, 6) });
  } catch (err) {
    console.error("artist search failed", err);
    return Response.json({ artists: [], error: "Search is unavailable right now" }, { status: 502 });
  }
}
