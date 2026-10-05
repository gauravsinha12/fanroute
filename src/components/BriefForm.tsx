"use client";

import { useState } from "react";
import type { Brief } from "@/lib/agent/autopilot";
import { marketsIn, type Region } from "@/lib/fanroute/markets";
import { ArtistInput } from "./ArtistInput";

const EXAMPLES: { label: string; brief: Brief }[] = [
  {
    label: "Bedroom-pop act from Chicago, 8 dates",
    brief: { artist: "Clairo", soundsLike: ["Men I Trust", "beabadoobee"], region: "north-america", shows: 8, homeBase: "Chicago", maxDriveHours: 7 },
  },
  {
    label: "Americana duo out of Nashville, 10 dates",
    brief: { artist: "Watchhouse", soundsLike: ["The Milk Carton Kids", "Gregory Alan Isakov"], region: "north-america", shows: 10, homeBase: "Nashville", maxDriveHours: 8 },
  },
  {
    label: "Post-punk band, 9 dates across Europe",
    brief: { artist: "Dry Cleaning", soundsLike: ["Wet Leg", "Shame"], region: "europe", shows: 9, homeBase: "London", maxDriveHours: 7 },
  },
];

function inSixtyDays() {
  const d = new Date(Date.now() + 60 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function BriefForm({ onSubmit, busy }: { onSubmit: (brief: Brief) => void; busy: boolean }) {
  const [artist, setArtist] = useState("");
  const [soundsLike, setSoundsLike] = useState<string[]>([]);
  const [pending, setPending] = useState("");
  const [region, setRegion] = useState<Region>("north-america");
  const [shows, setShows] = useState(8);
  const [homeBase, setHomeBase] = useState("");
  const [startDate, setStartDate] = useState(inSixtyDays);
  const [maxDriveHours, setMaxDriveHours] = useState(7);
  const [notes, setNotes] = useState("");

  const addSoundAlike = (name: string) => {
    const clean = name.trim();
    if (!clean || soundsLike.includes(clean) || soundsLike.length >= 3) return;
    setSoundsLike([...soundsLike, clean]);
    setPending("");
  };

  const load = (brief: Brief) => {
    setArtist(brief.artist);
    setSoundsLike(brief.soundsLike);
    setRegion(brief.region);
    setShows(brief.shows);
    setHomeBase(brief.homeBase ?? "");
    setMaxDriveHours(brief.maxDriveHours ?? 7);
    setNotes(brief.notes ?? "");
  };

  return (
    <form
      className="card space-y-5 p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!artist.trim()) return;
        const extra = pending.trim() && !soundsLike.includes(pending.trim()) ? [pending.trim()] : [];
        onSubmit({
          artist: artist.trim(),
          soundsLike: [...soundsLike, ...extra].slice(0, 3),
          region,
          shows,
          homeBase: homeBase || undefined,
          startDate,
          maxDriveHours,
          notes: notes.trim() || undefined,
        });
      }}
    >
      <ArtistInput
        label="Touring artist"
        value={artist}
        onChange={setArtist}
        placeholder="Band name, or paste a Spotify artist link"
        hint="Small or brand-new act? Add sound-alikes below and Fanroute follows their audience."
      />

      <div>
        <ArtistInput
          label="Sounds like (up to 3)"
          value={pending}
          onChange={setPending}
          onPick={(a) => addSoundAlike(a.name)}
          placeholder="Artists your fans also love"
        />
        {soundsLike.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {soundsLike.map((name) => (
              <button
                type="button"
                key={name}
                onClick={() => setSoundsLike(soundsLike.filter((n) => n !== name))}
                className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm hover:border-coral"
                aria-label={`Remove ${name}`}
              >
                {name} <span aria-hidden="true" className="text-ink-3">×</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-2">Region</legend>
          <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-surface-2 p-1">
            {(["north-america", "europe"] as const).map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => {
                  setRegion(r);
                  setHomeBase("");
                }}
                className={`rounded-md py-1.5 text-sm font-medium ${region === r ? "bg-amber text-[#12100d]" : "text-ink-2 hover:text-ink"}`}
                aria-pressed={region === r}
              >
                {r === "north-america" ? "North America" : "Europe & UK"}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Home base</span>
          <select className="field" value={homeBase} onChange={(e) => setHomeBase(e.target.value)}>
            <option value="">No fixed start</option>
            {marketsIn(region)
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}, {m.country}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 flex justify-between text-sm font-medium text-ink-2">
            Shows <span className="font-mono text-ink">{shows}</span>
          </span>
          <input type="range" min={2} max={20} value={shows} onChange={(e) => setShows(Number(e.target.value))} className="w-full accent-[var(--amber)]" />
        </label>
        <label className="block">
          <span className="mb-1.5 flex justify-between text-sm font-medium text-ink-2">
            Max drive/day <span className="font-mono text-ink">{maxDriveHours} h</span>
          </span>
          <input type="range" min={3} max={12} value={maxDriveHours} onChange={(e) => setMaxDriveHours(Number(e.target.value))} className="w-full accent-[var(--amber)]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">First show</span>
          <input type="date" className="field" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-2">Anything else? (optional)</span>
        <textarea
          className="field min-h-20 resize-y"
          value={notes}
          maxLength={600}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Must play Denver. No more than 2 shows in Texas. We have a new record out in April."
        />
      </label>

      <button
        type="submit"
        disabled={busy || !artist.trim()}
        className="w-full rounded-xl bg-amber px-5 py-3 font-display text-lg font-bold text-[#12100d] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Routing…" : "Route my tour"}
      </button>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-ink-3">Or try one</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button type="button" key={ex.label} onClick={() => load(ex.brief)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:border-amber hover:text-ink">
              {ex.label}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
