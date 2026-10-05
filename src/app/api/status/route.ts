import { qlooMode } from "@/lib/qloo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    qloo: qlooMode(),
    llm: process.env.ANTHROPIC_API_KEY && process.env.FANROUTE_AUTOPILOT !== "1" ? "claude" : "autopilot",
  });
}
