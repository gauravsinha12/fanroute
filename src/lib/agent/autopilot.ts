import { MARKETS_BY_ID, findMarket, type Region } from "@/lib/fanroute/markets";
import type { AgentEvent } from "./agent";
import { runTool, type FinalPlan, type PlanState } from "./tools";

export interface Brief {
  artist: string;
  soundsLike: string[];
  region: Region;
  shows: number;
  homeBase?: string;
  startDate?: string;
  maxDriveHours?: number;
  notes?: string;
}

// Runs the same tools as the agent in a fixed order and fills the plan from
// templates. Used when no Anthropic key is configured, so the product still
// works end to end; the UI labels these plans "Autopilot".
export async function runAutopilot(brief: Brief, state: PlanState, emit: (event: AgentEvent) => void): Promise<void> {
  let n = 0;
  const call = async <T>(name: string, input: Record<string, unknown>): Promise<T> => {
    const id = `auto_${++n}`;
    const started = Date.now();
    emit({ type: "tool_start", id, name, input });
    try {
      const out = JSON.parse(await runTool(name, input, state, emit).then((s) => (s.startsWith("{") || s.startsWith("[") ? s : JSON.stringify(s))));
      emit({ type: "tool_end", id, name, ok: true, ms: Date.now() - started });
      return out as T;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emit({ type: "tool_end", id, name, ok: false, ms: Date.now() - started, error });
      throw err;
    }
  };

  emit({ type: "progress", text: `Looking up ${brief.artist}${brief.soundsLike.length ? ` and ${brief.soundsLike.length} sound-alike artists` : ""} in Qloo.` });
  const found = await call<{ query: string; candidates: { id: string; popularity_pct?: number }[] }[]>("find_artists", {
    names: [brief.artist, ...brief.soundsLike].slice(0, 5),
  });
  const touring = found[0]?.candidates[0];
  const signal = found.map((f) => f.candidates[0]?.id).filter((id): id is string => Boolean(id));
  if (signal.length === 0) throw new Error("Qloo found none of these artists. Try adding well-known sound-alike artists.");
  const popularity = touring?.popularity_pct !== undefined ? touring.popularity_pct / 100 : undefined;

  emit({ type: "progress", text: "Scoring every market in the region and profiling the audience." });
  await Promise.all([
    call("rank_markets", { artist_ids: signal, region: brief.region }),
    call("audience_profile", { artist_ids: signal }).catch(() => undefined),
    call("find_sponsors", { artist_ids: signal, attainable_only: true }).catch(() => undefined),
    call("find_support_acts", { artist_ids: signal, popularity }).catch(() => undefined),
    call("find_promo_channels", { artist_ids: signal }).catch(() => undefined),
    touring ? call("check_momentum", { artist_id: touring.id }).catch(() => undefined) : undefined,
  ]);

  const ranked = state.ranking!.markets;
  const home = brief.homeBase ? findMarket(brief.homeBase) : undefined;
  const homeRanked = home && ranked.some((m) => m.marketId === home.id) ? home.id : undefined;
  const pool = ranked.slice(0, Math.max(brief.shows * 2, 10)).map((m) => m.marketId);
  if (homeRanked && !pool.includes(homeRanked)) pool.push(homeRanked);

  emit({ type: "progress", text: "Routing the tour around demand and drive times." });
  await call("plan_route", {
    market_ids: pool,
    shows: brief.shows,
    start_market_id: homeRanked,
    end_market_id: homeRanked,
    start_date: brief.startDate,
    max_drive_hours: brief.maxDriveHours,
  });

  emit({ type: "progress", text: "Scouting neighborhoods, venues and local partners in every stop." });
  const stopIds = state.route!.stops.map((s) => s.market.id);
  for (let i = 0; i < stopIds.length; i += 8) {
    await call("scout_markets", { artist_ids: signal, market_ids: stopIds.slice(i, i + 8) });
  }

  const route = state.route!;
  // Pitch the strongest stop first: that is where the data makes the best case.
  const lead = route.stops.slice().sort((a, b) => b.score - a.score)[0];
  const leadRank = ranked.find((m) => m.marketId === lead.market.id)?.rank;
  const leadVenue = state.scouts[lead.market.id]?.venues[0];
  const leadDate = route.days.find((d) => d.kind === "show" && d.marketId === lead.market.id)?.date;
  const topSponsor = state.sponsors?.[0];
  const stops: FinalPlan["stops"] = route.stops.map((s) => {
    const scout = state.scouts[s.market.id];
    const ranking = ranked.find((m) => m.marketId === s.market.id);
    return {
      market_id: s.market.id,
      why: `Demand ${s.score}/100 (#${ranking?.rank ?? "?"} of ${ranked.length}); Qloo affinity ${ranking?.affinity ?? "n/a"}.`,
      venue_pick: scout?.venues[0]?.name,
      neighborhood_focus: scout?.hotspots[0]?.name,
      local_partner: scout?.hangouts[0]?.name,
    };
  });

  const risks: string[] = [];
  if (route.longestDriveHours > (brief.maxDriveHours ?? 7)) risks.push(`Longest drive is ${route.longestDriveHours} h; it is split with a travel day.`);
  for (const leg of route.legs.filter((l) => l.crossing)) {
    risks.push(`${MARKETS_BY_ID.get(leg.from)?.name} to ${MARKETS_BY_ID.get(leg.to)?.name}: ${leg.crossing}. Book it early.`);
  }
  const unscouted = route.stops.filter((s) => !state.scouts[s.market.id]).map((s) => s.market.name);
  if (unscouted.length) risks.push(`Not scouted yet: ${unscouted.join(", ")}. Venue picks there still need research.`);
  if (!touring) risks.push(`${brief.artist} is not in Qloo, so the plan follows the sound-alike artists' audience.`);

  const final: FinalPlan = {
    title: `${brief.artist}: ${route.stops.length}-date ${brief.region === "europe" ? "Europe" : "North America"} run`,
    summary: `${state.audience?.skew ?? "Audience profile unavailable"}. The strongest markets for this taste profile are ${ranked
      .slice(0, 3)
      .map((m) => m.name)
      .join(", ")}. The route covers ${route.totalKm.toLocaleString()} km with a longest drive of ${route.longestDriveHours} h.`,
    stops,
    support_acts: (state.supportActs ?? []).slice(0, 3).map((a) => ({ name: a.name, why: `Shares this audience${a.genres.length ? ` (${a.genres.slice(0, 2).join(", ")})` : ""}.` })),
    sponsors: (state.sponsors ?? []).slice(0, 3).map((b) => ({ name: b.name, angle: `Fans over-index on ${b.name}${b.categories[0] ? ` (${b.categories[0]})` : ""}; offer a co-branded presence at each show.` })),
    promo: (state.promo ?? []).slice(0, 3).map((p) => ({ name: p.name, why: "Over-indexes with this audience." })),
    venue_email: `Hi${leadVenue ? ` ${leadVenue.name} team` : ""},

I'm booking ${route.stops.length === 8 || route.stops.length === 11 || route.stops.length === 18 ? "an" : "a"} ${route.stops.length}-date run for ${brief.artist} and would love to play ${lead.market.name} on ${leadDate}. Taste data ranks ${lead.market.name} #${leadRank} of ${ranked.length} markets for our audience${leadVenue ? `, and ${leadVenue.name} is one of the rooms those listeners already favor` : ""}.

Could we talk holds for that date? Happy to send streaming numbers and press.

Thanks,
${brief.artist} team`,
    sponsor_email: `Hi${topSponsor ? ` ${topSponsor.name}` : ""} team,\n\n${brief.artist} is touring ${route.stops.length} cities (${route.stops
      .slice(0, 4)
      .map((s) => s.market.name)
      .join(", ")}…). Taste data shows our audience over-indexes on ${topSponsor?.name ?? "your brand"}, so a tour partnership would put you in front of people who already like you.\n\nOpen to a short call about on-site presence and co-branded merch?\n\nBest,\n${brief.artist} team`,
    risks,
  };
  await call("finalize_plan", final as unknown as Record<string, unknown>);
  emit({ type: "text", delta: `${final.title} is ready. Double-check the venue picks before sending the booking emails.` });
}

export function homeMarketLabel(homeBase?: string): string | undefined {
  const market = homeBase ? findMarket(homeBase) : undefined;
  return market ? `${market.name} (market id ${market.id})` : homeBase;
}

export function isKnownMarket(id: string): boolean {
  return MARKETS_BY_ID.has(id);
}
