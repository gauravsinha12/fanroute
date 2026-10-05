"use client";

import { useEffect, useRef, useState } from "react";
import type { TimelineItem } from "@/lib/client/usePlanStream";
import { MARKETS_BY_ID } from "@/lib/fanroute/markets";

function toolLabel(name?: string, input?: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const cities = (ids: unknown) =>
    Array.isArray(ids)
      ? ids
          .map((id) => MARKETS_BY_ID.get(String(id))?.name ?? String(id))
          .slice(0, 4)
          .join(", ") + (ids.length > 4 ? ` +${ids.length - 4}` : "")
      : "";
  switch (name) {
    case "find_artists":
      return `Looking up ${Array.isArray(args.names) ? args.names.join(", ") : "artists"} in Qloo`;
    case "audience_profile":
      return "Profiling who the audience is";
    case "rank_markets":
      return `Scoring every ${args.region === "europe" ? "European" : "North American"} market for this taste`;
    case "scout_markets":
      return `Scouting ${cities(args.market_ids)}`;
    case "find_sponsors":
      return args.attainable_only === false ? "Finding brands fans love" : "Finding brands small enough to say yes";
    case "find_support_acts":
      return "Finding support acts with overlapping fans";
    case "find_promo_channels":
      return "Finding podcasts this audience listens to";
    case "check_momentum":
      return "Checking 90-day momentum";
    case "plan_route":
      return `Routing ${args.shows ?? ""} shows around demand and drive time`;
    case "finalize_plan":
      return "Writing the tour plan and outreach";
    default:
      return name ?? "Working";
  }
}

export function Timeline({
  items,
  running,
  canFollowUp,
  onFollowUp,
  onStop,
}: {
  items: TimelineItem[];
  running: boolean;
  canFollowUp: boolean;
  onFollowUp: (q: string) => void;
  onStop: () => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState("");

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-live="polite">
        {items.length === 0 && running && <p className="text-sm text-ink-3">Starting the agent…</p>}
        {items.map((item) => {
          if (item.kind === "tool") {
            return (
              <div key={item.id} className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.status === "running" ? "pulse-dot bg-amber" : item.status === "ok" ? "bg-teal" : "bg-coral"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block">{toolLabel(item.name, item.input)}</span>
                  {item.error && <span className="block text-xs text-coral">{item.error}</span>}
                </span>
                {item.ms !== undefined && <span className="shrink-0 font-mono text-xs text-ink-3">{(item.ms / 1000).toFixed(1)}s</span>}
              </div>
            );
          }
          if (item.kind === "progress") {
            return (
              <p key={item.id} className="border-l-2 border-amber pl-3 text-sm text-ink-2">
                {item.text}
              </p>
            );
          }
          if (item.kind === "user") {
            return (
              <p key={item.id} className="ml-6 rounded-lg bg-amber-soft px-3 py-2 text-sm">
                {item.text}
              </p>
            );
          }
          if (item.kind === "error") {
            return (
              <p key={item.id} className="rounded-lg border border-coral px-3 py-2 text-sm text-coral" role="alert">
                {item.text}
              </p>
            );
          }
          return (
            <p key={item.id} className="whitespace-pre-wrap text-[15px] leading-relaxed">
              {item.text}
            </p>
          );
        })}
        <div ref={end} />
      </div>

      <div className="mt-3 border-t border-line pt-3">
        {running ? (
          <button type="button" onClick={onStop} className="w-full rounded-lg border border-line py-2 text-sm text-ink-2 hover:border-coral hover:text-coral">
            Stop
          </button>
        ) : canFollowUp ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!question.trim()) return;
              onFollowUp(question.trim());
              setQuestion("");
            }}
          >
            <input
              className="field"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Swap Denver for something cheaper, add a Texas leg…"
              aria-label="Ask Fanroute to change the plan"
            />
            <button type="submit" className="shrink-0 rounded-lg bg-amber px-4 font-semibold text-[#12100d]">
              Ask
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
