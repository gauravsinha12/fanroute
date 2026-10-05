import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  audienceProfile,
  findCoBill,
  findSponsors,
  momentum,
  promoChannels,
  rankMarkets,
  resolveArtists,
  scoutMarket,
  searchArtists,
  type ArtistRef,
  type AudienceProfile,
  type BrandRef,
  type MarketRanking,
  type MarketScout,
  type Momentum,
} from "@/lib/fanroute/analysis";
import { MARKETS_BY_ID, type Region } from "@/lib/fanroute/markets";
import { planRoute, type RoutePlan } from "@/lib/fanroute/route";

// Everything the tools learn during one run. The UI renders this directly, so
// the numbers on screen are the Qloo numbers, not the model's retelling.
export interface PlanState {
  artists: ArtistRef[];
  audience?: AudienceProfile;
  ranking?: MarketRanking;
  region?: Region;
  scouts: Record<string, MarketScout>;
  sponsors?: BrandRef[];
  supportActs?: ArtistRef[];
  promo?: BrandRef[];
  momentum?: Momentum;
  route?: RoutePlan;
  final?: FinalPlan;
}

export const FinalPlanSchema = z.object({
  title: z.string().describe("Short tour name, e.g. 'Spring Lakes & Rust Belt run'"),
  summary: z.string().describe("Three or four sentences: who the audience is, where they are, and why this routing"),
  stops: z
    .array(
      z.object({
        market_id: z.string(),
        why: z.string().describe("One sentence citing the Qloo evidence for this city"),
        venue_pick: z.string().optional().describe("Name of a venue returned by scout_markets, if any"),
        neighborhood_focus: z.string().optional(),
        local_partner: z.string().optional().describe("A hangout or shop from scout_markets for posters, pre-show, or merch"),
      }),
    )
    .min(1),
  support_acts: z.array(z.object({ name: z.string(), why: z.string() })).max(4),
  sponsors: z.array(z.object({ name: z.string(), angle: z.string().describe("The pitch angle in one sentence") })).max(5),
  promo: z.array(z.object({ name: z.string(), why: z.string() })).max(4),
  venue_email: z.string().describe("Ready-to-send booking email for the first stop's venue pick, under 160 words"),
  sponsor_email: z.string().describe("Ready-to-send sponsorship pitch to the top sponsor, under 160 words"),
  risks: z.array(z.string()).max(4).describe("Honest caveats: thin data, long drives, small markets"),
});
export type FinalPlan = z.infer<typeof FinalPlanSchema>;

// The API takes plain JSON Schema; drop the draft marker zod adds.
function finalPlanJsonSchema(): Anthropic.Beta.BetaTool.InputSchema {
  const { $schema: _draft, ...schema } = z.toJSONSchema(FinalPlanSchema) as Record<string, unknown>;
  void _draft;
  return schema as Anthropic.Beta.BetaTool.InputSchema;
}

const ArtistIds = z.array(z.string()).min(1).max(5);
const RegionSchema = z.enum(["north-america", "europe"]);

const inputs = {
  find_artists: z.object({ names: z.array(z.string()).min(1).max(5) }),
  audience_profile: z.object({ artist_ids: ArtistIds }),
  rank_markets: z.object({ artist_ids: ArtistIds, region: RegionSchema }),
  scout_markets: z.object({ artist_ids: ArtistIds, market_ids: z.array(z.string()).min(1).max(8) }),
  find_sponsors: z.object({ artist_ids: ArtistIds, attainable_only: z.boolean().optional() }),
  find_support_acts: z.object({ artist_ids: ArtistIds, popularity: z.number().min(0).max(1).optional() }),
  find_promo_channels: z.object({ artist_ids: ArtistIds }),
  check_momentum: z.object({ artist_id: z.string() }),
  plan_route: z.object({
    market_ids: z.array(z.string()).min(1).max(30),
    shows: z.number().int().min(1).max(30),
    start_market_id: z.string().optional(),
    end_market_id: z.string().optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    max_drive_hours: z.number().min(2).max(14).optional(),
  }),
  finalize_plan: FinalPlanSchema,
};
export type ToolName = keyof typeof inputs;

const artistIdsProp = {
  type: "array",
  items: { type: "string" },
  description: "Qloo entity IDs of the artist and/or sound-alike reference artists (from find_artists)",
};

