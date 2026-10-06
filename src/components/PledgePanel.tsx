"use client";

import { useCallback, useEffect, useState } from "react";
import type { ColDef } from "ag-grid-community";
import type { PlanState } from "@/lib/agent/tools";
import type { CityTotals } from "@/lib/pledges/store";
import { DataGrid } from "./DataGrid";

const STORE_KEY = "fanroute:campaign";

interface Saved {
  id: string;
  ownerKey: string;
  artist: string;
}

function readSaved(artist: string): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    return saved && saved.artist === artist ? saved : null;
  } catch {
    return null;
  }
}

export function PledgePanel({
  state,
  artist,
  onTotals,
}: {
  state: PlanState;
  artist: string;
  onTotals: (pledges: PlanState["pledges"]) => void;
}) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [rows, setRows] = useState<CityTotals[]>([]);
  const [amount, setAmount] = useState(5);
  const [goal, setGoal] = useState(300);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSaved(readSaved(artist)), 0);
    return () => clearTimeout(t);
  }, [artist]);

  const refresh = useCallback(async () => {
    if (!saved) return;
    const res = await fetch(`/api/campaigns/${saved.id}`, { headers: { "x-owner-key": saved.ownerKey }, cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { totals: CityTotals[] };
    setRows(data.totals);
    onTotals({ campaignId: saved.id, totals: data.totals.map(({ marketId, pledged, goal: g, backers }) => ({ marketId, pledged, goal: g, backers })) });
  }, [saved, onTotals]);

  useEffect(() => {
    if (!saved) return;
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 6000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [saved, refresh]);

  const open = async () => {
    const onRoute = state.route?.stops.map((s) => ({ marketId: s.market.id, demand: s.score })) ?? [];
    const extra = (state.ranking?.markets ?? [])
      .filter((m) => !onRoute.some((r) => r.marketId === m.marketId))
      .slice(0, 6)
      .map((m) => ({ marketId: m.marketId, demand: m.demand }));
    setBusy("open");
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artist, title: state.final?.title ?? `${artist} tour`, pledgeAmount: amount, goalPerCity: goal, cities: [...onRoute, ...extra] }),
      });
      const data = (await res.json()) as { campaign?: { id: string }; ownerKey?: string; error?: string };
      if (!res.ok || !data.campaign || !data.ownerKey) throw new Error(data.error ?? "Could not open pledges");
      const next = { id: data.campaign.id, ownerKey: data.ownerKey, artist };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        // the campaign still works for this session
      }
      setSaved(next);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not open pledges");
    } finally {
      setBusy(null);
    }
  };

  const settle = async (marketId: string, action: "capture" | "void") => {
    if (!saved) return;
    setBusy(`${action}:${marketId}`);
    try {
      const res = await fetch("/api/pledges/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-owner-key": saved.ownerKey },
        body: JSON.stringify({ campaignId: saved.id, marketId, action }),
      });
      const data = (await res.json()) as { settled?: number; failures?: string[]; totals?: CityTotals[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (data.totals) setRows(data.totals);
      const name = rows.find((r) => r.marketId === marketId)?.name;
      setNote(
        `${action === "capture" ? `Confirmed ${name}: collected` : `Released ${name}: voided`} ${data.settled} pledge${data.settled === 1 ? "" : "s"}${
          data.failures?.length ? `, ${data.failures.length} failed` : ""
        }.`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  if (!state.route) return <p className="py-6 text-center text-sm text-ink-3">Build a route first, then open pledges for its cities.</p>;

  if (!saved) {
    return (
      <div className="space-y-4">
        <h3 className="font-display text-xl font-bold">Let fans vote with a $5 hold</h3>
        <p className="text-sm text-ink-2">
          Fans pledge for the city they want through PayPal. It&apos;s an authorization, not a charge: when a city hits its goal, you confirm the show and collect. If it doesn&apos;t happen, the holds are released and nobody pays. The agent counts pledged cities as committed demand when it re-routes.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-ink-2">Pledge per fan ($)</span>
            <input type="number" min={1} max={100} className="field" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-ink-2">Goal per city ($)</span>
            <input type="number" min={10} step={10} className="field" value={goal} onChange={(e) => setGoal(Number(e.target.value))} />
          </label>
        </div>
        <button type="button" onClick={open} disabled={busy === "open"} className="w-full rounded-xl bg-amber px-4 py-2.5 font-semibold text-[#12100d] disabled:opacity-50">
          {busy === "open" ? "Opening…" : "Open fan pledges"}
        </button>
        {note && <p className="text-sm text-coral">{note}</p>}
      </div>
    );
  }

  const link = typeof window === "undefined" ? `/c/${saved.id}` : `${window.location.origin}/c/${saved.id}`;
  const columns: ColDef<CityTotals>[] = [
    { field: "name", headerName: "City", flex: 1.2, minWidth: 110 },
    {
      headerName: "Pledged",
      flex: 1.3,
      minWidth: 120,
      valueGetter: (p) => (p.data ? p.data.pledged / p.data.goal : 0),
      cellRenderer: (p: { data?: CityTotals }) =>
        p.data ? (
          <span className="flex h-full items-center gap-2">
            <span className="block h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
              <span className={`block h-full ${p.data.reached ? "bg-teal" : "bg-amber"}`} style={{ width: `${Math.min(100, (p.data.pledged / p.data.goal) * 100)}%` }} />
            </span>
            <span className="font-mono text-xs">${p.data.pledged}</span>
          </span>
        ) : null,
    },
    { field: "backers", headerName: "Fans", width: 72 },
    {
      headerName: "",
      flex: 1.4,
      minWidth: 140,
      sortable: false,
      cellRenderer: (p: { data?: CityTotals }) => {
        const r = p.data;
        if (!r) return null;
        if (r.captured > 0) return <span className="text-xs text-teal">Collected ${r.captured}</span>;
        if (r.backers === 0) return <span className="text-xs text-ink-3">No pledges yet</span>;
        return (
          <span className="flex h-full items-center gap-1.5">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => settle(r.marketId, "capture")}
              className={`rounded-md px-2 py-0.5 text-xs font-semibold ${r.reached ? "bg-teal text-[#12100d]" : "border border-line text-ink-2"}`}
            >
              Confirm
            </button>
            <button type="button" disabled={busy !== null} onClick={() => settle(r.marketId, "void")} className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-3">
              Release
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
        <p className="text-ink-2">Share this with fans:</p>
        <div className="mt-1 flex items-center gap-2">
          <a href={link} target="_blank" rel="noreferrer" className="truncate font-mono text-xs text-amber underline">
            {link}
          </a>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <DataGrid rows={rows} columns={columns} height={360} getRowId={(r) => r.marketId} />
      <p className="text-xs text-ink-3">Confirm collects every held pledge for that city through PayPal. Release voids them, so those fans are never charged.</p>
      {note && <p className="text-sm text-ink-2">{note}</p>}
    </div>
  );
}
