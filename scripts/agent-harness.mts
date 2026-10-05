// Drives runAgent with a scripted stand-in for the Anthropic client, so the
// loop (streaming events, parallel tool calls, tool errors, append-only
// history, finalize_plan) can be checked without an API key.
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent, type AgentEvent } from "../src/lib/agent/agent";
import type { PlanState } from "../src/lib/agent/tools";

type Block = Anthropic.Beta.BetaContentBlock;
let callNo = 0;
const ids: Record<string, string> = {};

function toolUse(id: string, name: string, input: unknown): Block {
  return { type: "tool_use", id, name, input } as Block;
}

// Each turn sees the history so far and returns the assistant content.
const script: ((history: Anthropic.Beta.BetaMessageParam[]) => { content: Block[]; stop: Anthropic.Beta.BetaStopReason })[] = [
  () => ({
    content: [
      { type: "thinking", thinking: "Looking up the artist and two sound-alikes first.", signature: "sig1" } as Block,
      toolUse("t1", "find_artists", { names: ["Juniper Static", "Mara Vey"] }),
    ],
    stop: "tool_use",
  }),
  (history) => {
    const result = (history.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    const parsed = JSON.parse(result.content as string);
    ids.a = parsed[0].candidates[0].id;
    ids.b = parsed[1].candidates[0].id;
    return {
      content: [
        toolUse("t2", "rank_markets", { artist_ids: [ids.a, ids.b], region: "north-america" }),
        toolUse("t3", "audience_profile", { artist_ids: [ids.a, ids.b] }),
        toolUse("t4", "scout_markets", { artist_ids: [ids.a], market_ids: ["not-a-market"] }),
        toolUse("t5", "plan_route", { market_ids: [], shows: 3 }),
      ],
      stop: "tool_use",
    };
  },
  (history) => {
    const results = history.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    assert.equal(results.length, 4, "all parallel results come back in one user message");
    assert.equal(results.find((r) => r.tool_use_id === "t5")?.is_error, true, "invalid plan_route input is an error result");
    const ranking = JSON.parse(results.find((r) => r.tool_use_id === "t2")!.content as string);
    ids.top = ranking.top.slice(0, 6).map((m: { id: string }) => m.id);
    return {
      content: [toolUse("t6", "plan_route", { market_ids: ids.top, shows: 4, start_market_id: "chi", end_market_id: "chi", max_drive_hours: 8 })],
      stop: "tool_use",
    };
  },
  (history) => {
    const route = JSON.parse((history.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0].content as string);
    const stops = route.stops.map((s: { id: string }) => s.id);
    ids.stops = stops;
    return { content: [toolUse("t7", "scout_markets", { artist_ids: [ids.a, ids.b], market_ids: stops })], stop: "tool_use" };
  },
  () => ({
    content: [
      toolUse("t8", "finalize_plan", {
        title: "Test run",
        summary: "A short test plan.",
        stops: (ids.stops as unknown as string[]).map((id) => ({ market_id: id, why: "Strong affinity." })),
        support_acts: [],
        sponsors: [],
        promo: [],
        venue_email: "Hi,\n\nHolds?\n\nThanks",
        sponsor_email: "Hi,\n\nPartner?\n\nBest",
        risks: ["Test risk"],
      }),
    ],
    stop: "tool_use",
  }),
  () => ({ content: [{ type: "text", text: "Here is your plan.", citations: null } as Block], stop: "end_turn" }),
];

function fakeStream(blocks: Block[], stop: Anthropic.Beta.BetaStopReason) {
  const events: unknown[] = [];
  blocks.forEach((block, index) => {
    events.push({ type: "content_block_start", index, content_block: block });
    if (block.type === "thinking") events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: block.thinking } });
    if (block.type === "text") events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    events.push({ type: "content_block_stop", index });
  });
  return {
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
    finalMessage: async () => ({ id: `msg_${callNo}`, type: "message", role: "assistant", model: "claude-opus-5-5", content: blocks, stop_reason: stop }) as unknown as Anthropic.Beta.BetaMessage,
  };
}

const requests: Anthropic.Beta.MessageCreateParams[] = [];
const client = {
  beta: {
    messages: {
      stream: (params: Anthropic.Beta.MessageCreateParams) => {
        requests.push(structuredClone(params));
        const turn = script[callNo++];
        assert.ok(turn, "agent asked for more turns than scripted");
        const { content, stop } = turn(params.messages);
        return fakeStream(content, stop);
      },
    },
  },
} as unknown as Pick<Anthropic, "beta">;

const state: PlanState = { artists: [], scouts: {} };
const events: AgentEvent[] = [];
const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: "Plan this tour." }];
await runAgent({ messages, state, emit: (e) => events.push(e), client });

assert.equal(callNo, script.length, "every scripted turn ran");
assert.ok(state.ranking && state.route && state.final, "state filled from tool results");
assert.equal(state.route.stops[0].market.id, "chi", "route starts at home");
assert.ok(Object.keys(state.scouts).length >= 3, "route stops were scouted");
assert.ok(events.some((e) => e.type === "progress" && e.text.includes("Looking up")), "progress update surfaced");
assert.ok(events.some((e) => e.type === "tool_end" && e.name === "scout_markets" && e.ok), "scout ran");
assert.ok(events.some((e) => e.type === "text"), "final text streamed");
// Append-only: every request's messages are a prefix of the next request's.
for (let i = 1; i < requests.length; i++) {
  const prev = JSON.stringify(requests[i - 1].messages);
  const next = JSON.stringify(requests[i].messages.slice(0, requests[i - 1].messages.length));
  assert.equal(next, prev, `request ${i} keeps history append-only`);
}
const first = requests[0] as unknown as Record<string, unknown>;
assert.equal(first.model, "claude-opus-5-5");
assert.deepEqual(first.thinking, { type: "adaptive", display: "updates" });
assert.equal(first.fallbacks, "default");
console.log(`agent harness passed: ${requests.length} model turns, ${events.filter((e) => e.type === "tool_end").length} tool calls, route ${state.route.stops.map((s) => s.market.id).join(" > ")}`);
