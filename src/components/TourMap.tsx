"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import type { PlanState } from "@/lib/agent/tools";

const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";

const REGION_VIEW = {
  "north-america": { center: [-96, 39] as [number, number], zoom: 3.1 },
  europe: { center: [6, 50] as [number, number], zoom: 3.6 },
};

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: "FeatureCollection", features });

function marketsFC(state: PlanState): FC {
  const onRoute = new Set(state.route?.stops.map((s) => s.market.id));
  return fc(
    (state.ranking?.markets ?? []).map((m) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [m.lon, m.lat] },
      properties: { id: m.marketId, name: m.name, demand: m.demand, rank: m.rank, affinity: m.affinity, onRoute: onRoute.has(m.marketId) ? 1 : 0 },
    })),
  );
}

function routeFC(state: PlanState): FC {
  const stops = state.route?.stops ?? [];
  if (stops.length < 2) return fc([]);
  const coords = stops.map((s) => [s.market.lon, s.market.lat]);
  const last = state.route!.legs[state.route!.legs.length - 1];
  if (last && last.to === stops[0].market.id && stops.length === state.route!.legs.length) coords.push(coords[0]);
  return fc([{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }]);
}

function focusFC(state: PlanState, marketId?: string): { spots: FC; venues: FC } {
  const scout = marketId ? state.scouts[marketId] : undefined;
  if (!scout) return { spots: fc([]), venues: fc([]) };
  return {
    spots: fc(
      scout.hotspots.map((h) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [h.lon, h.lat] },
        properties: { affinity: h.affinity, name: h.name ?? "" },
      })),
    ),
    venues: fc(
      [...scout.venues.map((v) => ({ ...v, kind: "venue" })), ...scout.hangouts.map((v) => ({ ...v, kind: "hangout" }))]
        .filter((v) => v.lat !== undefined && v.lon !== undefined)
        .map((v) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [v.lon!, v.lat!] },
          properties: { name: v.name, kind: v.kind, affinity: v.affinity ?? 0 },
        })),
    ),
  };
}

