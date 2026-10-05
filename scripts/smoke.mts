import { runAutopilot } from "../src/lib/agent/autopilot";
import type { PlanState } from "../src/lib/agent/tools";

const state: PlanState = { artists: [], scouts: {} };
const events: string[] = [];
await runAutopilot(
  { artist: "Juniper Static", soundsLike: ["Mara Vey", "Cobalt Lanterns"], region: "north-america", shows: 8, homeBase: "Chicago", startDate: "2027-03-04", maxDriveHours: 7 },
  state,
  (e) => events.push(e.type === "tool_end" ? `${e.type}:${e.name}:${e.ok}${e.error ? ":" + e.error : ""}` : e.type),
);
console.log(events.join("\n"));
console.log("method", state.ranking?.method, "markets", state.ranking?.markets.length);
console.log("route", state.route?.stops.map((s) => `${s.market.name}(${s.score})`).join(" -> "), state.route?.totalKm, "km");
console.log(state.route?.days.map((d) => `${d.date} ${d.kind} ${d.marketId}`).join("\n"));
console.log(state.final?.venue_email); console.log(state.final?.sponsor_email); console.log(state.final?.risks);
