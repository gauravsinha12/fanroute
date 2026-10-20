"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentEvent, LlmMode } from "@/lib/agent/agent";
import type { Brief } from "@/lib/agent/autopilot";
import type { PlanState } from "@/lib/agent/tools";

export interface TimelineItem {
  id: string;
  kind: "progress" | "tool" | "text" | "error" | "user";
  text?: string;
  name?: string;
  input?: unknown;
  status?: "running" | "ok" | "failed";
  ms?: number;
  error?: string;
}

export interface PlanStream {
  state: PlanState;
  timeline: TimelineItem[];
  running: boolean;
  mode?: { qloo: "live" | "demo"; llm: LlmMode; model?: string };
  start: (brief: Brief) => void;
  followUp: (question: string) => void;
  stop: () => void;
  reset: () => void;
  setPledges: (pledges: PlanState["pledges"]) => void;
}

const empty = (): PlanState => ({ artists: [], scouts: {} });

export function usePlanStream(): PlanStream {
  const [state, setState] = useState<PlanState>(empty);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<PlanStream["mode"]>();
  const abort = useRef<AbortController | null>(null);
  const history = useRef<unknown[] | undefined>(undefined);
  const lastBrief = useRef<Brief | null>(null);
  const stateRef = useRef<PlanState>(empty());

  const apply = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "mode":
        setMode({ qloo: event.qloo, llm: event.llm, model: event.model });
        break;
      case "progress":
        setTimeline((t) => [...t, { id: crypto.randomUUID(), kind: "progress", text: event.text }]);
        break;
      case "tool_start":
        setTimeline((t) => [...t, { id: event.id, kind: "tool", name: event.name, input: event.input, status: "running" }]);
        break;
      case "tool_end":
        setTimeline((t) => t.map((i) => (i.id === event.id ? { ...i, status: event.ok ? "ok" : "failed", ms: event.ms, error: event.error } : i)));
        break;
      case "text":
        setTimeline((t) => {
          const last = t[t.length - 1];
          if (last?.kind === "text") return [...t.slice(0, -1), { ...last, text: (last.text ?? "") + event.delta }];
          return [...t, { id: crypto.randomUUID(), kind: "text", text: event.delta }];
        });
        break;
      case "data":
        setState((s) => {
          const next = { ...s, [event.key]: event.value } as PlanState;
          stateRef.current = next;
          return next;
        });
        break;
      case "history":
        history.current = event.messages;
        break;
      case "error":
        setTimeline((t) => [...t, { id: crypto.randomUUID(), kind: "error", text: event.message }]);
        break;
      case "note":
        setTimeline((t) => [...t, { id: crypto.randomUUID(), kind: "progress", text: event.text }]);
        break;
    }
  }, []);

  const run = useCallback(
    async (body: Record<string, unknown>) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setRunning(true);
      try {
        const res = await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
          apply({ type: "error", message: err.error ?? "Request failed" });
          return;
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let cut;
          while ((cut = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            if (chunk.startsWith("data: ")) apply(JSON.parse(chunk.slice(6)) as AgentEvent);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) apply({ type: "error", message: err instanceof Error ? err.message : "Connection lost" });
      } finally {
        if (abort.current === controller) setRunning(false);
      }
    },
    [apply],
  );

  const start = useCallback(
    (brief: Brief) => {
      lastBrief.current = brief;
      history.current = undefined;
      stateRef.current = empty();
      setState(empty());
      setTimeline([]);
      void run({ brief });
    },
    [run],
  );

  const followUp = useCallback(
    (question: string) => {
      if (!lastBrief.current) return;
      setTimeline((t) => [...t, { id: crypto.randomUUID(), kind: "user", text: question }]);
      void run({ brief: lastBrief.current, followUp: question, history: history.current, state: stateRef.current });
    },
    [run],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    setRunning(false);
    setTimeline([]);
    setState(empty());
    stateRef.current = empty();
    history.current = undefined;
    setMode(undefined);
  }, []);

  const setPledges = useCallback((pledges: PlanState["pledges"]) => {
    setState((s) => {
      const next = { ...s, pledges };
      stateRef.current = next;
      return next;
    });
  }, []);

  return { state, timeline, running, mode, start, followUp, stop, reset, setPledges };
}
