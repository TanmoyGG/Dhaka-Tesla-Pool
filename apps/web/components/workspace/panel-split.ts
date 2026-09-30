// Snap geometry for the mobile map/panel split (frontend-design.md §8). Pure
// functions over numbers — no React, no DOM — so the same three positions drive
// both the passenger `/rides` workspace and the driver `/driver` workspace and
// the behaviour is unit-testable on its own.
//
// The split is stored as the MAP's share of the (map + panel) box rather than a
// pixel height or a viewport unit. The workspace grid turns that share into an
// fr ratio (mapFr = share / (1 - share), panel pinned to 1fr), so one snap point
// stays correct on any phone height, in both orientations, and under browser
// font/zoom scaling. Nothing here knows about the grip height, the grid gap, or
// the map's minimum height — CSS owns those.

/**
 * Guard rails for free dragging. The map must always keep enough of itself to
 * preserve spatial context, and the panel must never be squeezed away. Both
 * sit OUTSIDE the snap range on purpose: dragging can approach them, releasing
 * always snaps back to a supported stop.
 */
export const MIN_MAP_SHARE = 0.18;
export const MAX_MAP_SHARE = 0.72;

export type SplitStopId = "half" | "expanded" | "large";

export type SplitStop = {
  id: SplitStopId;
  /** Share of the map+panel box given to the MAP (0–1). */
  mapShare: number;
  label: string;
};

/** The default 50/50 split — what the workspace used before the resizer. */
export const STOP_HALF: SplitStop = {
  id: "half",
  mapShare: 0.5,
  label: "Map and panel split evenly",
};

export const STOP_EXPANDED: SplitStop = {
  id: "expanded",
  mapShare: 0.3,
  label: "Panel expanded",
};

export const STOP_LARGE: SplitStop = {
  id: "large",
  mapShare: 0.2,
  label: "Panel maximised",
};

/** Ordered most map → least map, so `index` also reads as "drag direction". */
export const SPLIT_STOPS: readonly SplitStop[] = [
  STOP_HALF,
  STOP_EXPANDED,
  STOP_LARGE,
];

export const DEFAULT_SPLIT = STOP_HALF;

export function clampMapShare(mapShare: number): number {
  if (!Number.isFinite(mapShare)) return DEFAULT_SPLIT.mapShare;
  return Math.min(MAX_MAP_SHARE, Math.max(MIN_MAP_SHARE, mapShare));
}

/** fr ratio for the map track, with the panel track pinned to 1fr. */
export function mapShareToMapFr(mapShare: number): number {
  const share = clampMapShare(mapShare);
  return share / (1 - share);
}

/** Inverse of {@link mapShareToMapFr}; useful for asserting round-trips. */
export function mapFrToShare(mapFr: number): number {
  if (!Number.isFinite(mapFr) || mapFr < 0) return DEFAULT_SPLIT.mapShare;
  return mapFr / (1 + mapFr);
}

/** The supported stop a (possibly off-stop) share belongs to. */
export function nearestStop(mapShare: number): SplitStop {
  let best = SPLIT_STOPS[0];
  for (const stop of SPLIT_STOPS) {
    if (Math.abs(stop.mapShare - mapShare) < Math.abs(best.mapShare - mapShare)) {
      best = stop;
    }
  }
  return best;
}

/** Keyboard stepping. A positive delta grows the panel (divider moves up). */
export function stepStop(mapShare: number, delta: number): SplitStop {
  const index = SPLIT_STOPS.indexOf(nearestStop(mapShare));
  const next = Math.min(SPLIT_STOPS.length - 1, Math.max(0, index + delta));
  return SPLIT_STOPS[next];
}

export function firstStop(): SplitStop {
  return SPLIT_STOPS[0];
}

export function lastStop(): SplitStop {
  return SPLIT_STOPS[SPLIT_STOPS.length - 1];
}

/**
 * The map share for a pointer at `clientY`.
 *
 * Measured against the LIVE map/panel boxes rather than the workspace's
 * padding box, so the divider tracks the finger exactly whatever the gap, grip
 * height or the map's minimum height happen to be. Returns `null` when the
 * geometry cannot be measured (an unlaid-out box, e.g. a prerender) so the
 * caller can keep the current split instead of jumping to a bogus one.
 */
export function mapShareFromPointer(geometry: {
  clientY: number;
  mapTop: number;
  mapHeight: number;
  panelHeight: number;
}): number | null {
  const { clientY, mapTop, mapHeight, panelHeight } = geometry;
  const free = mapHeight + panelHeight;
  if (!(free > 0)) return null;
  return clampMapShare((clientY - mapTop) / free);
}

/** Percentage pair used for the separator's accessible value/description. */
export function splitPercentages(mapShare: number): {
  map: number;
  panel: number;
} {
  const share = clampMapShare(mapShare);
  return {
    map: Math.round(share * 100),
    panel: Math.round((1 - share) * 100),
  };
}