export const TOOL_DEFS: Anthropic.Beta.BetaTool[] = [
  {
    name: "find_artists",
    description:
      "Look up artists in Qloo by name. Returns up to 3 candidates per name with Qloo IDs, popularity (0-1 percentile) and genres. Use it for the touring artist and for any sound-alike reference artists.",
    input_schema: { type: "object", properties: { names: { type: "array", items: { type: "string" } } }, required: ["names"] },
  },
  {
    name: "audience_profile",
    description: "Age and gender affinity of the audience for these artists (positive = over-indexes vs. the general population).",
    input_schema: { type: "object", properties: { artist_ids: artistIdsProp }, required: ["artist_ids"] },
  },
  {
    name: "rank_markets",
    description:
      "Score every touring market in a region by how strongly its people share this taste profile (Qloo affinity), blended with metro size into a 0-100 demand index. Returns the top 25.",
    input_schema: {
      type: "object",
      properties: { artist_ids: artistIdsProp, region: { type: "string", enum: ["north-america", "europe"] } },
      required: ["artist_ids", "region"],
    },
  },
  {
    name: "scout_markets",
    description:
      "For up to 8 markets: the neighborhoods where this audience concentrates, the music venues it has the most affinity for, and nearby record stores, bars and cafes for posters or pre-show partnerships. Run it on the markets you are considering.",
    input_schema: {
      type: "object",
      properties: { artist_ids: artistIdsProp, market_ids: { type: "array", items: { type: "string" } } },
      required: ["artist_ids", "market_ids"],
    },
  },
  {
    name: "find_sponsors",
    description:
      "Brands this audience over-indexes on. attainable_only=true drops the most mainstream brands, leaving ones small enough to sponsor an independent tour.",
    input_schema: {
      type: "object",
      properties: { artist_ids: artistIdsProp, attainable_only: { type: "boolean" } },
      required: ["artist_ids"],
    },
  },
  {
    name: "find_support_acts",
    description:
      "Artists whose audiences overlap with this one, filtered to a similar or smaller popularity band so they are realistic openers or co-headliners. Pass the touring artist's popularity if known.",
    input_schema: {
      type: "object",
      properties: { artist_ids: artistIdsProp, popularity: { type: "number" } },
      required: ["artist_ids"],
    },
  },
  {
    name: "find_promo_channels",
    description: "Podcasts this audience over-indexes on, for ad reads, interviews or guest spots.",
    input_schema: { type: "object", properties: { artist_ids: artistIdsProp }, required: ["artist_ids"] },
  },
  {
    name: "check_momentum",
    description: "90-day popularity trend for one artist (Qloo population percentile).",
    input_schema: { type: "object", properties: { artist_id: { type: "string" } }, required: ["artist_id"] },
  },
  {
    name: "plan_route",
    description:
      "Build a drivable routing from candidate markets (IDs from rank_markets). Picks `shows` stops trading demand against extra driving, orders them, adds travel and rest days, and returns legs with drive hours. Set start and end to the same market for a round trip from home.",
    input_schema: {
      type: "object",
      properties: {
        market_ids: { type: "array", items: { type: "string" } },
        shows: { type: "integer" },
        start_market_id: { type: "string" },
        end_market_id: { type: "string" },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        max_drive_hours: { type: "number" },
      },
      required: ["market_ids", "shows"],
    },
  },
  {
    name: "finalize_plan",
    description:
      "Submit the finished tour plan. Call this exactly once, last, after plan_route. Only name venues, partners, sponsors, support acts and podcasts that the other tools returned.",
    input_schema: finalPlanJsonSchema(),
  },
].map((tool) => ({ ...tool, eager_input_streaming: true }) as Anthropic.Beta.BetaTool);

export type ToolEvent =
  | { type: "data"; key: keyof PlanState; value: unknown }
  | { type: "note"; text: string };

const pct = (n?: number) => (n === undefined ? undefined : Math.round(n * 100));

