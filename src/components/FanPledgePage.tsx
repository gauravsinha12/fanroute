"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Campaign, CityTotals } from "@/lib/pledges/store";

type PublicCampaign = Omit<Campaign, "ownerKeyHash">;

interface PayPalButtons {
  render(el: HTMLElement): Promise<void>;
  close?: () => Promise<void>;
}
declare global {
  interface Window {
    paypal?: {
      Buttons(opts: {
        style?: Record<string, unknown>;
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onError?: (err: unknown) => void;
        onCancel?: () => void;
      }): PayPalButtons;
    };
  }
}

function loadSdk(clientId: string, currency: string): Promise<void> {
  if (window.paypal) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&intent=authorize&currency=${currency}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("PayPal could not load"));
    document.head.appendChild(s);
  });
}

export function FanPledgePage({ id }: { id: string }) {
  const [campaign, setCampaign] = useState<PublicCampaign | null>(null);
  const [rows, setRows] = useState<CityTotals[]>([]);
  const [mode, setMode] = useState<{ mode: string; clientId: string | null }>();
  const [city, setCity] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const buttonsBox = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
    if (!res.ok) {
      setMessage({ kind: "err", text: "This pledge page doesn't exist." });
      return;
    }
    const data = (await res.json()) as { campaign: PublicCampaign; totals: CityTotals[] };
    setCampaign(data.campaign);
    setRows(data.totals);
  }, [id]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    fetch("/api/paypal/config")
      .then((r) => r.json())
      .then(setMode)
      .catch(() => setMode({ mode: "demo", clientId: null }));
    const t = setInterval(refresh, 8000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  const pledgeFlow = useCallback(
    async (marketId: string, approveOrder?: (orderId: string) => Promise<void>) => {
      const res = await fetch("/api/pledges/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: id, marketId }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Could not start the pledge");
      if (approveOrder) await approveOrder(data.id);
      return data.id;
    },
    [id],
  );

  const confirm = useCallback(
    async (marketId: string, orderId: string) => {
      const res = await fetch("/api/pledges/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: id, marketId, orderId }),
      });
      const data = (await res.json()) as { totals?: CityTotals[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not confirm the pledge");
      if (data.totals) setRows(data.totals);
      const name = campaign?.cities.find((c) => c.marketId === marketId)?.name;
      setMessage({ kind: "ok", text: `You're in. Your pledge for ${name} is held, not charged, until the show is confirmed.` });
    },
    [id, campaign],
  );

  // Real PayPal buttons for the selected city.
  useEffect(() => {
    if (!city || !mode?.clientId || !campaign || !buttonsBox.current) return;
    let cancelled = false;
    let buttons: PayPalButtons | undefined;
    loadSdk(mode.clientId, campaign.currency)
      .then(() => {
        if (cancelled || !window.paypal || !buttonsBox.current) return;
        buttonsBox.current.innerHTML = "";
        buttons = window.paypal.Buttons({
          style: { layout: "vertical", shape: "rect", label: "pay" },
          createOrder: () => pledgeFlow(city),
          onApprove: async ({ orderID }) => {
            try {
              await confirm(city, orderID);
            } catch (err) {
              setMessage({ kind: "err", text: err instanceof Error ? err.message : "Pledge failed" });
            }
          },
          onCancel: () => setMessage({ kind: "err", text: "Pledge cancelled. Nothing was charged." }),
          onError: () => setMessage({ kind: "err", text: "PayPal hit an error. Nothing was charged." }),
        });
        return buttons.render(buttonsBox.current);
      })
      .catch((err) => setMessage({ kind: "err", text: err instanceof Error ? err.message : "PayPal could not load" }));
    return () => {
      cancelled = true;
      buttons?.close?.().catch(() => undefined);
    };
  }, [city, mode, campaign, pledgeFlow, confirm]);

  if (!campaign) {
    return <main className="mx-auto max-w-3xl px-4 py-16 text-ink-2">{message?.text ?? "Loading…"}</main>;
  }

  const selected = rows.find((r) => r.marketId === city);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <p className="font-display text-xl font-extrabold">
        fan<span className="text-amber">route</span>
      </p>
      <h1 className="mt-6 font-display text-4xl leading-tight font-extrabold sm:text-5xl">Bring {campaign.artist} to your city</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-2">
        Pledge {campaign.currency === "USD" ? "$" : ""}
        {campaign.pledgeAmount} for the city you want. It&apos;s a hold, not a charge: you only pay if your city reaches its goal and the show is confirmed. Otherwise the hold is released.
      </p>
      {mode?.mode === "demo" && (
        <p className="mt-4 rounded-lg border border-demo px-3 py-2 text-sm text-demo">
          Demo mode: PayPal sandbox keys aren&apos;t configured, so pledges here are simulated and no money moves.
        </p>
      )}
      {mode?.mode === "sandbox" && <p className="mt-4 text-sm text-ink-3">PayPal sandbox: use a sandbox buyer account. No real money moves.</p>}

      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {rows.map((r) => {
          const pct = Math.min(100, Math.round((r.pledged / r.goal) * 100));
          return (
            <li key={r.marketId}>
              <button
                type="button"
                onClick={() => {
                  setCity(r.marketId);
                  setMessage(null);
                }}
                className={`card w-full p-4 text-left transition ${city === r.marketId ? "ring-2 ring-amber" : "hover:border-amber"}`}
                aria-pressed={city === r.marketId}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-xl font-bold">{r.name}</span>
                  <span className="font-mono text-xs text-ink-3">{r.backers} fans</span>
                </div>
                <span className="mt-3 block h-2 overflow-hidden rounded-full bg-surface-2">
                  <span className={`block h-full rounded-full ${r.reached ? "bg-teal" : "bg-amber"}`} style={{ width: `${pct}%` }} />
                </span>
                <span className="mt-1.5 block text-sm text-ink-2">
                  ${r.pledged} of ${r.goal} {r.reached && <b className="text-teal">· goal reached</b>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <section className="card mt-8 p-5" aria-live="polite">
        {selected ? (
          <>
            <h2 className="font-display text-2xl font-bold">Pledge ${campaign.pledgeAmount} for {selected.name}</h2>
            <p className="mt-1 text-sm text-ink-2">Held by PayPal until the artist confirms {selected.name}. Released automatically if the show doesn&apos;t happen.</p>
            <div className="mt-4 max-w-sm">
              {mode?.clientId ? (
                <div ref={buttonsBox} />
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const orderId = await pledgeFlow(selected.marketId);
                      await confirm(selected.marketId, orderId);
                    } catch (err) {
                      setMessage({ kind: "err", text: err instanceof Error ? err.message : "Pledge failed" });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="w-full rounded-xl bg-amber px-5 py-3 font-display text-lg font-bold text-[#12100d] disabled:opacity-50"
                >
                  {busy ? "Pledging…" : `Pledge $${campaign.pledgeAmount} (demo)`}
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="text-ink-2">Pick your city above.</p>
        )}
        {message && (
          <p className={`mt-4 text-sm ${message.kind === "ok" ? "text-teal" : "text-coral"}`} role={message.kind === "err" ? "alert" : undefined}>
            {message.text}
          </p>
        )}
      </section>
    </main>
  );
}
