import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BlobPreconditionFailedError, get as blobGet, put as blobPut } from "@vercel/blob";

// Fan pledge campaigns. Persistence is a tiny key-value layer: Upstash Redis
// over REST or a private Vercel Blob store when configured (one of them is
// needed on serverless hosts, where each route runs in its own instance),
// otherwise a JSON file in the OS temp dir for local runs.

export interface CampaignCity {
  marketId: string;
  name: string;
  demand: number;
}

export interface Campaign {
  id: string;
  artist: string;
  title: string;
  currency: string;
  pledgeAmount: number;
  goalPerCity: number;
  cities: CampaignCity[];
  createdAt: string;
  ownerKeyHash: string;
}

export type PledgeStatus = "authorized" | "captured" | "voided";

export interface Pledge {
  id: string;
  campaignId: string;
  marketId: string;
  amount: number;
  orderId: string;
  authorizationId: string;
  captureId?: string;
  payerName?: string;
  status: PledgeStatus;
  createdAt: string;
}

export interface CityTotals {
  marketId: string;
  name: string;
  demand: number;
  pledged: number;
  backers: number;
  captured: number;
  goal: number;
  reached: boolean;
}

interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  /** Read-modify-write that is safe across processes where the backend allows it. */
  update(key: string, fn: (current: string | null) => string): Promise<string>;
}

// Backends without compare-and-swap rely on the in-process lock in withLock.
const naiveUpdate =
  (get: KV["get"], set: KV["set"]): KV["update"] =>
  async (key, fn) => {
    const next = fn(await get(key));
    await set(key, next);
    return next;
  };

function upstash(): KV | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return undefined;
  const cmd = async (args: string[]) => {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify(args), cache: "no-store" });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    return ((await res.json()) as { result: string | null }).result;
  };
  const get: KV["get"] = (k) => cmd(["GET", k]);
  const set: KV["set"] = async (k, v) => void (await cmd(["SET", k, v]));
  return { get, set, update: naiveUpdate(get, set) };
}

