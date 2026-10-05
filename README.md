# Fanroute

**Tour where your fans already are.** Fanroute is a tour-planning agent for independent musicians and the people who book them. It uses Qloo's taste graph to find the cities, neighborhoods, venues, sponsors and podcasts an artist's audience already loves, then routes a drivable tour around them and writes the outreach.

## The problem

Independent artists route tours on gut feel, last year's guarantees and whatever cities their streaming dashboard shows. For an emerging act, that dashboard is nearly empty: a few thousand monthly listeners don't tell you whether Asheville or Austin will show up. Booking the wrong rooms in the wrong cities is how small tours lose money.

## What Fanroute does

You enter the artist (or paste a Spotify link), a few artists they sound like, the region, the number of shows, a home base and how far the band will drive in a day. The agent then:

1. **Finds the audience.** It resolves the artist and sound-alikes in Qloo. If the artist is too new for Qloo, it follows the sound-alikes' audience.
2. **Scores every market on one scale.** A single region-wide Qloo heatmap, aggregated to cities, measures how strongly each city's people share this taste. That is blended with metro size into a 0–100 demand index.
3. **Scouts each stop.** For every city on the route: the neighborhoods where fans cluster (Qloo heatmap), the music venues this audience has the most affinity for, and record stores, bars and cafes for posters and pre-show partnerships.
4. **Routes the van.** It picks stops that trade demand against extra driving, orders them, and builds a calendar with travel days for long drives and rest days.
5. **Finds the money.** It surfaces brands the audience over-indexes on (filtered to ones small enough to sponsor an indie tour), support acts with overlapping fans in a realistic popularity band, and podcasts to pitch.
6. **Writes the outreach.** It drafts a booking email for the strongest stop and a sponsorship pitch, plus the risks to check before booking.

Everything named in the plan comes from a Qloo result. The agent is instructed never to invent capacities, guarantees or contacts.

## Why it needs Qloo

A plain LLM can name famous venues, but it cannot know that fans of a particular bedroom-pop act over-index in Richmond and Madison rather than Dallas, which Asheville block they live in, or that they like a regional cold-brew brand. Fanroute's answers come from Qloo's measured affinities: insights for artists, places, brands and podcasts; heatmaps at city and neighborhood level; demographics; and trends. Without Qloo, there is no plan.

## How it's built

- **Next.js 16** (App Router), TypeScript, Tailwind CSS 4, MapLibre GL with OpenFreeMap tiles.
- **Agent:** Claude Opus 5.5 through the Anthropic SDK, in a streaming tool-use loop (`src/lib/agent/agent.ts`). It uses adaptive thinking with progress updates, so the UI shows what the agent is doing between tool calls. It has ten tools (`src/lib/agent/tools.ts`), and it finishes by calling `finalize_plan` with a validated, structured plan.
- **Qloo client** (`src/lib/qloo/client.ts`): auth, retries, a response cache, and a demo mode.
- **Analysis** (`src/lib/fanroute/analysis.ts`): market ranking has three strategies that fall back in order:
  1. region-wide locality heatmap
  2. destination affinity
  3. per-city heatmaps
- **Router** (`src/lib/fanroute/route.ts`): greedy demand-versus-distance selection, 2-opt ordering, and a calendar with drive limits.
- **Autopilot:** without an Anthropic key, a deterministic pipeline runs the same tools in a fixed order, so the product still works end to end.

### Qloo endpoints used

| Need | Endpoint |
|---|---|
| Artist lookup, Spotify links | `/search`, `/entities?external.spotify.ids=` |
| City affinity across a region | `/v2/insights` `filter.type=urn:heatmap`, `output.heatmap.boundary=urn:entity:locality`, WKT region |
| Neighborhood hotspots | `/v2/insights` `filter.type=urn:heatmap` + `filter.location.query` |
| Venues and local partners | `/v2/insights` `filter.type=urn:entity:place` + place tags from `/v2/tags` |
| Sponsors | `/v2/insights` `filter.type=urn:entity:brand` (+ `filter.popularity.max`) |
| Support acts | `/v2/insights` `filter.type=urn:entity:artist` with a popularity band |
| Podcasts | `/v2/insights` `filter.type=urn:entity:podcast` |
| Audience | `/v2/insights` `filter.type=urn:demographics` |
| Momentum | `/v2/trending` |

## Run it

```bash
npm install
cp .env.example .env.local   # add QLOO_API_KEY and ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

- Without `QLOO_API_KEY`, the app runs on generated demo data with fictional names and says so on screen.
- Without `ANTHROPIC_API_KEY`, it runs Autopilot instead of the agent.

Checks:

```bash
npx tsc --noEmit && npm run lint
npx tsx scripts/smoke.mts          # full Autopilot run on demo data
npx tsx scripts/agent-harness.mts  # agent loop against a scripted model
```

## Deploy

On Vercel, import the repo and set `QLOO_API_KEY` and `ANTHROPIC_API_KEY`. The plan endpoint streams for up to 300 seconds (`maxDuration`).

## License

MIT
