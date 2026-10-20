import { MARKETS_BY_ID } from "@/lib/fanroute/markets";
import type { AgentEvent } from "./agent";
import { gatherEvidence, templatePlan, toolCaller, type Brief } from "./autopilot";
import { GROQ_MODEL, GroqError, TOOLS, complete, type GroqMessage } from "./groq";
import { FinalPlanSchema, type FinalPlan, type PlanState } from "./tools";

// Groq's free tier allows ~8k tokens a minute, too little for a long tool-use
// conversation. So on Groq the Qloo tools run in a fixed order (the same ones
// the agent uses), and the model gets one compact evidence brief and writes
// the plan: picks per stop, reasons, sponsor angles, emails and risks.
// GROQ_AGENT=full switches to the open-ended tool loop for paid tiers.

const WRITER_PROMPT = `You are Fanroute, a tour planner for independent musicians. Below is evidence from Qloo's taste graph and Fanroute's router for one tour. Write the final plan by calling finalize_plan.

Rules:
- One stops entry per route stop, in route order, with the exact market_id.
- venue_pick, neighborhood_focus and local_partner must be copied exactly from that stop's scouting lists. Leave one out if its list is empty.
- Support acts, sponsors and promo names must come from their lists. Prefer sponsors a small act can actually reach.
- Each "why" is one sentence citing the evidence: rank, demand, affinity, pledges.
- The summary says who the audience is, where they are, and why this routing.
- venue_email goes to the BOOKING EMAIL TARGET venue and cites that city's rank and date. sponsor_email pitches the top sponsor. Both are specific, short (under 160 words) and signed "<artist> team".
- Describe driving exactly as the route evidence states, including every leg over the daily limit.
- Use only numbers that appear in the evidence. Never invent capacities, guarantees, prices, show times, logistics or contacts. The venue email asks about holds for the listed date; it does not propose door times or terms.
- Name 2 to 3 support acts, sponsors and promo podcasts when the lists have them.
- Put thin data and real trade-offs in risks.`;

const FOLLOW_UP_PROMPT = `You are Fanroute, a tour planner. Answer the artist's question in two to four sentences using only the evidence and the current plan below. If they ask you to change picks, wording or emails, call finalize_plan with the complete revised plan (same rules: names only from the evidence, stops in route order). You cannot add or remove cities; say so if asked and suggest re-running the planner with a different brief.`;

const FINALIZE_ONLY = TOOLS.filter((t) => t.function.name === "finalize_plan");
const pct = (n?: number) => (n === undefined ? "n/a" : `${Math.round(n * 100)}%`);

// Who the booking email goes to: the strongest stop that has a scouted venue.
export function emailTarget(state: PlanState) {
  const route = state.route;
  if (!route) return undefined;
  const ranked = state.ranking?.markets ?? [];
  const byScore = route.stops.slice().sort((a, b) => b.score - a.score);
  const stop = byScore.find((s) => state.scouts[s.market.id]?.venues.length) ?? byScore[0];
  if (!stop) return undefined;
  return {
    marketId: stop.market.id,
    city: stop.market.name,
    venue: state.scouts[stop.market.id]?.venues[0]?.name,
    date: route.days.find((d) => d.kind === "show" && d.marketId === stop.market.id)?.date,
    rank: ranked.find((m) => m.marketId === stop.market.id)?.rank,
    of: ranked.length,
    demand: stop.score,
  };
}