// Private Vercel Blob store: one JSON blob per key. Reads skip the CDN cache,
// and updates are conditional on the ETag that was read, so two instances
// writing the same campaign retry instead of overwriting each other.
function vercelBlob(): KV | undefined {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return undefined;
  const pathname = (key: string) => `fanroute/${key.replace(":", "/")}.json`;
  const read = async (key: string): Promise<{ text: string; etag: string } | null> => {
    const res = await blobGet(pathname(key), { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    // A compressed response can carry the weak form (W/"…") of the same ETag,
    // which a conditional write never matches.
    return { text: await new Response(res.stream).text(), etag: res.blob.etag.replace(/^W\//, "") };
  };
  const write = (key: string, value: string, opts: { ifMatch?: string; create?: boolean } = {}) =>
    blobPut(pathname(key), value, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: !opts.create,
      ...(opts.ifMatch ? { ifMatch: opts.ifMatch } : {}),
    });
  return {
    get: async (key) => (await read(key))?.text ?? null,
    set: async (key, value) => void (await write(key, value)),
    async update(key, fn) {
      for (let attempt = 0; ; attempt++) {
        const current = await read(key);
        const next = fn(current?.text ?? null);
        try {
          await write(key, next, current ? { ifMatch: current.etag } : { create: true });
          return next;
        } catch (err) {
          // Someone else wrote first: an ETag mismatch, or the blob now exists.
          const conflict = err instanceof BlobPreconditionFailedError || (!current && /exist/i.test(String(err)));
          if (process.env.STORE_DEBUG) console.error(`[store] attempt ${attempt} conflict=${conflict} etag=${current?.etag} ${String(err).slice(0, 80)}`);
          if (!conflict || attempt >= 6) throw err;
          await new Promise((r) => setTimeout(r, 40 * (attempt + 1) + Math.random() * 60));
        }
      }
    },
  };
}

const FILE = path.join(os.tmpdir(), "fanroute-pledges.json");
let fileCache: Record<string, string> | undefined;
const fileKV: KV = {
  async get(key) {
    if (!fileCache) fileCache = JSON.parse(await fs.readFile(FILE, "utf8").catch(() => "{}")) as Record<string, string>;
    return fileCache[key] ?? null;
  },
  async set(key, value) {
    if (!fileCache) fileCache = JSON.parse(await fs.readFile(FILE, "utf8").catch(() => "{}")) as Record<string, string>;
    fileCache[key] = value;
    await fs.writeFile(FILE, JSON.stringify(fileCache));
  },
  update: (key, fn) => naiveUpdate(fileKV.get, fileKV.set)(key, fn),
};

const kv = (): KV => upstash() ?? vercelBlob() ?? fileKV;

export function storeMode(): "upstash" | "vercel-blob" | "file" {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "file";
}

// Writes for one campaign are serialized so concurrent pledges don't drop
// each other in the read-modify-write below.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => undefined));
  return next;
}

const hash = (s: string) => createHash("sha256").update(s).digest("base64url");
const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;

export async function createCampaign(input: Omit<Campaign, "id" | "createdAt" | "ownerKeyHash">): Promise<{ campaign: Campaign; ownerKey: string }> {
  const ownerKey = randomBytes(18).toString("base64url");
  const campaign: Campaign = { ...input, id: newId("tour"), createdAt: new Date().toISOString(), ownerKeyHash: hash(ownerKey) };
  await kv().set(`campaign:${campaign.id}`, JSON.stringify(campaign));
  await kv().set(`pledges:${campaign.id}`, "[]");
  return { campaign, ownerKey };
}

export async function getCampaign(id: string): Promise<Campaign | undefined> {
  const raw = await kv().get(`campaign:${id}`);
  return raw ? (JSON.parse(raw) as Campaign) : undefined;
}

export function isOwner(campaign: Campaign, ownerKey: string | null | undefined): boolean {
  if (!ownerKey) return false;
  const a = Buffer.from(hash(ownerKey));
  const b = Buffer.from(campaign.ownerKeyHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function listPledges(campaignId: string): Promise<Pledge[]> {
  return JSON.parse((await kv().get(`pledges:${campaignId}`)) ?? "[]") as Pledge[];
}

export async function addPledge(p: Omit<Pledge, "id" | "createdAt" | "status">): Promise<Pledge> {
  return withLock(p.campaignId, async () => {
    let result: Pledge | undefined;
    await kv().update(`pledges:${p.campaignId}`, (raw) => {
      const all = JSON.parse(raw ?? "[]") as Pledge[];
      const existing = all.find((x) => x.orderId === p.orderId);
      if (existing) {
        result = existing; // a retried authorize must not double count
        return JSON.stringify(all);
      }
      result = { ...p, id: newId("pl"), status: "authorized", createdAt: new Date().toISOString() };
      return JSON.stringify([...all, result]);
    });
    return result!;
  });
}

// `fn` may call PayPal, so it runs once, outside the store's retry loop; the
// changed pledges are then merged into whatever is stored at write time, so a
// pledge that arrives meanwhile isn't lost.
export async function updatePledges(campaignId: string, fn: (all: Pledge[]) => Promise<Pledge[]>): Promise<Pledge[]> {
  return withLock(campaignId, async () => {
    const before = await listPledges(campaignId);
    const snapshot = new Map(before.map((x) => [x.id, JSON.stringify(x)]));
    const after = await fn(before); // fn may mutate `before` in place
    const changed = new Map(after.filter((x) => snapshot.get(x.id) !== JSON.stringify(x)).map((x) => [x.id, x]));
    const raw = await kv().update(`pledges:${campaignId}`, (cur) =>
      JSON.stringify((JSON.parse(cur ?? "[]") as Pledge[]).map((x) => changed.get(x.id) ?? x)),
    );
    return JSON.parse(raw) as Pledge[];
  });
}

export function totals(campaign: Campaign, pledges: Pledge[]): CityTotals[] {
  return campaign.cities.map((c) => {
    const mine = pledges.filter((p) => p.marketId === c.marketId);
    const live = mine.filter((p) => p.status !== "voided");
    const pledged = live.reduce((s, p) => s + p.amount, 0);
    return {
      ...c,
      pledged,
      backers: live.length,
      captured: mine.filter((p) => p.status === "captured").reduce((s, p) => s + p.amount, 0),
      goal: campaign.goalPerCity,
      reached: pledged >= campaign.goalPerCity,
    };
  });
}
