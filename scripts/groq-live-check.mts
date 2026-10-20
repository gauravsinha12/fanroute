// One real plan through the Groq writer (default) or the full Groq agent
// (GROQ_AGENT=full), with live Qloo data, logging tokens and timing.
//   npx tsx --env-file=.env.local scripts/groq-live-check.mts "Faye Webster"
import { runGroqAgent } from "../src/lib/agent/groq";
import { runGroqWriter } from "../src/lib/agent/groq-writer";
import { briefToPrompt } from "../src/lib/agent/prompt";
import type { PlanState } from "../src/lib/agent/tools";

process.env.GROQ_DEBUG = "1";
const brief = { artist: process.argv[2] ?? "Faye Webster", soundsLike: ["Clairo", "Snail Mail"], region: "north-america" as const, shows: 8, homeBase: "Atlanta, US" };
const state: PlanState = { artists: [], scouts: {} };
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const emit = (e: { type: string; [k: string]: unknown }) => {
  if (e.type === "tool_start") console.log(at(), "tool", e.name);
  if (e.type === "tool_end" && !e.ok) console.log(at(), "tool failed", e.name, String(e.error).slice(0, 160));
  if (e.type === "progress") console.log(at(), "note", String(e.text).slice(0, 140));
  if (e.type === "text") console.log(at(), "text", String(e.delta).slice(0, 200));
  if (e.type === "error") console.log(at(), "ERROR", e.message);
};
if (process.env.GROQ_AGENT === "full") {
  await runGroqAgent({ messages: [{ role: "user", content: briefToPrompt(brief) }], state, emit });
} else {
  const history = await runGroqWriter({ brief, state, emit, history: [] });
  const f = state.final;
  if (f) {
    console.log("\nTITLE:", f.title, "\nSUMMARY:", f.summary);
    for (const s of f.stops) console.log(" -", s.market_id, "|", s.venue_pick, "|", s.local_partner, "|", s.why);
    console.log("SPONSORS:", f.sponsors.map((s) => `${s.name}: ${s.angle}`).join(" / "));
    console.log("SUPPORT:", f.support_acts.map((s) => s.name).join(", "), "| PROMO:", f.promo.map((p) => p.name).join(", "));
    console.log("VENUE EMAIL:\n" + f.venue_email);
    console.log("RISKS:", f.risks.join(" / "));
  }
  await runGroqWriter({ brief, state, emit, history, followUp: "Which stop is the riskiest and why?" });
}
console.log(at(), "done");
