"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ArtistRef } from "@/lib/fanroute/analysis";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onPick?: (artist: ArtistRef) => void;
  placeholder?: string;
  label: string;
  hint?: string;
}

export function ArtistInput({ value, onChange, onPick, placeholder, label, hint }: Props) {
  const id = useId();
  const [results, setResults] = useState<ArtistRef[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      timer.current = setTimeout(() => setResults([]), 0);
      return;
    }
    const controller = new AbortController();
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/artists?q=${encodeURIComponent(value.trim())}`, { signal: controller.signal });
        const data = (await res.json()) as { artists: ArtistRef[] };
        setResults(data.artists ?? []);
        setActive(0);
      } catch {
        // typing ahead cancels the previous lookup
      }
    }, 250);
    return () => controller.abort();
  }, [value]);

  const pick = (artist: ArtistRef) => {
    onChange(artist.name);
    onPick?.(artist);
    setOpen(false);
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        className="field"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="card scroll-thin absolute z-30 mt-1 max-h-72 w-full overflow-auto p-1">
          {results.map((artist, i) => (
            <li
              key={artist.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(artist);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 ${i === active ? "bg-surface-2" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{artist.name}</span>
                <span className="block truncate text-xs text-ink-3">{artist.genres.slice(0, 3).join(" · ") || artist.disambiguation || "Artist"}</span>
              </span>
              {artist.popularity !== undefined && (
                <span className="shrink-0 font-mono text-xs text-ink-3" title="Qloo popularity percentile">
                  {Math.round(artist.popularity * 100)}th pct
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
