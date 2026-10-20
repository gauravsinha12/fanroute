"use client";

import { useEffect, useState } from "react";
import { BriefForm } from "@/components/BriefForm";
import { PromoterForm, PromoterReport } from "@/components/Promoter";
import { PlanPanel } from "@/components/PlanPanel";
import { Timeline } from "@/components/Timeline";
import { TourMap } from "@/components/TourMap";
import type { LlmMode } from "@/lib/agent/agent";
import type { Brief } from "@/lib/agent/autopilot";
import type { VenueReport } from "@/lib/fanroute/analysis";
import { usePlanStream } from "@/lib/client/usePlanStream";

type Mode = { qloo: "live" | "demo"; llm: LlmMode; model?: string };

function agentLabel(mode: Mode): string {
  if (mode.llm === "claude") return "Agent · Claude Opus 5.5";
  if (mode.llm === "groq") return `Agent · ${(mode.model ?? "open model").split("/").pop()} on Groq`;
  return "Autopilot · no LLM";
}

function ModeBadges({ mode }: { mode?: Mode }) {
  if (!mode) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={`rounded-full border px-2.5 py-1 font-mono ${mode.qloo === "live" ? "border-teal text-teal" : "border-demo text-demo"}`}>
        Qloo · {mode.qloo === "live" ? "live" : "demo data"}
      </span>
      <span className="rounded-full border border-line px-2.5 py-1 font-mono text-ink-2">
        {agentLabel(mode)}
      </span>
    </div>
  );
}

