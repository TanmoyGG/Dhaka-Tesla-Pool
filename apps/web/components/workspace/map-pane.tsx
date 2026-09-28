"use client";

// Shared workspace map (frontend-design.md §8). Plain Leaflet, imperative —
// no react-leaflet wrapper. This is the ONLY module that imports leaflet, and
// it is mounted client-only via `next/dynamic(…, { ssr: false })` in the
// workspace page so Leaflet never executes during prerender.
//
// Non-blocking rule (hard): if the map fails, booking is unaffected — the
// pane falls back to a quiet message and the controls carry on.
//
// Phase 4 (passenger book mode): the workspace lifts the form's zone selection
// here as pickupZoneId/destinationZoneId. Selected pins get distinct markers
// with an open tooltip, and once BOTH ends are chosen the view fits the route.
// Zone coordinates still come ONLY from GET /api/zones — never hardcoded here.

import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { useZones } from "@/lib/queries";

// Dhaka city center — the map's initial view only.
const DHAKA_CENTER: L.LatLngTuple = [23.79, 90.4];
const DHAKA_ZOOM = 12;

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Set an icon class so the selected pickup/destination pins stand out from
// the muted zone dots (CSS in globals.css drives the look — divIcon, no image
// assets). Any extra class becomes part of the marker's wrapper class.
function zoneIcon(extra?: string): L.DivIcon {
  const wrapper = extra ? `zone-marker ${extra}` : "zone-marker";
  return L.divIcon({
    className: wrapper,
    html: `<span class="zone-marker-dot" aria-hidden="true"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    tooltipAnchor: [0, -11],
  });
}

export default function MapPane({
  pickupZoneId,
  destinationZoneId,
  destinationZoneIds,
}: {
  pickupZoneId?: string;
  destinationZoneId?: string;
  // Driver workspace (frontend-design.md §6.4/§8): a pool can carry members
  // to DIFFERENT destinations (Banani → Mohakhali + Banani → Gulshan 1), so
  // the map highlights the shared pickup and EVERY distinct drop-off. Additive
  // and optional: the passenger surface keeps using destinationZoneId.
  destinationZoneIds?: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // zoneId → marker, rebuilt whenever the zone list refetches.
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
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

  // Rebuild the zone-pin layer from /api/zones whenever the list refreshes.
  // The map never gates the panel, and a zones error just leaves pins off.
  useEffect(() => {
    if (!map || !zones.data) return;
    const markers = markersRef.current;
    markers.forEach((marker) => marker.remove());
    markers.clear();
    for (const zone of zones.data) {
      const marker = L.marker([zone.latitude, zone.longitude], {
        icon: zoneIcon(),
      }).addTo(map);
      marker.bindTooltip(zone.name, { direction: "top" });
      markers.set(zone.id, marker);
    }
  }, [map, zones.data]);

  // Selection feedback: restyle the chosen pins, open their tooltips, and fit
  // the route once both ends are known. Idempotent per selection change.
  useEffect(() => {
    if (!map || !zones.data) return;
    const markers = markersRef.current;
    const destinationIds = new Set(
      destinationZoneIds ?? (destinationZoneId ? [destinationZoneId] : []),
    );

    for (const [id, marker] of markers) {
      let extra: string | undefined;
      if (id === pickupZoneId) extra = "zone-marker--pickup";
      else if (destinationIds.has(id)) extra = "zone-marker--destination";
      marker.setIcon(zoneIcon(extra));
      if (extra) marker.openTooltip();
      else marker.closeTooltip();
    }

    // Fit the view once the pickup and at least one destination are known.
    const pickup = zones.data.find((zone) => zone.id === pickupZoneId);
    const destinations = Array.from(destinationIds).flatMap((id) => {
      const zone = zones.data.find((zone) => zone.id === id);
      return zone ? [zone] : [];
    });
    if (pickup && destinations.length > 0) {
      map.fitBounds(
        L.latLngBounds([
          [pickup.latitude, pickup.longitude],
          ...destinations.map(
            (zone) =>
              [zone.latitude, zone.longitude] as L.LatLngTuple,
          ),
        ]),
        { padding: [48, 48], maxZoom: 15 },
      );
    }
  }, [map, zones.data, pickupZoneId, destinationZoneId, destinationZoneIds]);

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