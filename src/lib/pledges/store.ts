import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Fan pledge campaigns. Persistence is a tiny key-value layer: Upstash Redis
// over REST when configured (needed on serverless hosts), otherwise a JSON
// file in the OS temp dir for local runs.

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
}

function upstash(): KV | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return undefined;
  const cmd = async (args: string[]) => {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify(args), cache: "no-store" });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    return ((await res.json()) as { result: string | null }).result;
  };
  return { get: (k) => cmd(["GET", k]), set: async (k, v) => void (await cmd(["SET", k, v])) };
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
};

const kv = (): KV => upstash() ?? fileKV;

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
    const all = await listPledges(p.campaignId);
    const existing = all.find((x) => x.orderId === p.orderId);
    if (existing) return existing; // a retried authorize must not double count
    const pledge: Pledge = { ...p, id: newId("pl"), status: "authorized", createdAt: new Date().toISOString() };
    all.push(pledge);
    await kv().set(`pledges:${p.campaignId}`, JSON.stringify(all));
    return pledge;
  });
}

export async function updatePledges(campaignId: string, fn: (all: Pledge[]) => Promise<Pledge[]>): Promise<Pledge[]> {
  return withLock(campaignId, async () => {
    const next = await fn(await listPledges(campaignId));
    await kv().set(`pledges:${campaignId}`, JSON.stringify(next));
    return next;
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
