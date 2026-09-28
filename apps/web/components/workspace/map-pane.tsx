"use client";

// Shared workspace map (frontend-design.md §8). Plain Leaflet, imperative —
// no react-leaflet wrapper. This is the ONLY module that imports leaflet, and
// it is mounted client-only via `next/dynamic(…, { ssr: false })` in the
// workspace page so Leaflet never executes during prerender.
//
// Non-blocking rule (hard): if the map fails, booking is unaffected — the
// pane falls back to a quiet message and the controls carry on.

import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { useZones } from "@/lib/queries";

// Dhaka city center — the map's initial view only. Zone coordinates are NEVER
// hardcoded: they always come from GET /api/zones via useZones().
const DHAKA_CENTER: L.LatLngTuple = [23.79, 90.4];
const DHAKA_ZOOM = 12;

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Decorative lime pin for a zone. divIcon → no marker-image assets to bundle,
// matches the always-dark accent token set.
function zoneIcon(): L.DivIcon {
  return L.divIcon({
    className: "zone-marker",
    html: `<span class="zone-marker-dot" aria-hidden="true"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    tooltipAnchor: [0, -11],
  });
}

export default function MapPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const [failed, setFailed] = useState(false);
  const zones = useZones();

  // Create the map exactly once per mount and tear it down with the pane.
  // ResizeObserver keeps the Leaflet viewport correct whenever the workspace
  // changes size (desktop ↔ mobile stacking, viewport resize, orientation).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    let instance: L.Map;
    try {
      instance = L.map(el, {
        center: DHAKA_CENTER,
        zoom: DHAKA_ZOOM,
      });
      L.tileLayer(OSM_TILE_URL, {
        attribution: OSM_ATTRIBUTION,
        maxZoom: 19,
      }).addTo(instance);
    } catch {
      setFailed(true);
      return;
    }

    const observer = new ResizeObserver(() => {
      instance.invalidateSize();
    });
    observer.observe(el);

    mapRef.current = instance;
    setMap(instance);

    return () => {
      observer.disconnect();
      instance.remove();
      mapRef.current = null;
      setMap(null);
    };
  }, []);

  // Zone pins load independently of map init — applied whenever both exist.
  // The map never gates the panel, and a zones error just leaves pins off.
  useEffect(() => {
    if (!map || !zones.data) return;
    for (const zone of zones.data) {
      L.marker([zone.latitude, zone.longitude], { icon: zoneIcon() })
        .addTo(map)
        .bindTooltip(zone.name, { direction: "top" });
    }
  }, [map, zones.data]);

  if (failed) {
    return (
      <div className="map-pane map-pane-fallback" role="status">
        Live map unavailable — ride controls on the left are unaffected.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="map-pane"
      aria-label="Dhaka zones map"
      role="region"
    />
  );
}