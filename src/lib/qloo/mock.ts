// Demo data for running Fanroute without a Qloo key. Every name here is
// fictional and every score is generated, so nothing in demo mode can be
// mistaken for a real venue, brand or audience measurement. The UI shows a
// "demo data" banner whenever this module answers.

import { MARKETS } from "@/lib/fanroute/markets";
import type { QlooEntity, QlooHeatmapPoint, QlooParams, QlooResponse } from "./types";

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string) {
  let state = hash(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

const str = (v: QlooParams[string]) => (Array.isArray(v) ? v.join(",") : v === undefined ? "" : String(v));

const DEMO_ARTISTS = [
  { name: "Juniper Static", genres: ["indie pop", "dream pop"], popularity: 0.62 },
  { name: "The Low Hours", genres: ["indie rock", "post-punk"], popularity: 0.71 },
  { name: "Mara Vey", genres: ["bedroom pop", "lo-fi"], popularity: 0.48 },
  { name: "Cobalt Lanterns", genres: ["shoegaze", "dream pop"], popularity: 0.55 },
  { name: "Saint Arbor", genres: ["folk", "americana"], popularity: 0.66 },
  { name: "Velvet Transit", genres: ["synthpop", "new wave"], popularity: 0.74 },
  { name: "Kilo Blue", genres: ["alt r&b", "neo soul"], popularity: 0.69 },
  { name: "Paper Comets", genres: ["indie folk", "chamber pop"], popularity: 0.44 },
];

const VENUE_WORDS = ["Ballroom", "Room", "Hall", "Lounge", "Theatre", "Social Club", "Basement", "Listening Room"];
const VENUE_PREFIX = ["Northside", "Lantern", "Copperline", "Fifth Street", "Riverside", "Greenhouse", "Union", "Ironworks", "Marigold", "Static"];
const BRANDS = [
  ["Fieldnote Coffee", "coffee"], ["Tidewater Cold Brew", "beverage"], ["Lowkey Denim", "apparel"],
  ["Analog Avenue Records", "music retail"], ["Pinecrest Outdoor", "outdoor"], ["Glowworm Audio", "audio"],
  ["Sundial Seltzer", "beverage"], ["Cardinal Skate Co.", "apparel"], ["Hearth & Ink Tattoo", "lifestyle"],
  ["Moth Light Candles", "home"], ["Overcast Thrift", "apparel"], ["Saltgrass Bikes", "mobility"],
] as const;
const PODCASTS = ["Liner Notes Late", "The B-Side Hour", "Small Rooms, Big Songs", "Tour Diary Radio", "Feedback Loop"];

function demoArtist(name: string, seed = name): QlooEntity {
  const known = DEMO_ARTISTS.find((a) => a.name.toLowerCase() === name.toLowerCase());
  const r = rng(seed);
  return {
    entity_id: `DEMO-ART-${hash(seed).toString(16).toUpperCase()}`,
    name: known?.name ?? name,
    subtype: "urn:entity:artist",
    popularity: known?.popularity ?? 0.35 + r() * 0.5,
    disambiguation: "Demo artist",
    tags: (known?.genres ?? ["indie", "alternative"]).map((g) => ({
      id: `urn:tag:genre:music:${g.replace(/\s+/g, "_")}`,
      name: g,
      type: "urn:tag:genre:music",
    })),
  };
}

function affinityFor(signal: string, marketId: string): number {
  const market = MARKETS.find((m) => m.id === marketId)!;
  const r = rng(`${signal}|${marketId}`);
  // Gentle structure so demo maps look like real taste geography: indie acts
  // over-index in college and coastal cities, with noise per artist.
  const indieBias = ["pdx", "sea", "aus", "den", "chi", "msn", "avl", "nyc", "phl", "msp", "sf", "la", "ber", "man", "gla", "ams", "cph"].includes(marketId) ? 0.18 : 0;
  return Math.max(0.05, Math.min(0.99, 0.35 + indieBias + r() * 0.45 - market.metroMillions / 120));
}

function insights(params: QlooParams): QlooResponse {
  const type = str(params["filter.type"]);
  const signal = str(params["signal.interests.entities"]) || str(params["signal.interests.tags"]) || "none";
  const take = Number(params.take ?? 10);
  const where = str(params["filter.location.query"]) || str(params["signal.location.query"]);

  if (type === "urn:heatmap") {
    if (str(params["output.heatmap.boundary"]) === "urn:entity:locality" && str(params["filter.location"]).startsWith("POLYGON")) {
      const heatmap: QlooHeatmapPoint[] = MARKETS.map((market) => ({
        name: market.name,
        entity_id: `DEMO-LOC-${market.id}`,
        location: { latitude: market.lat, longitude: market.lon },
        query: { affinity: affinityFor(signal, market.id), popularity: Math.min(1, market.metroMillions / 12) },
      }));
      return { success: true, results: { heatmap } };
    }
    const market = MARKETS.find((m) => m.query.toLowerCase() === where.toLowerCase() || m.name.toLowerCase() === where.toLowerCase());
    const r = rng(`${signal}|grid|${where}`);
    const heatmap: QlooHeatmapPoint[] = Array.from({ length: 60 }, () => {
      const lat = (market?.lat ?? 40) + (r() - 0.5) * 0.25;
      const lon = (market?.lon ?? -74) + (r() - 0.5) * 0.32;
      return { location: { latitude: lat, longitude: lon }, query: { affinity: r(), affinity_rank: r(), popularity: r() } };
    });
    return { success: true, results: { heatmap } };
  }

  if (type === "urn:demographics") {
    const r = rng(`${signal}|demo`);
    const ages = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];
    const peak = Math.floor(r() * 3);
    const age = Object.fromEntries(ages.map((k, i) => [k, Math.round((0.6 - Math.abs(i - peak) * 0.28 + (r() - 0.5) * 0.2) * 100) / 100]));
    const g = Math.round((r() - 0.5) * 0.4 * 100) / 100;
    return { success: true, results: { demographics: [{ entity_id: signal, query: { age, gender: { male: g, female: -g } } }] } };
  }

  const r = rng(`${signal}|${type}|${where}|${str(params["filter.tags"])}`);
  let entities: QlooEntity[] = [];
  if (type === "urn:entity:place") {
    const market = MARKETS.find((m) => m.query.toLowerCase() === where.toLowerCase() || m.name.toLowerCase() === where.toLowerCase());
    const tagText = str(params["filter.tags"]);
    const kind = tagText.includes("record") ? "Records" : tagText.includes("bar") ? "Tap Room" : tagText.includes("coffee") ? "Coffee" : "";
    entities = Array.from({ length: take }, (_, i) => {
      const name = `${VENUE_PREFIX[Math.floor(r() * VENUE_PREFIX.length)]} ${kind || VENUE_WORDS[Math.floor(r() * VENUE_WORDS.length)]}`;
      return {
        entity_id: `DEMO-PLC-${hash(name + where + i).toString(16).toUpperCase()}`,
        name,
        subtype: "urn:entity:place",
        location: { lat: (market?.lat ?? 40) + (r() - 0.5) * 0.08, lon: (market?.lon ?? -74) + (r() - 0.5) * 0.1 },
        properties: { address: `${100 + Math.floor(r() * 900)} Demo St, ${market?.name ?? where}`, business_rating: Math.round((3.8 + r() * 1.1) * 10) / 10 },
        popularity: r(),
        query: { affinity: Math.round((0.95 - i * 0.04 - r() * 0.03) * 100) / 100 },
        tags: [{ id: "urn:tag:category:place:music_venue", name: kind || "Music Venue" }],
      };
    });
  } else if (type === "urn:entity:brand") {
    entities = BRANDS.slice()
      .sort(() => r() - 0.5)
      .slice(0, take)
      .map(([name, category], i) => ({
        entity_id: `DEMO-BRD-${hash(name).toString(16).toUpperCase()}`,
        name,
        subtype: "urn:entity:brand",
        popularity: 0.2 + r() * 0.6,
        query: { affinity: Math.round((0.97 - i * 0.05) * 100) / 100 },
        tags: [{ id: `urn:tag:category:brand:${category.replace(/\s+/g, "_")}`, name: category }],
      }));
  } else if (type === "urn:entity:artist") {
    entities = DEMO_ARTISTS.filter((a) => !signal.includes(hash(a.name).toString(16).toUpperCase()))
      .slice(0, take)
      .map((a, i) => ({ ...demoArtist(a.name), query: { affinity: Math.round((0.94 - i * 0.06) * 100) / 100 } }));
  } else if (type === "urn:entity:podcast") {
    entities = PODCASTS.slice(0, take).map((name, i) => ({
      entity_id: `DEMO-POD-${hash(name).toString(16).toUpperCase()}`,
      name,
      subtype: "urn:entity:podcast",
      popularity: 0.3 + r() * 0.5,
      query: { affinity: Math.round((0.9 - i * 0.07) * 100) / 100 },
    }));
  } else if (type === "urn:entity:destination") {
    entities = MARKETS.map((market) => ({
      entity_id: `DEMO-DST-${market.id}`,
      name: market.name,
      subtype: "urn:entity:destination",
      location: { lat: market.lat, lon: market.lon },
      query: { affinity: affinityFor(signal, market.id) },
    }))
      .sort((a, b) => (b.query!.affinity ?? 0) - (a.query!.affinity ?? 0))
      .slice(0, take);
  }
  return { success: true, results: { entities } };
}

export function mockQloo(path: string, params: QlooParams): QlooResponse {
  if (path === "/search") {
    const query = str(params.query).trim();
    if (!query) return { success: true, results: { entities: [] } };
    const matches = DEMO_ARTISTS.filter((a) => a.name.toLowerCase().includes(query.toLowerCase())).map((a) => demoArtist(a.name));
    return { success: true, results: { entities: matches.length ? matches : [demoArtist(query)] } };
  }
  if (path === "/entities") {
    const ids = str(params.entity_ids).split(",").filter(Boolean);
    const entities = ids.map((id) => {
      const known = DEMO_ARTISTS.find((a) => `DEMO-ART-${hash(a.name).toString(16).toUpperCase()}` === id);
      return known ? demoArtist(known.name) : { ...demoArtist(id), entity_id: id };
    });
    return { success: true, results: { entities } };
  }
  if (path === "/v2/tags") {
    const q = str(params["filter.query"]).toLowerCase().replace(/\s+/g, "_");
    return { success: true, results: { tags: [{ id: `urn:tag:category:place:${q}`, name: str(params["filter.query"]), type: "urn:tag:category:place" }] } };
  }
  if (path === "/v2/trending") {
    const r = rng(`${str(params["signal.interests.entities"])}|trend`);
    let pct = 40 + r() * 40;
    const trending = Array.from({ length: 12 }, (_, i) => {
      pct = Math.max(1, Math.min(99, pct + (r() - 0.42) * 6));
      const d = new Date(Date.UTC(2026, 6, 1 + i * 7));
      return { date: d.toISOString().slice(0, 10), population_percentile: Math.round(pct * 10) / 10 };
    });
    return { success: true, results: { trending } };
  }
  if (path === "/v2/insights") return insights(params);
  return { success: true, results: {} };
}
