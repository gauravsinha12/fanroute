import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runAgent, type AgentEvent } from "@/lib/agent/agent";
import { homeMarketLabel, runAutopilot } from "@/lib/agent/autopilot";
import { briefToPrompt } from "@/lib/agent/prompt";
import type { PlanState } from "@/lib/agent/tools";
import { qlooMode } from "@/lib/qloo/client";

export const runtime = "nodejs";
export const maxDuration = 300;

const BriefSchema = z.object({
  artist: z.string().trim().min(1).max(120),
  soundsLike: z.array(z.string().trim().min(1).max(120)).max(4).default([]),
  region: z.enum(["north-america", "europe"]).default("north-america"),
  shows: z.number().int().min(2).max(20).default(8),
  homeBase: z.string().trim().max(80).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxDriveHours: z.number().min(2).max(14).optional(),
  notes: z.string().trim().max(600).optional(),
});

const BodySchema = z.object({
  brief: BriefSchema,
  // A follow-up continues an agent conversation the client kept from an
  // earlier run; the messages are passed back unchanged.
  followUp: z.string().trim().min(1).max(600).optional(),
  history: z.array(z.unknown()).max(200).optional(),
  state: z.unknown().optional(),
});

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { brief, followUp, history } = parsed.data;
  const useClaude = Boolean(process.env.ANTHROPIC_API_KEY) && process.env.FANROUTE_AUTOPILOT !== "1";
  if (followUp && !useClaude) return Response.json({ error: "Follow-up questions need the Claude agent (ANTHROPIC_API_KEY)." }, { status: 400 });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const state: PlanState = { artists: [], scouts: {}, ...((parsed.data.state as Partial<PlanState>) ?? {}) };
      emit({ type: "mode", qloo: qlooMode(), llm: useClaude ? "claude" : "autopilot" });
      try {
        if (useClaude) {
          const messages = (history as Anthropic.Beta.BetaMessageParam[] | undefined) ?? [];
          const prompt = followUp ?? briefToPrompt({ ...brief, homeBase: homeMarketLabel(brief.homeBase) });
          messages.push({ role: "user", content: prompt });
          await runAgent({ messages, state, emit, signal: request.signal });
          emit({ type: "history", messages });
        } else {
          await runAutopilot(brief, state, emit);
        }
      } catch (err) {
        console.error("plan failed", err);
        emit({ type: "error", message: err instanceof Error ? err.message : "Planning failed" });
      } finally {
        emit({ type: "done" });
        try {
          controller.close();
        } catch {
          // already closed by a disconnect
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
