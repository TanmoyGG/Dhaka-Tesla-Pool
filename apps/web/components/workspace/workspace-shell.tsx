"use client";

// Shared responsive ride-workspace skeleton (frontend-design.md §8, §13
// step 7.3). Role-agnostic: the passenger booking flow and the driver hub both
// slot into `children`, the map into `map`.
//
// Layout: desktop → left controls panel (min 20rem, max 26rem) beside a map
// that fills the majority width; mobile → map on top over a scrolling panel.
// Exactly the signed-in header height is reserved via --app-header-height, so
// the workspace fills the real viewport with no scroll of its own at 100dvh.
//
// MOBILE SPLIT RESIZER: on phones the map/panel boundary is draggable so the
// panel can grow upward (shrinking the map) instead of permanently losing half
// the screen. The map and the panel stay two siblings in ONE grid — the panel is
// never an overlay, so nothing is ever hidden underneath it, and
// `.workspace-panel` keeps its own `overflow-y: auto`, which makes dragging the
// divider and scrolling the panel two independent gestures. The grip is a real
// sibling row, so a drag that starts inside the panel or on the map can never
// be mistaken for a divider drag. Desktop keeps the two-column layout and the
// grip is `display: none` there, so nothing about it changes.
//
// Leaflet needs no new resize code: MapPane already owns a ResizeObserver →
// `map.invalidateSize()` on its container (map-pane.tsx), which fires whenever
// these two grid rows change size — including continuously during the snap
// animation.

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  DEFAULT_SPLIT,
  MAX_MAP_SHARE,
  MIN_MAP_SHARE,
  STOP_EXPANDED,
  STOP_HALF,
  firstStop,
  lastStop,
  mapShareFromPointer,
  mapShareToMapFr,
  nearestStop,
  splitPercentages,
  stepStop,
} from "./panel-split";

/**
 * A pointer that never travels this far is a tap, not a drag. Without the
 * slop, a shaky tap on the grip would jitter the split before it snapped back.
 */
const DRAG_SLOP_PX = 4;

type WorkspaceStyle = CSSProperties & Record<string, string>;

export function WorkspaceShell({
  map,
  children,
}: {
  map: ReactNode;
  children: ReactNode;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Deterministic default (the pre-resizer 50/50) so server and client render
  // identically — no hydration mismatch, no persisted state to reconcile.
  const [mapShare, setMapShare] = useState<number>(DEFAULT_SPLIT.mapShare);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    moved: boolean;
    startY: number;
  } | null>(null);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    if (Math.abs(event.clientY - drag.startY) > DRAG_SLOP_PX) drag.moved = true;

    const mapEl = mapRef.current;
    const panelEl = panelRef.current;
    if (!mapEl || !panelEl) return;
    const share = mapShareFromPointer({
      clientY: event.clientY,
      mapTop: mapEl.getBoundingClientRect().top,
      mapHeight: mapEl.offsetHeight,
      panelHeight: panelEl.offsetHeight,
    });
    if (share !== null) setMapShare(share);
  }, []);

  const finishDrag = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      setMapShare((share) => {
        // Release snaps to the nearest supported stop, so the user never has to
        // drag pixel-perfect. A tap with no travel is a deliberate, forgiving
        // shortcut: even ↔ expanded.
        if (drag.moved) return nearestStop(share).mapShare;
        return nearestStop(share).id === "half"
          ? STOP_EXPANDED.mapShare
          : STOP_HALF.mapShare;
      });
    },
    [handlePointerMove],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      dragRef.current = {
        pointerId: event.pointerId,
        moved: false,
        startY: event.clientY,
      };
      setResizing(true);
      window.addEventListener("pointermove", handlePointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", finishDrag);
      window.addEventListener("pointercancel", finishDrag);
    },
    [handlePointerMove, finishDrag],
  );

  // Keyboard equivalent of the drag, following the ARIA window-splitter
  // pattern: arrows step between snap points, Home/End jump to the extremes.
  // Focus is a real stop concern because the grip is a small target and touch
  // dragging is not available to every user.
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      let next;
      switch (event.key) {
        case "ArrowUp":
        case "ArrowLeft":
        case "PageUp":
          next = stepStop(mapShare, 1);
          break;
        case "ArrowDown":
        case "ArrowRight":
        case "PageDown":
          next = stepStop(mapShare, -1);
          break;
        case "Home":
          next = firstStop();
          break;
        case "End":
          next = lastStop();
          break;
        default:
          return;
      }
      event.preventDefault();
      setMapShare(next.mapShare);
    },
    [mapShare],
  );

  const percentages = splitPercentages(mapShare);
  const style: WorkspaceStyle = {
    "--workspace-map-rows": `${mapShareToMapFr(mapShare)}fr`,
    "--workspace-panel-rows": "1fr",
  };

  return (
    <main
      className={resizing ? "workspace workspace--resizing" : "workspace"}
      style={style}
    >
      <aside className="workspace-panel" ref={panelRef}>
        {children}
      </aside>
      <div className="workspace-map" ref={mapRef}>
        {map}
      </div>
      {/* The grip is a sibling of both regions, not an overlay, and stays out of
          the way on desktop via `display: none` in the ≥56rem media query. */}
      <div
        className="workspace-grip"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize map and panel"
        aria-valuemin={Math.round(MIN_MAP_SHARE * 100)}
        aria-valuemax={Math.round(MAX_MAP_SHARE * 100)}
        aria-valuenow={percentages.map}
        aria-valuetext={`Map ${percentages.map}%, panel ${percentages.panel}%`}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      />
    </main>
  );
}
