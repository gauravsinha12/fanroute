import { mockQloo } from "./mock";
import type { QlooParams, QlooResponse } from "./types";

// Hackathon keys only work against this host; production keys can point
// QLOO_BASE_URL at https://api.qloo.com instead.
const BASE_URL = process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com";
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 500;

export class QlooError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
  }
}

export function qlooMode(): "live" | "demo" {
  return process.env.QLOO_API_KEY ? "live" : "demo";
}

// Insights GET requests take arrays as comma-separated values.
export function toSearchParams(params: QlooParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  search.sort();
  return search;
}

// /search and /entities return `results` as a bare array of entities, while the
// v2 endpoints return `results: { entities | heatmap | tags | … }`. Callers only
// ever see the second shape.
function normalize(body: unknown): QlooResponse {
  const value = body as QlooResponse & { results?: unknown };
  if (Array.isArray(value.results)) return { ...value, results: { entities: value.results } };
  return value as QlooResponse;
}

// The hackathon key is rate limited, and a plan fires dozens of calls (scouting
// runs per stop in parallel). Cap requests in flight so bursts don't hit 429s.
const MAX_ATTEMPTS = 5;
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

const cache = new Map<string, { at: number; value: QlooResponse }>();

function cacheGet(key: string): QlooResponse | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key: string, value: QlooResponse) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

// Every Qloo request in the app goes through here: one place for auth, caching,
// retries and the demo fallback.
export async function qlooGet(path: string, params: QlooParams): Promise<QlooResponse> {
  const query = toSearchParams(params).toString();
  const key = `${path}?${query}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const apiKey = process.env.QLOO_API_KEY;
  if (!apiKey) {
    const value = mockQloo(path, params);
    cacheSet(key, value);
    return value;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withSlot(() =>
        fetch(`${BASE_URL}${path}?${query}`, {
          headers: { "X-Api-Key": apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        }),
      );
      if (res.status === 429 || res.status >= 500) {
        lastError = new QlooError(`Qloo ${res.status}`, res.status, path);
        // Honour Retry-After when Qloo sends it; otherwise back off exponentially with jitter.
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 600 * 2 ** attempt + Math.random() * 300;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new QlooError(`Qloo ${res.status} on ${path}: ${body.slice(0, 300)}`, res.status, path);
      }
      const value = normalize(await res.json());
      cacheSet(key, value);
      return value;
    } catch (err) {
      if (err instanceof QlooError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Qloo request failed: ${path}`);
}