// Runs one tool call. Returns the compact JSON the model sees; the full result
// goes into `state` and out to the UI through `emit`.
export async function runTool(
  name: string,
  rawInput: unknown,
  state: PlanState,
  emit: (event: ToolEvent) => void,
): Promise<string> {
  if (!(name in inputs)) throw new Error(`Unknown tool ${name}`);
  const parsed = inputs[name as ToolName].safeParse(rawInput);
  if (!parsed.success) throw new Error(`Invalid input for ${name}: ${parsed.error.message}`);
  const input = parsed.data as never;

  switch (name as ToolName) {
    case "find_artists": {
      const { names } = input as z.infer<typeof inputs.find_artists>;
      const lists = await Promise.all(names.map((n) => searchArtists(n, 3)));
      const known = new Map(state.artists.map((a) => [a.id, a]));
      for (const list of lists) if (list[0]) known.set(list[0].id, list[0]);
      state.artists = [...known.values()];
      emit({ type: "data", key: "artists", value: state.artists });
      return JSON.stringify(
        names.map((n, i) => ({
          query: n,
          candidates: lists[i].map((a) => ({ id: a.id, name: a.name, popularity_pct: pct(a.popularity), genres: a.genres, note: a.disambiguation })),
        })),
      );
    }
    case "audience_profile": {
      const { artist_ids } = input as z.infer<typeof inputs.audience_profile>;
      state.audience = await audienceProfile(artist_ids);
      emit({ type: "data", key: "audience", value: state.audience });
      return JSON.stringify(state.audience);
    }
    case "rank_markets": {
      const { artist_ids, region } = input as z.infer<typeof inputs.rank_markets>;
      state.ranking = await rankMarkets(artist_ids, region);
      state.region = region;
      emit({ type: "data", key: "ranking", value: state.ranking });
      return JSON.stringify({
        method: state.ranking.method,
        markets_scored: state.ranking.markets.length,
        top: state.ranking.markets.slice(0, 25).map((m) => ({ id: m.marketId, name: m.name, demand: m.demand, affinity: m.affinity })),
      });
    }
    case "scout_markets": {
      const { artist_ids, market_ids } = input as z.infer<typeof inputs.scout_markets>;
      const valid = market_ids.filter((id) => MARKETS_BY_ID.has(id));
      const scouts = await Promise.all(valid.map((id) => scoutMarket(artist_ids, id)));
      for (const scout of scouts) state.scouts[scout.marketId] = scout;
      emit({ type: "data", key: "scouts", value: state.scouts });
      return JSON.stringify(
        scouts.map((s) => ({
          market_id: s.marketId,
          top_neighborhoods: s.hotspots.slice(0, 3).map((h) => h.name ?? `${h.lat.toFixed(3)},${h.lon.toFixed(3)}`),
          venues: s.venues.map((v) => ({ name: v.name, affinity: v.affinity, address: v.address })),
          hangouts: s.hangouts.map((v) => ({ name: v.name, affinity: v.affinity, tags: v.tags })),
        })),
      );
    }
    case "find_sponsors": {
      const { artist_ids, attainable_only } = input as z.infer<typeof inputs.find_sponsors>;
      state.sponsors = await findSponsors(artist_ids, { attainableOnly: attainable_only ?? true });
      emit({ type: "data", key: "sponsors", value: state.sponsors });
      return JSON.stringify(state.sponsors.map((b) => ({ name: b.name, affinity: b.affinity, popularity_pct: pct(b.popularity), categories: b.categories })));
    }
    case "find_support_acts": {
      const { artist_ids, popularity } = input as z.infer<typeof inputs.find_support_acts>;
      state.supportActs = await findCoBill(artist_ids, popularity);
      emit({ type: "data", key: "supportActs", value: state.supportActs });
      return JSON.stringify(state.supportActs.map((a) => ({ name: a.name, popularity_pct: pct(a.popularity), genres: a.genres, note: a.disambiguation })));
    }
    case "find_promo_channels": {
      const { artist_ids } = input as z.infer<typeof inputs.find_promo_channels>;
      state.promo = await promoChannels(artist_ids);
      emit({ type: "data", key: "promo", value: state.promo });
      return JSON.stringify(state.promo.map((p) => ({ name: p.name, affinity: p.affinity })));
    }
    case "check_momentum": {
      const { artist_id } = input as z.infer<typeof inputs.check_momentum>;
      state.momentum = await momentum(artist_id);
      emit({ type: "data", key: "momentum", value: state.momentum });
      return JSON.stringify({ summary: state.momentum.summary, change_pts: state.momentum.changePts });
    }
    case "plan_route": {
      const args = input as z.infer<typeof inputs.plan_route>;
      if (!state.ranking) throw new Error("Call rank_markets before plan_route");
      const pool = state.ranking.markets.filter((m) => args.market_ids.includes(m.marketId));
      for (const id of [args.start_market_id, args.end_market_id]) {
        if (id && !pool.some((m) => m.marketId === id)) {
          const fromRanking = state.ranking.markets.find((m) => m.marketId === id);
          if (fromRanking) pool.push(fromRanking);
        }
      }
      if (pool.length === 0) throw new Error("None of market_ids are in the ranking; use IDs from rank_markets");
      const candidates = pool.map((m) => ({ market: MARKETS_BY_ID.get(m.marketId)!, score: m.demand }));
      state.route = planRoute(candidates, {
        shows: args.shows,
        startId: args.start_market_id,
        endId: args.end_market_id,
        startDate: args.start_date,
        maxDriveHours: args.max_drive_hours,
      });
      emit({ type: "data", key: "route", value: state.route });
      return JSON.stringify({
        stops: state.route.stops.map((s) => ({ id: s.market.id, name: s.market.name, demand: s.score })),
        total_km: state.route.totalKm,
        longest_drive_hours: state.route.longestDriveHours,
        calendar: state.route.days.map((d) => `${d.date} ${d.kind} ${d.marketId}${d.note ? ` (${d.note})` : ""}`),
      });
    }
    case "finalize_plan": {
      state.final = input as FinalPlan;
      emit({ type: "data", key: "final", value: state.final });
      return "Plan saved and shown to the user.";
    }
  }
}

// Resolves typed artist names before the agent starts, so the brief can name
// artists the model then looks up by ID.
export async function seedArtists(names: string[]): Promise<ArtistRef[]> {
  return names.length ? resolveArtists(names) : [];
}
