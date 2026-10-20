import { MODEL, llmMode } from "@/lib/agent/agent";
import { GROQ_MODEL } from "@/lib/agent/groq";
import { paypalMode } from "@/lib/paypal/client";
import { storeMode } from "@/lib/pledges/store";
import { qlooMode } from "@/lib/qloo/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    qloo: qlooMode(),
    llm: llmMode(),
    model: llmMode() === "claude" ? MODEL : llmMode() === "groq" ? GROQ_MODEL : undefined,
    paypal: paypalMode(),
    pledgeStore: storeMode(),
  });
}
