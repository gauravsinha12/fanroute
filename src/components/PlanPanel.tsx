"use client";

import { useState } from "react";
import type { PlanState } from "@/lib/agent/tools";
import { MARKETS_BY_ID } from "@/lib/fanroute/markets";

const TABS = ["Itinerary", "Audience", "Partners", "Outreach", "Markets"] as const;
type Tab = (typeof TABS)[number];

const METHOD_NOTE: Record<string, string> = {
  "locality-heatmap": "One Qloo heatmap across the whole region, aggregated to cities, so every city's affinity is measured on the same scale.",
  "destination-affinity": "Qloo destination affinity: how strongly this taste profile gravitates to each city.",
  "city-heatmaps": "A Qloo heatmap per city, scored by how prevalent this taste profile is in each city's strongest neighborhoods.",
};

function fmtDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    md: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

function Bar({ value, max = 1, tone = "amber" }: { value: number; max?: number; tone?: "amber" | "teal" | "coral" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone === "amber" ? "bg-amber" : tone === "teal" ? "bg-teal" : "bg-coral";
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-amber hover:text-ink"
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function planToMarkdown(state: PlanState): string {
  const f = state.final;
  const route = state.route;
  if (!route) return "";
  const lines = [`# ${f?.title ?? "Tour plan"}`, "", f?.summary ?? "", "", "## Dates", ""];
  for (const day of route.days) {
    const market = MARKETS_BY_ID.get(day.marketId);
    if (day.kind !== "show") {
      lines.push(`- ${day.date}: ${day.kind === "travel" ? "Travel" : "Off"}${day.note ? ` (${day.note})` : ""}`);
      continue;
    }
    const stop = f?.stops.find((s) => s.market_id === day.marketId);
    const venue = stop?.venue_pick ?? state.scouts[day.marketId]?.venues[0]?.name;
    lines.push(`- ${day.date}: **${market?.name}**${venue ? ` at ${venue}` : ""}${stop?.why ? ` — ${stop.why}` : ""}`);
  }
  if (f) {
    lines.push("", "## Support acts", ...f.support_acts.map((s) => `- ${s.name}: ${s.why}`));
    lines.push("", "## Sponsors", ...f.sponsors.map((s) => `- ${s.name}: ${s.angle}`));
    lines.push("", "## Podcasts", ...f.promo.map((s) => `- ${s.name}: ${s.why}`));
    lines.push("", "## Venue email", "", f.venue_email, "", "## Sponsor email", "", f.sponsor_email);
    if (f.risks.length) lines.push("", "## Check before booking", ...f.risks.map((r) => `- ${r}`));
  }
  lines.push("", "_Planned with Fanroute using Qloo taste data._");
  return lines.join("\n");
}

function Itinerary({ state, onFocus }: { state: PlanState; onFocus: (id: string) => void }) {
  const route = state.route;
  if (!route) return <Empty text="The itinerary appears once the route is built." />;
  const f = state.final;
  let showNo = 0;
  return (
    <div className="space-y-3">
      {f && (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-2xl font-extrabold leading-tight">{f.title}</h2>
            <span className="shrink-0 pt-1">
              <CopyButton text={planToMarkdown(state)} label="Copy plan" />
            </span>
          </div>
          <p className="text-[15px] leading-relaxed text-ink-2">{f.summary}</p>
        </div>
      )}
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Shows", route.stops.length],
          ["Road km", route.totalKm.toLocaleString()],
          ["Longest drive", `${route.longestDriveHours} h`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-2 py-2">
            <dt className="text-[11px] uppercase tracking-wider text-ink-3">{k}</dt>
            <dd className="font-mono text-lg">{v}</dd>
          </div>
        ))}
      </dl>
      <ol className="space-y-3">
        {route.days.map((day) => {
          const market = MARKETS_BY_ID.get(day.marketId);
          const { dow, md } = fmtDate(day.date);
          if (day.kind !== "show") {
            return (
              <li key={`${day.date}-${day.kind}`} className="flex items-center gap-3 px-2 text-sm text-ink-3">
                <span className="w-[68px] shrink-0 font-mono text-xs">
                  {dow} {md}
                </span>
                <span>{day.kind === "travel" ? "Travel day" : "Day off"}</span>
                {day.note && <span className="truncate">· {day.note}</span>}
              </li>
            );
          }
          showNo++;
          const stop = f?.stops.find((s) => s.market_id === day.marketId);
          const scout = state.scouts[day.marketId];
          const ranked = state.ranking?.markets.find((m) => m.marketId === day.marketId);
          const venue = stop?.venue_pick ?? scout?.venues[0]?.name;
          const hood = stop?.neighborhood_focus ?? scout?.hotspots[0]?.name;
          const partner = stop?.local_partner ?? scout?.hangouts[0]?.name;
          return (
            <li key={`${day.date}-show`} className="stub flex">
              <div className="flex w-[84px] shrink-0 flex-col items-center justify-center border-r border-dashed border-line py-3">
                <span className="font-mono text-[11px] uppercase text-ink-3">{dow}</span>
                <span className="font-display text-lg font-bold leading-none">{md}</span>
                <span className="mt-1 rounded-full bg-coral px-1.5 font-mono text-[11px] font-bold text-[#12100d]">#{showNo}</span>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <button type="button" onClick={() => onFocus(day.marketId)} className="truncate font-display text-lg font-bold hover:text-amber">
                    {market?.name}
                  </button>
                  {ranked && (
                    <span className="shrink-0 font-mono text-xs text-ink-3" title="Demand index: Qloo affinity blended with metro size">
                      demand {ranked.demand}
                    </span>
                  )}
                </div>
                {stop?.why && <p className="text-sm text-ink-2">{stop.why}</p>}
                <ul className="space-y-0.5 text-sm">
                  {venue && (
                    <li>
                      <span className="text-ink-3">Room · </span>
                      {venue}
                    </li>
                  )}
                  {hood && (
                    <li>
                      <span className="text-ink-3">Fans cluster in · </span>
                      {hood}
                    </li>
                  )}
                  {partner && (
                    <li>
                      <span className="text-ink-3">Local partner · </span>
                      {partner}
                    </li>
                  )}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Audience({ state }: { state: PlanState }) {
  const a = state.audience;
  const mo = state.momentum;
  return (
    <div className="space-y-6">
      {state.artists.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-3">Taste signal</h3>
          <div className="flex flex-wrap gap-2">
            {state.artists.map((artist) => (
              <span key={artist.id} className="rounded-full border border-line px-3 py-1 text-sm">
                {artist.name}
                {artist.popularity !== undefined && <span className="ml-1.5 font-mono text-xs text-ink-3">{Math.round(artist.popularity * 100)}p</span>}
              </span>
            ))}
          </div>
        </section>
      )}
      {a ? (
        <section className="space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-ink-3">Who the fans are</h3>
          <p className="font-display text-xl font-bold">{a.skew}</p>
          <div className="space-y-1.5">
            {Object.entries(a.age).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[88px_1fr_44px] items-center gap-2 text-sm">
                <span className="text-ink-2">{k.replace(/_/g, " ")}</span>
                <span className="relative block h-2 rounded-full bg-surface-2">
                  <span className="absolute top-0 left-1/2 h-full w-px bg-line" />
                  <span
                    className={`absolute top-0 h-full rounded-full ${v >= 0 ? "bg-amber" : "bg-ink-3"}`}
                    style={v >= 0 ? { left: "50%", width: `${Math.min(50, v * 50)}%` } : { right: "50%", width: `${Math.min(50, -v * 50)}%` }}
                  />
                </span>
                <span className="text-right font-mono text-xs">{v > 0 ? "+" : ""}{v}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-3">Affinity vs. the general population: right of center means over-indexing.</p>
        </section>
      ) : (
        <Empty text="Audience profile not requested in this plan." />
      )}
      {mo && mo.points.length > 1 && (
        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-ink-3">Momentum</h3>
          <p className="font-medium">{mo.summary}</p>
          <Sparkline values={mo.points.map((p) => p.percentile)} />
        </section>
      )}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 320;
  const h = 56;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" role="img" aria-label="Popularity percentile over the last 90 days">
      <polyline points={pts} fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Partners({ state }: { state: PlanState }) {
  const f = state.final;
  const section = (title: string, rows: { name: string; note?: string; affinity?: number }[], emptyText: string) => (
    <section className="space-y-2">
      <h3 className="text-xs uppercase tracking-wider text-ink-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.name} className="rounded-lg border border-line p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{r.name}</span>
                {r.affinity !== undefined && <span className="font-mono text-xs text-ink-3">affinity {r.affinity.toFixed(2)}</span>}
              </div>
              {r.note && <p className="mt-0.5 text-sm text-ink-2">{r.note}</p>}
              {r.affinity !== undefined && (
                <div className="mt-2">
                  <Bar value={r.affinity} tone="teal" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  const sponsorRows = f?.sponsors.length
    ? f.sponsors.map((s) => ({ name: s.name, note: s.angle, affinity: state.sponsors?.find((b) => b.name === s.name)?.affinity }))
    : (state.sponsors ?? []).map((b) => ({ name: b.name, note: b.categories.join(" · "), affinity: b.affinity }));
  const actRows = f?.support_acts.length
    ? f.support_acts.map((s) => ({ name: s.name, note: s.why }))
    : (state.supportActs ?? []).map((a) => ({ name: a.name, note: a.genres.join(" · ") }));
  const promoRows = f?.promo.length
    ? f.promo.map((p) => ({ name: p.name, note: p.why, affinity: state.promo?.find((b) => b.name === p.name)?.affinity }))
    : (state.promo ?? []).map((p) => ({ name: p.name, affinity: p.affinity }));
  return (
    <div className="space-y-6">
      {section("Sponsors fans already love", sponsorRows, "No sponsor search in this plan.")}
      {section("Support acts with shared fans", actRows, "No support-act search in this plan.")}
      {section("Podcasts to pitch", promoRows, "No podcast search in this plan.")}
    </div>
  );
}

function Outreach({ state }: { state: PlanState }) {
  const f = state.final;
  if (!f) return <Empty text="Outreach drafts appear when the plan is finished." />;
  return (
    <div className="space-y-6">
      {[
        ["Booking email", f.venue_email],
        ["Sponsor pitch", f.sponsor_email],
      ].map(([title, body]) => (
        <section key={title} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wider text-ink-3">{title}</h3>
            <CopyButton text={body} />
          </div>
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 font-sans text-sm leading-relaxed">{body}</pre>
        </section>
      ))}
      {f.risks.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-ink-3">Check before you book</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            {f.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Markets({ state, onFocus }: { state: PlanState; onFocus: (id: string) => void }) {
  const r = state.ranking;
  if (!r) return <Empty text="Markets appear once they are scored." />;
  const onRoute = new Set(state.route?.stops.map((s) => s.market.id));
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        <span className="font-semibold text-ink">How this was measured: </span>
        {METHOD_NOTE[r.method]} Demand blends that affinity (75%) with metro size (25%).
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-ink-3">
            <th className="py-1 font-normal">#</th>
            <th className="py-1 font-normal">City</th>
            <th className="w-2/5 py-1 font-normal">Demand</th>
            <th className="py-1 text-right font-normal">Affinity</th>
          </tr>
        </thead>
        <tbody>
          {r.markets.map((m) => (
            <tr key={m.marketId} className="border-t border-line">
              <td className="py-1.5 font-mono text-xs text-ink-3">{m.rank}</td>
              <td className="py-1.5">
                <button type="button" onClick={() => onFocus(m.marketId)} className="text-left hover:text-amber">
                  {m.name}
                  {onRoute.has(m.marketId) && <span className="ml-1.5 rounded bg-coral px-1 font-mono text-[10px] font-bold text-[#12100d]">ON TOUR</span>}
                </button>
              </td>
              <td className="py-1.5 pr-3">
                <Bar value={m.demand} max={100} />
              </td>
              <td className="py-1.5 text-right font-mono text-xs">{m.affinity.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-ink-3">{text}</p>;
}

export function PlanPanel({ state, onFocus }: { state: PlanState; onFocus: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("Itinerary");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-0.5 border-b border-line pb-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-md px-2 py-1.5 text-[13px] font-medium ${tab === t ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pt-4 pr-1" role="tabpanel">
        {tab === "Itinerary" && <Itinerary state={state} onFocus={onFocus} />}
        {tab === "Audience" && <Audience state={state} />}
        {tab === "Partners" && <Partners state={state} />}
        {tab === "Outreach" && <Outreach state={state} />}
        {tab === "Markets" && <Markets state={state} onFocus={onFocus} />}
      </div>
    </div>
  );
}