export default function Home() {
  const plan = usePlanStream();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [focus, setFocus] = useState<string | undefined>();
  const [mobileTab, setMobileTab] = useState<"agent" | "plan">("agent");
  const [status, setStatus] = useState<Mode>();
  const [side, setSide] = useState<"artist" | "venue">("artist");
  const [report, setReport] = useState<VenueReport | null>(null);
  const [venueBusy, setVenueBusy] = useState(false);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const mode = plan.mode ?? status;
  const started = brief !== null;

  return (
    <div className={`mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 sm:px-6 ${started ? "lg:h-screen" : ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <button
          type="button"
          onClick={() => {
            plan.reset();
            setBrief(null);
            setReport(null);
            setFocus(undefined);
          }}
          className="flex items-baseline gap-2"
          aria-label="Fanroute home"
        >
          <span className="font-display text-2xl font-extrabold tracking-tight">
            fan<span className="text-amber">route</span>
          </span>
          <span className="hidden text-sm text-ink-3 sm:inline">tour where your fans already are</span>
        </button>
        <ModeBadges mode={mode} />
      </header>

      {mode?.qloo === "demo" && (
        <div className="mb-3 rounded-lg border border-demo px-3 py-2 text-sm text-demo" role="status">
          Demo data: no Qloo API key is configured, so artists, venues, brands and scores below are generated and fictional. Add QLOO_API_KEY for real taste data.
        </div>
      )}

      {report ? (
        <main className="flex-1 py-4">
          <button type="button" onClick={() => setReport(null)} className="mb-4 text-sm text-ink-2 hover:text-amber">
            ← Check another room
          </button>
          <PromoterReport report={report} />
        </main>
      ) : !started ? (
        <main className="grid flex-1 items-start gap-10 py-6 lg:grid-cols-[1.05fr_1fr] lg:py-12">
          <section className="space-y-8 lg:pt-6">
            <h1 className="font-display text-5xl leading-[0.95] font-extrabold tracking-tight sm:text-6xl">
              Book the tour your fans would have planned.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-ink-2">
              Independent artists route tours on gut feel and last year&apos;s guarantees. Fanroute reads Qloo&apos;s taste graph to find the cities, neighborhoods and rooms where your audience already lives, then drives the van there.
            </p>
            <ol className="grid max-w-xl gap-3 sm:grid-cols-3">
              {[
                ["Where", "Every market scored on one scale for how much its people share your fans' taste."],
                ["Which room", "The neighborhoods fans cluster in, and the venues and shops they already go to."],
                ["Who pays", "Brands and podcasts your audience over-indexes on, with pitches written for you."],
              ].map(([title, body], i) => (
                <li key={title} className="border-t-2 border-amber pt-3">
                  <span className="font-mono text-xs text-ink-3">0{i + 1}</span>
                  <h2 className="font-display text-lg font-bold">{title}</h2>
                  <p className="text-sm text-ink-2">{body}</p>
                </li>
              ))}
            </ol>
            <p className="max-w-xl text-sm text-ink-3">
              Too small for streaming-platform geography to mean anything? Name a few artists you sound like. Fanroute follows their audience until yours catches up.
            </p>
            <p className="max-w-xl text-sm text-ink-3">
              Booking a room instead? Switch to venue mode to see which touring acts your regulars already love, sized to your capacity.
            </p>
          </section>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Who are you planning for">
              {(
                [
                  ["artist", "I'm an artist"],
                  ["venue", "I book a venue"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={side === key}
                  onClick={() => setSide(key)}
                  className={`rounded-lg py-2 text-sm font-semibold ${side === key ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {side === "artist" ? (
              <BriefForm
                busy={plan.running}
                onSubmit={(b) => {
                  setBrief(b);
                  setFocus(undefined);
                  setMobileTab("agent");
                  plan.start(b);
                }}
              />
            ) : (
              <PromoterForm onReport={setReport} busy={venueBusy} setBusy={setVenueBusy} />
            )}
          </div>
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 gap-4 pb-4 lg:grid-cols-[320px_minmax(0,1fr)_420px] lg:grid-rows-[minmax(0,1fr)]">
          <section className="card order-2 flex min-h-0 flex-col p-4 lg:order-1 lg:h-full">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="truncate font-display text-lg font-bold">{brief.artist}</h2>
              <span className="shrink-0 font-mono text-xs text-ink-3">
                {brief.shows} shows · {brief.region === "europe" ? "EU/UK" : "N. America"}
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-line p-1 lg:hidden">
              {(["agent", "plan"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setMobileTab(t)}
                  className={`rounded-md py-1.5 text-sm ${mobileTab === t ? "bg-surface-2 font-semibold" : "text-ink-3"}`}
                >
                  {t === "agent" ? "Agent" : "Plan"}
                </button>
              ))}
            </div>
            <div className={`min-h-[260px] flex-1 ${mobileTab === "agent" ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}>
              <Timeline
                items={plan.timeline}
                running={plan.running}
                canFollowUp={mode !== undefined && mode.llm !== "autopilot" && Boolean(plan.state.final)}
                onFollowUp={plan.followUp}
                onStop={plan.stop}
              />
            </div>
            <div className={`${mobileTab === "plan" ? "flex" : "hidden"} min-h-[420px] flex-col lg:hidden`}>
              <PlanPanel state={plan.state} onFocus={setFocus} artist={brief.artist} onPledges={plan.setPledges} />
            </div>
          </section>

          <section className="card relative order-1 h-[46vh] min-h-[320px] p-1.5 lg:order-2 lg:h-full">
            <TourMap state={plan.state} focus={focus} onFocus={setFocus} />
            {focus && (
              <button
                type="button"
                onClick={() => setFocus(undefined)}
                className="absolute top-4 left-4 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm shadow"
              >
                ← Whole tour
              </button>
            )}
            {focus && plan.state.scouts[focus] && (
              <div className="absolute bottom-4 left-4 flex gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-coral" /> Venues
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-teal" /> Local partners
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-4 rounded-full bg-gradient-to-r from-amber to-coral" /> Fan density
                </span>
              </div>
            )}
          </section>

          <section className="card order-3 hidden min-h-0 flex-col p-4 lg:flex lg:h-full">
            <PlanPanel state={plan.state} onFocus={setFocus} artist={brief.artist} onPledges={plan.setPledges} />
          </section>
        </main>
      )}
    </div>
  );
}
