"use client";

import { useEffect, useRef, useState } from "react";
import type { PlaceRef, VenueReport } from "@/lib/fanroute/analysis";
import { MARKETS } from "@/lib/fanroute/markets";

const CITIES = MARKETS.slice().sort((a, b) => a.name.localeCompare(b.name) || a.country.localeCompare(b.country));

export function PromoterForm({ onReport, busy, setBusy }: { onReport: (r: VenueReport) => void; busy: boolean; setBusy: (b: boolean) => void }) {
  const [marketId, setMarketId] = useState("chi");
  const [query, setQuery] = useState("");
  const [venues, setVenues] = useState<PlaceRef[]>([]);
  const [picked, setPicked] = useState<PlaceRef | null>(null);
  const [capacity, setCapacity] = useState(350);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (picked?.name === query || query.trim().length < 2) {
      timer.current = setTimeout(() => setVenues([]), 0);
      return;
    }
    const controller = new AbortController();
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/venues?q=${encodeURIComponent(query.trim())}&market=${marketId}`, { signal: controller.signal });
        setVenues(((await res.json()) as { venues: PlaceRef[] }).venues ?? []);
      } catch {
        // superseded by newer typing
      }
    }, 250);
    return () => controller.abort();
  }, [query, marketId, picked]);

  return (
    <form
      className="card space-y-5 p-5 sm:p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!picked) {
          setError("Pick your venue from the list.");
          return;
        }
        setError("");
        setBusy(true);
        try {
          const res = await fetch("/api/promoter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ venueId: picked.id, marketId, capacity, venueName: picked.name }),
          });
          const data = (await res.json()) as { report?: VenueReport; error?: string };
          if (!res.ok || !data.report) setError(data.error ?? "Something went wrong.");
          else onReport(data.report);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-2">City</span>
        <select
          className="field"
          value={marketId}
          onChange={(e) => {
            setMarketId(e.target.value);
            setPicked(null);
            setQuery("");
          }}
        >
          {CITIES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}, {m.country}
            </option>
          ))}
        </select>
      </label>

      <div className="relative">
        <label className="mb-1.5 block text-sm font-medium text-ink-2" htmlFor="venue-q">
          Your venue
        </label>
        <input
          id="venue-q"
          className="field"
          value={query}
          autoComplete="off"
          placeholder="Start typing the room's name"
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
          }}
        />
        {venues.length > 0 && !picked && (
          <ul className="card scroll-thin absolute z-30 mt-1 max-h-64 w-full overflow-auto p-1" role="listbox">
            {venues.map((v) => (
              <li key={v.id} role="option" aria-selected="false">
                <button
                  type="button"
                  className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-2"
                  onClick={() => {
                    setPicked(v);
                    setQuery(v.name);
                    setVenues([]);
                  }}
                >
                  <span className="block font-medium">{v.name}</span>
                  <span className="block truncate text-xs text-ink-3">{v.address ?? v.tags.join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="block">
        <span className="mb-1.5 flex justify-between text-sm font-medium text-ink-2">
          Capacity <span className="font-mono text-ink">{capacity}</span>
        </span>
        <input type="range" min={50} max={3000} step={25} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} className="w-full accent-[var(--amber)]" />
        <span className="mt-1 block text-xs text-ink-3">Used to suggest acts at a draw your room can hold.</span>
      </label>

      {error && (
        <p className="text-sm text-coral" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !picked}
        className="w-full rounded-xl bg-amber px-5 py-3 font-display text-lg font-bold text-[#12100d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Reading your crowd…" : "Who should I book?"}
      </button>
    </form>
  );
}

function pitch(report: VenueReport, artist: string) {
  return `Hi ${artist} team,\n\nI book ${report.venue.name} in ${report.market.name} (${report.capacity} cap). Taste data on our regulars shows they over-index on ${artist}, so we think a date here would draw the right crowd, not just a crowd.\n\nAre you routing through ${report.market.name} in the next six months? Happy to talk dates and terms.\n\nThanks,\n${report.venue.name}`;
}

export function PromoterReport({ report }: { report: VenueReport }) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="grid gap-4 pb-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className="card p-5 sm:p-6">
        <p className="text-xs uppercase tracking-wider text-ink-3">Book for your crowd</p>
        <h2 className="mt-1 font-display text-3xl font-extrabold leading-tight">{report.venue.name}</h2>
        <p className="mt-1 text-ink-2">
          {report.market.name} · {report.capacity} capacity · acts in the {Math.round(report.band.min * 100)}–{Math.round(report.band.max * 100)}th popularity percentile
        </p>
        <ol className="mt-5 space-y-2">
          {report.artists.length === 0 && <li className="text-sm text-ink-3">Qloo returned no artists for this room. Try a larger capacity.</li>}
          {report.artists.map((a, i) => (
            <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
              <span className="w-6 shrink-0 text-center font-mono text-sm text-ink-3">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{a.name}</span>
                <span className="block truncate text-xs text-ink-3">
                  {[a.genres.slice(0, 3).join(" · "), a.disambiguation].filter(Boolean).join(" — ")}
                </span>
              </span>
              {a.popularity !== undefined && <span className="shrink-0 font-mono text-xs text-ink-3">{Math.round(a.popularity * 100)}p</span>}
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(pitch(report, a.name));
                  setCopied(a.id);
                  setTimeout(() => setCopied(null), 1500);
                }}
                className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-amber hover:text-ink"
              >
                {copied === a.id ? "Copied" : "Copy pitch"}
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-ink-3">
          Ranked by how strongly people who like {report.venue.name} also like each artist (Qloo affinity). The capacity-to-popularity band is a rule of thumb, not a ticket forecast.
        </p>
      </section>

      <div className="space-y-4">
        {report.audience && (
          <section className="card space-y-3 p-5">
            <h3 className="text-xs uppercase tracking-wider text-ink-3">Your crowd</h3>
            <p className="font-display text-xl font-bold">{report.audience.skew}</p>
            {Object.entries(report.audience.age).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[88px_1fr_40px] items-center gap-2 text-sm">
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
          </section>
        )}
        <section className="card space-y-2 p-5">
          <h3 className="text-xs uppercase tracking-wider text-ink-3">Local sponsors your crowd already loves</h3>
          {report.sponsors.length === 0 ? (
            <p className="text-sm text-ink-3">No brand data returned.</p>
          ) : (
            <ul className="space-y-1.5">
              {report.sponsors.map((b) => (
                <li key={b.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {b.name}
                    {b.categories[0] && <span className="text-ink-3"> · {b.categories[0]}</span>}
                  </span>
                  {b.affinity !== undefined && <span className="font-mono text-xs text-ink-3">{b.affinity.toFixed(2)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
