import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt";
import { TOOL_DEFS, runTool, type PlanState, type ToolEvent } from "./tools";

export const MODEL = "claude-opus-5-5";
const MAX_TURNS = 16;

export type AgentEvent =
  | ToolEvent
  | { type: "mode"; qloo: "live" | "demo"; llm: "claude" | "autopilot" }
  | { type: "progress"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; ok: boolean; ms: number; error?: string }
  | { type: "text"; delta: string }
  | { type: "history"; messages: Anthropic.Beta.BetaMessageParam[] }
  | { type: "error"; message: string }
  | { type: "done" };

export interface AgentRun {
  messages: Anthropic.Beta.BetaMessageParam[];
  state: PlanState;
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
  client?: Pick<Anthropic, "beta">;
}

// Manual streaming loop: the UI needs every progress note, tool call and tool
// result as it happens, and the conversation must stay append-only so thinking
// blocks can be echoed back unchanged on follow-up turns.
export async function runAgent({ messages, state, emit, signal, client = new Anthropic() }: AgentRun): Promise<void> {
  let jsonRetries = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
        fallbacks: "default",
        thinking: { type: "adaptive", display: "updates" },
        output_config: { effort: "medium" },
        cache_control: { type: "ephemeral" },
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFS,
        messages,
      },
      { signal },
    );

    let progress = "";
    let message: Anthropic.Beta.BetaMessage;
    try {
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "thinking") progress = "";
        if (event.type === "content_block_delta") {
          if (event.delta.type === "thinking_delta" && event.delta.thinking) {
            progress += event.delta.thinking;
          } else if (event.delta.type === "text_delta") {
            emit({ type: "text", delta: event.delta.text });
          }
        }
        if (event.type === "content_block_stop" && progress.trim()) {
          emit({ type: "progress", text: progress.trim() });
          progress = "";
        }
      }
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Only an unparseable tool input is retried; API errors and aborts propagate.
      if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 2) throw err;
      emit({ type: "progress", text: "Retrying a garbled tool call…" });
      continue;
    }

    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "The model declined this request." });
      return;
    }
    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) return;
    if (message.stop_reason === "max_tokens") {
      emit({ type: "error", message: "The plan ran out of output room mid tool call." });
      return;
    }

    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const started = Date.now();
        emit({ type: "tool_start", id: use.id, name: use.name, input: use.input });
        try {
          const content = await runTool(use.name, use.input, state, emit);
          emit({ type: "tool_end", id: use.id, name: use.name, ok: true, ms: Date.now() - started });
          return { type: "tool_result", tool_use_id: use.id, content };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          emit({ type: "tool_end", id: use.id, name: use.name, ok: false, ms: Date.now() - started, error });
          return { type: "tool_result", tool_use_id: use.id, content: error, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  emit({ type: "error", message: "Stopped after the maximum number of planning steps." });
}