export function evidenceBrief(brief: Brief, state: PlanState): string {
  const lines: string[] = [];
  lines.push(
    `BRIEF: artist ${brief.artist}; sounds like ${brief.soundsLike.join(", ") || "none"}; region ${brief.region}; ${brief.shows} shows` +
      (brief.homeBase ? `; home base ${brief.homeBase}` : "") +
      (brief.maxDriveHours ? `; max ${brief.maxDriveHours} h driving a day` : "") +
      (brief.notes ? `; notes: ${brief.notes}` : ""),
  );
  lines.push(`TASTE SIGNAL: ${state.artists.map((a) => `${a.name} (popularity ${pct(a.popularity)}${a.genres.length ? `, ${a.genres.slice(0, 2).join("/")}` : ""})`).join("; ")}`);
  if (state.audience) lines.push(`AUDIENCE: ${state.audience.skew}`);
  if (state.momentum) lines.push(`MOMENTUM: ${state.momentum.summary}`);
  const ranked = state.ranking?.markets ?? [];
  lines.push(`TOP MARKETS of ${ranked.length}: ${ranked.slice(0, 12).map((m) => `#${m.rank} ${m.name} demand ${m.demand} affinity ${m.affinity}`).join("; ")}`);
  const route = state.route;
  if (route) {
    lines.push(`ROUTE (${route.stops.length} shows, ${route.totalKm} km, longest drive ${route.longestDriveHours} h):`);
    // Spell out the long legs so the plan never understates the driving.
    const limit = brief.maxDriveHours ?? 7;
    const name = (id: string) => MARKETS_BY_ID.get(id)?.name ?? id;
    const long = route.legs.filter((l) => l.driveHours > limit);
    lines.push(
      long.length
        ? `LEGS OVER THE ${limit} H DAILY LIMIT (split with travel days): ${long.map((l) => `${name(l.from)} to ${name(l.to)} ${l.driveHours} h`).join("; ")}`
        : `Every leg is within the ${limit} h daily limit.`,
    );
    if (route.stops.length && route.legs.length >= route.stops.length) {
      const home = route.legs[route.legs.length - 1];
      lines.push(`DRIVE HOME after the last show: ${name(home.from)} to ${name(home.to)} ${home.driveHours} h.`);
    }
    route.stops.forEach((stop, i) => {
      const date = route.days.find((d) => d.kind === "show" && d.marketId === stop.market.id)?.date;
      const leg = i > 0 ? route.legs[i - 1] : undefined;
      const market = ranked.find((m) => m.marketId === stop.market.id);
      const scout = state.scouts[stop.market.id];
      const list = (xs: { name?: string }[] | undefined, n: number) =>
        (xs ?? []).map((x) => x.name).filter(Boolean).slice(0, n).join(" | ") || "none";
      lines.push(
        `${i + 1}. [${stop.market.id}] ${stop.market.name} ${date ?? ""}, demand ${stop.score}, rank #${market?.rank ?? "?"} of ${ranked.length}, affinity ${market?.affinity ?? "n/a"}` +
          (leg ? `, ${leg.driveHours} h drive in${leg.crossing ? ` (${leg.crossing})` : ""}` : "") +
          `\n   venues: ${list(scout?.venues, 4)}\n   neighborhoods: ${list(scout?.hotspots, 2)}\n   hangouts/shops: ${list(scout?.hangouts, 4)}`,
      );
    });
  }
  const target = emailTarget(state);
  if (target) {
    lines.push(
      `BOOKING EMAIL TARGET: ${target.venue ? `${target.venue} in ${target.city}` : `a venue in ${target.city} (none scouted)`}, show on ${target.date}, ${target.city} is rank #${target.rank} of ${target.of}, demand ${target.demand}.` +
        (target.venue ? ` Use ${target.venue} as that stop's venue_pick.` : ""),
    );
  }
  if (state.sponsors?.length) lines.push(`SPONSORS: ${state.sponsors.slice(0, 6).map((b) => `${b.name}${b.categories[0] ? ` (${b.categories[0]})` : ""}`).join("; ")}`);
  if (state.supportActs?.length) lines.push(`SUPPORT ACTS: ${state.supportActs.slice(0, 6).map((a) => `${a.name}${a.genres[0] ? ` (${a.genres[0]})` : ""}`).join("; ")}`);
  if (state.promo?.length) lines.push(`PROMO PODCASTS: ${state.promo.slice(0, 5).map((p) => p.name).join("; ")}`);
  if (state.pledges?.totals.length) {
    lines.push(`FAN PLEDGES: ${state.pledges.totals.map((t) => `${MARKETS_BY_ID.get(t.marketId)?.name ?? t.marketId} $${t.pledged} of $${t.goal} from ${t.backers} fans`).join("; ")}`);
  }
  return lines.join("\n");
}

// Keep the model's prose but only names the evidence contains, and every
// route stop in route order (falling back to the template's entry).
export function groundPlan(plan: FinalPlan, fallback: FinalPlan, state: PlanState): FinalPlan {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const pick = (value: string | undefined, options: { name?: string }[] | undefined) =>
    options?.find((o) => norm(o.name) === norm(value))?.name;
  const byId = new Map(plan.stops.map((s) => [s.market_id, s]));
  const stops = (state.route?.stops ?? []).map((stop) => {
    const id = stop.market.id;
    const mine = byId.get(id);
    const base = fallback.stops.find((s) => s.market_id === id)!;
    const scout = state.scouts[id];
    return {
      market_id: id,
      why: mine?.why?.trim() || base.why,
      venue_pick: pick(mine?.venue_pick, scout?.venues) ?? base.venue_pick,
      neighborhood_focus: pick(mine?.neighborhood_focus, scout?.hotspots) ?? base.neighborhood_focus,
      local_partner: pick(mine?.local_partner, scout?.hangouts) ?? base.local_partner,
    };
  });
  // Names must match the evidence (exactly, or one containing the other); top
  // up from the template so each list keeps a few real entries.
  const known = <T extends { name: string }>(items: T[], pool: { name: string }[] | undefined, extra: T[], max: number): T[] => {
    const out: T[] = [];
    for (const item of items) {
      const hit = pool?.find((p) => norm(p.name) === norm(item.name)) ??
        pool?.find((p) => norm(p.name).includes(norm(item.name)) || norm(item.name).includes(norm(p.name)));
      if (hit && !out.some((o) => norm(o.name) === norm(hit.name))) out.push({ ...item, name: hit.name });
    }
    for (const item of extra) {
      if (out.length >= Math.min(3, max)) break;
      if (!out.some((o) => norm(o.name) === norm(item.name))) out.push(item);
    }
    return out.slice(0, max);
  };
  // The booking email must be addressed to the target venue; if the model
  // wrote it to someone else, use the template email instead.
  const target = emailTarget(state);
  let venueEmail = plan.venue_email;
  if (target?.venue) {
    const stop = stops.find((s) => s.market_id === target.marketId);
    if (stop) stop.venue_pick = target.venue;
    if (!norm(venueEmail).includes(norm(target.venue)) || !norm(venueEmail).includes(norm(target.city))) venueEmail = fallback.venue_email;
  }
  return {
    ...plan,
    venue_email: venueEmail,
    stops,
    support_acts: known(plan.support_acts, state.supportActs, fallback.support_acts, 4),
    sponsors: known(plan.sponsors, state.sponsors, fallback.sponsors, 5),
    promo: known(plan.promo, state.promo, fallback.promo, 4),
    risks: plan.risks.slice(0, 4),
  };
}

async function writePlan(digest: string, signal?: AbortSignal): Promise<FinalPlan | undefined> {
  const messages: GroqMessage[] = [{ role: "user", content: `${digest}\n\nWrite the plan now with finalize_plan.` }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await complete(GROQ_MODEL, messages, signal, {
      system: WRITER_PROMPT,
      tools: FINALIZE_ONLY,
      toolChoice: { type: "function", function: { name: "finalize_plan" } },
      maxTokens: 3000,
    }).catch((err) => {
      if (err instanceof GroqError && err.status === 400 && attempt === 0) return undefined;
      throw err;
    });
    const call = reply?.choices[0]?.message.tool_calls?.[0];
    if (!call) continue;
    try {
      const parsed = FinalPlanSchema.safeParse(JSON.parse(call.function.arguments));
      if (parsed.success) return parsed.data;
      messages.push(
        { role: "assistant", content: null, tool_calls: [call] },
        { role: "tool", tool_call_id: call.id, content: `Invalid plan: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}. Call finalize_plan again.` },
      );
    } catch {
      // Unparseable arguments: try once more.
    }
  }
  return undefined;
}

export async function runGroqWriter({
  brief,
  state,
  emit,
  followUp,
  history,
  signal,
}: {
  brief: Brief;
  state: PlanState;
  emit: (event: AgentEvent) => void;
  followUp?: string;
  history: GroqMessage[];
  signal?: AbortSignal;
}): Promise<GroqMessage[]> {
  if (followUp) return answerFollowUp(brief, state, emit, followUp, history, signal);

  const call = toolCaller(state, emit);
  const { touringFound } = await gatherEvidence(brief, state, emit, call);
  const fallback = templatePlan(brief, state, touringFound);
  emit({ type: "progress", text: `Writing the plan with ${GROQ_MODEL.split("/").pop()} on Groq from the evidence above.` });
  let final = fallback;
  let written = false;
  try {
    const plan = await writePlan(evidenceBrief(brief, state), signal);
    if (plan) {
      final = groundPlan(plan, fallback, state);
      written = true;
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    console.error("groq writer failed", err);
  }
  if (!written) emit({ type: "progress", text: "The model could not write a valid plan, so the plan was filled from templates." });
  await call("finalize_plan", final as unknown as Record<string, unknown>);
  const strongest = state.route?.stops.slice().sort((a, b) => b.score - a.score)[0];
  emit({
    type: "text",
    delta: `${final.title} is ready.${strongest ? ` ${strongest.market.name} is the strongest stop, so the booking email goes there first.` : ""} Double-check the venue picks before you send anything.`,
  });
  return [];
}

async function answerFollowUp(
  brief: Brief,
  state: PlanState,
  emit: (event: AgentEvent) => void,
  question: string,
  history: GroqMessage[],
  signal?: AbortSignal,
): Promise<GroqMessage[]> {
  const plan = state.final
    ? `CURRENT PLAN: ${state.final.title}. ${state.final.summary}\nStops: ${state.final.stops.map((s) => `[${s.market_id}] venue ${s.venue_pick ?? "-"}, partner ${s.local_partner ?? "-"}`).join("; ")}\nSponsors: ${state.final.sponsors.map((s) => s.name).join(", ") || "-"}`
    : "No plan yet.";
  // Earlier questions and answers only (text), to stay inside the token budget.
  const past = history.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-6);
  const messages: GroqMessage[] = [
    { role: "user", content: `${evidenceBrief(brief, state)}\n\n${plan}` },
    { role: "assistant", content: "Understood. What would you like to know?" },
    ...past,
    { role: "user", content: question },
  ];
  const reply = await complete(GROQ_MODEL, messages, signal, { system: FOLLOW_UP_PROMPT, tools: FINALIZE_ONLY, toolChoice: "auto", maxTokens: 2500 });
  const message = reply.choices[0]?.message;
  const call = message?.tool_calls?.[0];
  if (call && state.final) {
    const parsed = FinalPlanSchema.safeParse(JSON.parse(call.function.arguments || "{}"));
    if (parsed.success) {
      const caller = toolCaller(state, emit);
      await caller("finalize_plan", groundPlan(parsed.data, state.final, state) as unknown as Record<string, unknown>);
    }
  }
  const answer = message?.content?.trim() || (call ? "Updated the plan." : "I could not answer that from the evidence.");
  emit({ type: "text", delta: answer });
  return [...past, { role: "user", content: question }, { role: "assistant", content: answer }];
}
