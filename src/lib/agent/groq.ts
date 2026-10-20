import type { AgentEvent } from "./agent";
import { SYSTEM_PROMPT } from "./prompt";
import { TOOL_DEFS, runTool, type PlanState } from "./tools";

// The same tool-use agent on Groq's OpenAI-compatible API, for running the
// app without an Anthropic key. Same tools, same prompt, same final schema.
const BASE_URL = process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
// Used when a request outgrows the primary model's per-minute token limit
// (free-tier limits differ per model).
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";
const MAX_TURNS = 16;
const MAX_RATE_WAITS = 5;

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type GroqMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

const TOOLS = TOOL_DEFS.map((tool) => ({
  type: "function" as const,
  function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
}));

class GroqError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function complete(model: string, messages: GroqMessage[], signal?: AbortSignal) {
  for (let wait = 0; ; wait++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.3,
        max_completion_tokens: 8192,
      }),
      signal,
    });
    if (res.ok) return (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[] };
    const body = await res.text().catch(() => "");
    // Rate limited: wait as long as Groq asks (capped) and try again.
    if (res.status === 429 && wait < MAX_RATE_WAITS) {
      const seconds = Math.min(Number(res.headers.get("retry-after")) || 6, 30);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      continue;
    }
    throw new GroqError(`Groq ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
}

export async function runGroqAgent({
  messages,
  state,
  emit,
  signal,
}: {
  messages: GroqMessage[];
  state: PlanState;
  emit: (event: AgentEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  let model = GROQ_MODEL;
  let badCalls = 0;
  const finalBefore = state.final;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let reply;
    try {
      reply = await complete(model, messages, signal);
    } catch (err) {
      if (signal?.aborted || !(err instanceof GroqError)) throw err;
      // 413: the request is over this model's token limit; 400 tool_use_failed:
      // the model produced a malformed call. Switch model or retry, a little.
      if (err.status === 413 && model !== FALLBACK_MODEL) {
        model = FALLBACK_MODEL;
        emit({ type: "progress", text: `Switching to ${model} for a larger token budget…` });
        turn--;
        continue;
      }
      if (err.status === 400 && /tool_use_failed/.test(err.message) && badCalls++ < 2) {
        emit({ type: "progress", text: "Retrying a garbled tool call…" });
        continue;
      }
      throw err;
    }

    const message = reply.choices[0]?.message;
    if (!message) throw new Error("Groq returned no message");
    const calls = message.tool_calls ?? [];
    if (message.content?.trim()) {
      if (calls.length) emit({ type: "progress", text: message.content.trim() });
      else emit({ type: "text", delta: message.content });
    }
    messages.push({ role: "assistant", content: message.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (calls.length === 0) return;

    const results = await Promise.all(
      calls.map(async (call): Promise<GroqMessage> => {
        const started = Date.now();
        let input: unknown;
        try {
          input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          const error = "Arguments were not valid JSON; call the tool again with a JSON object.";
          emit({ type: "tool_end", id: call.id, name: call.function.name, ok: false, ms: 0, error });
          return { role: "tool", tool_call_id: call.id, content: error };
        }
        emit({ type: "tool_start", id: call.id, name: call.function.name, input });
        try {
          const content = await runTool(call.function.name, input, state, emit);
          emit({ type: "tool_end", id: call.id, name: call.function.name, ok: true, ms: Date.now() - started });
          return { role: "tool", tool_call_id: call.id, content };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          emit({ type: "tool_end", id: call.id, name: call.function.name, ok: false, ms: Date.now() - started, error });
          return { role: "tool", tool_call_id: call.id, content: `Error: ${error}` };
        }
      }),
    );
    messages.push(...results);
    // finalize_plan ran: the plan is on screen, no closing turn needed.
    if (state.final && state.final !== finalBefore) return;
  }
  emit({ type: "error", message: "Stopped after the maximum number of planning steps." });
}