export function TourMap({ state, focus, onFocus }: { state: PlanState; focus?: string; onFocus: (marketId: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const onFocusRef = useRef(onFocus);

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !box.current) return;
      maplibre.setWorkerUrl(new URL("/maplibre/maplibre-gl-worker.mjs", window.location.origin).href);
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const m = new maplibre.Map({
        container: box.current,
        style: dark ? STYLE_DARK : STYLE_LIGHT,
        center: REGION_VIEW["north-america"].center,
        zoom: REGION_VIEW["north-america"].zoom,
        attributionControl: { compact: true },
      });
      m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      m.on("load", () => {
        m.addSource("markets", { type: "geojson", data: fc([]) });
        m.addSource("route", { type: "geojson", data: fc([]) });
        m.addSource("spots", { type: "geojson", data: fc([]) });
        m.addSource("venues", { type: "geojson", data: fc([]) });
        m.addLayer({
          id: "spots-heat",
          type: "heatmap",
          source: "spots",
          paint: {
            "heatmap-weight": ["get", "affinity"],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 18, 13, 40],
            "heatmap-intensity": 1.1,
            "heatmap-opacity": 0.75,
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.3, "#5c3a12", 0.6, "#ffb547", 1, "#ff6a4d"],
          },
        });
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ff6a4d", "line-width": 3, "line-dasharray": [1.5, 1.2] },
        });
        m.addLayer({
          id: "markets-dot",
          type: "circle",
          source: "markets",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "demand"], 0, 3, 100, 14],
            "circle-color": ["interpolate", ["linear"], ["get", "demand"], 0, "#5d5547", 50, "#c9790a", 100, "#ffb547"],
            "circle-opacity": ["case", ["==", ["get", "onRoute"], 1], 0.95, 0.45],
            "circle-stroke-width": ["case", ["==", ["get", "onRoute"], 1], 2, 0],
            "circle-stroke-color": "#12100d",
          },
        });
        m.addLayer({
          id: "venue-pins",
          type: "circle",
          source: "venues",
          paint: {
            "circle-radius": 6,
            "circle-color": ["case", ["==", ["get", "kind"], "venue"], "#ff6a4d", "#5cc8b4"],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#12100d",
          },
        });
        const popup = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
        m.on("mousemove", "markets-dot", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          m.getCanvas().style.cursor = "pointer";
          const p = f.properties as { name: string; demand: number; rank: number; affinity: number };
          popup
            .setLngLat(e.lngLat)
            .setHTML(`<strong>${p.name}</strong><br/><span style="font-family:var(--font-data)">#${p.rank} · demand ${p.demand}/100 · affinity ${p.affinity}</span>`)
            .addTo(m);
        });
        m.on("mouseleave", "markets-dot", () => {
          m.getCanvas().style.cursor = "";
          popup.remove();
        });
        m.on("click", "markets-dot", (e) => {
          const id = (e.features?.[0]?.properties as { id?: string } | undefined)?.id;
          if (id) onFocusRef.current(id);
        });
        m.on("mousemove", "venue-pins", (e) => {
          const p = e.features?.[0]?.properties as { name: string; kind: string } | undefined;
          if (!p) return;
          popup.setLngLat(e.lngLat).setHTML(`<strong>${p.name}</strong><br/>${p.kind === "venue" ? "Venue" : "Local partner"}`).addTo(m);
        });
        m.on("mouseleave", "venue-pins", () => popup.remove());
        setReady(true);
      });
      map.current = m;
      resize = new ResizeObserver(() => m.resize());
      resize.observe(box.current);
    })();
    return () => {
      cancelled = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Data layers.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("markets") as GeoJSONSource).setData(marketsFC(state));
    (m.getSource("route") as GeoJSONSource).setData(routeFC(state));
    const { spots, venues } = focusFC(state, focus);
    (m.getSource("spots") as GeoJSONSource).setData(spots);
    (m.getSource("venues") as GeoJSONSource).setData(venues);
  }, [ready, state, focus]);

  // Numbered stop markers.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    let cancelled = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled) return;
      markers.current.forEach((mk) => mk.remove());
      markers.current = (state.route?.stops ?? []).map((s, i) => {
        const el = document.createElement("button");
        el.type = "button";
        el.textContent = String(i + 1);
        el.setAttribute("aria-label", `Stop ${i + 1}: ${s.market.name}`);
        el.style.cssText =
          "width:24px;height:24px;border-radius:999px;background:#ff6a4d;color:#12100d;font:700 12px var(--font-data),monospace;border:2px solid #12100d;cursor:pointer";
        el.onclick = () => onFocusRef.current(s.market.id);
        return new maplibre.Marker({ element: el, offset: [0, -16] }).setLngLat([s.market.lon, s.market.lat]).addTo(m);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, state.route]);

  // Camera: the focused city, else the route, else the region.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const scoutFocus = focus ? state.ranking?.markets.find((x) => x.marketId === focus) : undefined;
    if (scoutFocus) {
      m.flyTo({ center: [scoutFocus.lon, scoutFocus.lat], zoom: 10.5, duration: 900 });
      return;
    }
    const stops = state.route?.stops ?? [];
    if (stops.length >= 2) {
      const lons = stops.map((s) => s.market.lon);
      const lats = stops.map((s) => s.market.lat);
      m.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding: 60, duration: 900, maxZoom: 7 },
      );
      return;
    }
    const view = REGION_VIEW[state.region ?? "north-america"];
    m.flyTo({ center: view.center, zoom: view.zoom, duration: 900 });
  }, [ready, focus, state.route, state.region, state.ranking]);

  return <div ref={box} className="h-full min-h-[320px] w-full overflow-hidden rounded-[14px]" role="region" aria-label="Tour map" />;
}
