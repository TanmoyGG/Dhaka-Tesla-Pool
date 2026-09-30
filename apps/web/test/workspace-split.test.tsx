// Mobile map/panel split resizer (frontend-design.md §8). The map and the panel
// are two tracks of ONE grid with a draggable grip between them, so the panel
// grows upward and the map shrinks instead of being covered — and the panel
// keeps its own independent scroll. Desktop hides the grip entirely.
//
// These tests cover the two halves of the mechanism separately: the pure snap
// geometry (panel-split.ts) and the shared WorkspaceShell interaction that
// turns pointer/keyboard input into a snap point.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  DEFAULT_SPLIT,
  MAX_MAP_SHARE,
  MIN_MAP_SHARE,
  SPLIT_STOPS,
  clampMapShare,
  mapFrToShare,
  mapShareFromPointer,
  mapShareToMapFr,
  nearestStop,
  splitPercentages,
  stepStop,
} from "@/components/workspace/panel-split";

describe("panel split geometry", () => {
  it("keeps 50/50 as the default so the pre-resizer layout is unchanged", () => {
    expect(DEFAULT_SPLIT.mapShare).toBe(0.5);
    expect(DEFAULT_SPLIT.id).toBe("half");
  });

  it("offers 50/50 plus two progressively larger panel stops", () => {
    expect(SPLIT_STOPS.map((stop) => stop.mapShare)).toEqual([0.5, 0.3, 0.2]);
    // The two non-default stops must actually hand the screen to the panel.
    for (const stop of SPLIT_STOPS.slice(1)) {
      expect(splitPercentages(stop.mapShare).panel).toBeGreaterThanOrEqual(70);
    }
    for (const stop of SPLIT_STOPS) {
      // The map must never disappear: every stop keeps real context.
      expect(stop.mapShare).toBeGreaterThanOrEqual(MIN_MAP_SHARE);
    }
  });

  it("converts a map share to an fr ratio the grid can use", () => {
    // panel pinned to 1fr, so mapFr = share / (1 - share)
    expect(mapShareToMapFr(0.5)).toBeCloseTo(1);
    expect(mapShareToMapFr(0.3)).toBeCloseTo(0.3 / 0.7);
    expect(mapShareToMapFr(0.2)).toBeCloseTo(0.25);
  });

  it("round-trips a share through the fr ratio", () => {
    for (const stop of SPLIT_STOPS) {
      expect(mapFrToShare(mapShareToMapFr(stop.mapShare))).toBeCloseTo(
        stop.mapShare,
      );
    }
  });

  it("clamps free dragging to usable extremes", () => {
    expect(clampMapShare(-1)).toBe(MIN_MAP_SHARE);
    expect(clampMapShare(0)).toBe(MIN_MAP_SHARE);
    expect(clampMapShare(2)).toBe(MAX_MAP_SHARE);
    expect(clampMapShare(Number.NaN)).toBe(DEFAULT_SPLIT.mapShare);
  });

  it("snaps a loose share to the nearest stop in both directions", () => {
    // Near 50% -> even, near 30% -> expanded, near 20% -> maximised.
    expect(nearestStop(0.52).id).toBe("half");
    expect(nearestStop(0.46).id).toBe("half");
    expect(nearestStop(0.34).id).toBe("expanded");
    expect(nearestStop(0.26).id).toBe("expanded");
    expect(nearestStop(0.19).id).toBe("large");
    // Clamped extremes still resolve to a real stop rather than sticking.
    expect(nearestStop(MIN_MAP_SHARE).id).toBe("large");
    expect(nearestStop(MAX_MAP_SHARE).id).toBe("half");
  });

  it("steps between stops for keyboard use without running off the ends", () => {
    expect(stepStop(0.5, 1).id).toBe("expanded");
    expect(stepStop(0.3, 1).id).toBe("large");
    expect(stepStop(0.2, 1).id).toBe("large");
    expect(stepStop(0.5, -1).id).toBe("half");
    expect(stepStop(0.5, -1).id).toBe("half");
  });

  it("derives the share from live map/panel boxes, not the padding box", () => {
    // 600px of combined map+panel height, divider 180px below the map top.
    expect(
      mapShareFromPointer({
        clientY: 180,
        mapTop: 0,
        mapHeight: 300,
        panelHeight: 300,
      }),
    ).toBeCloseTo(0.3);
    // A divider dragged above the map clamps instead of inverting.
    expect(
      mapShareFromPointer({
        clientY: -40,
        mapTop: 0,
        mapHeight: 300,
        panelHeight: 300,
      }),
    ).toBe(MIN_MAP_SHARE);
  });

  it("reports no share for unmeasurable geometry so the split holds still", () => {
    expect(
      mapShareFromPointer({
        clientY: 100,
        mapTop: 0,
        mapHeight: 0,
        panelHeight: 0,
      }),
    ).toBeNull();
  });
});

function renderWorkspace() {
  render(
    <WorkspaceShell map={<div data-testid="map" />}>
      <p>Panel content</p>
    </WorkspaceShell>,
  );
  const grip = screen.getByRole("separator", {
    name: /resize map and panel/i,
  });
  const shell = screen.getByRole("main");
  const mapEl = shell.querySelector<HTMLElement>(".workspace-map")!;
  const panelEl = shell.querySelector<HTMLElement>(".workspace-panel")!;
  return { grip, shell, mapEl, panelEl };
}

// jsdom does no layout, so the drag maths needs a believable box: 300px of map
// over 300px of panel, both starting at the top of the workspace.
function stubLayout(mapEl: HTMLElement, panelEl: HTMLElement) {
  Object.defineProperty(mapEl, "offsetHeight", {
    configurable: true,
    value: 300,
  });
  Object.defineProperty(panelEl, "offsetHeight", {
    configurable: true,
    value: 300,
  });
  mapEl.getBoundingClientRect = () =>
    ({ top: 0, height: 300, bottom: 300 } as DOMRect);
}

describe("WorkspaceShell split resizer", () => {
  it("starts at the 50/50 split and exposes it to assistive tech", () => {
    const { grip, shell } = renderWorkspace();

    expect(grip).toHaveAttribute("aria-orientation", "horizontal");
    expect(grip).toHaveAttribute("aria-valuenow", "50");
    expect(grip).toHaveAttribute("aria-valuetext", "Map 50%, panel 50%");
    expect(grip).toHaveAttribute("tabindex", "0");
    expect(shell.style.getPropertyValue("--workspace-map-rows")).toBe("1fr");
    expect(shell.style.getPropertyValue("--workspace-panel-rows")).toBe("1fr");
  });

  it("keeps map and panel as siblings in one grid, with the grip between them", () => {
    const { shell } = renderWorkspace();
    const regions = [...shell.children].map((child) => child.className);

    // An overlay sheet would cover the map; a sibling row can only shrink it.
    expect(regions).toEqual([
      "workspace-panel",
      "workspace-map",
      "workspace-grip",
    ]);
    expect(shell.className).toBe("workspace");
  });

  it("grows the panel when the grip is dragged upward and snaps on release", () => {
    const { grip, shell, mapEl, panelEl } = renderWorkspace();
    stubLayout(mapEl, panelEl);

    fireEvent.pointerDown(grip, { pointerId: 1, clientY: 300, button: 0 });
    expect(shell.className).toBe("workspace workspace--resizing");

    fireEvent.pointerMove(window, { pointerId: 1, clientY: 180 });
    expect(grip).toHaveAttribute("aria-valuenow", "30");

    fireEvent.pointerUp(window, { pointerId: 1, clientY: 180 });

    expect(shell.className).toBe("workspace");
    expect(grip).toHaveAttribute("aria-valuenow", "30");
    expect(grip).toHaveAttribute("aria-valuetext", "Map 30%, panel 70%");
    // Panel grew, map shrank: the fr ratio moves below 1fr.
    expect(shell.style.getPropertyValue("--workspace-map-rows")).toBe(
      `${0.3 / 0.7}fr`,
    );
    expect(shell.style.getPropertyValue("--workspace-panel-rows")).toBe("1fr");
  });

  it("snaps a loose release to the nearest stop rather than a raw value", () => {
    const { grip, mapEl, panelEl } = renderWorkspace();
    stubLayout(mapEl, panelEl);

    fireEvent.pointerDown(grip, { pointerId: 2, clientY: 300, button: 0 });
    // 210/600 = 35% — nearer the 30% stop than the 50% stop.
    fireEvent.pointerMove(window, { pointerId: 2, clientY: 210 });
    fireEvent.pointerUp(window, { pointerId: 2, clientY: 210 });

    expect(grip).toHaveAttribute("aria-valuenow", "30");
  });

  it("returns to 50/50 when the grip is dragged back down", () => {
    const { grip, shell, mapEl, panelEl } = renderWorkspace();
    stubLayout(mapEl, panelEl);

    fireEvent.pointerDown(grip, { pointerId: 3, clientY: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 3, clientY: 180 });
    fireEvent.pointerUp(window, { pointerId: 3, clientY: 180 });
    expect(grip).toHaveAttribute("aria-valuenow", "30");

    fireEvent.pointerDown(grip, { pointerId: 4, clientY: 180, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 4, clientY: 300 });
    fireEvent.pointerUp(window, { pointerId: 4, clientY: 300 });

    expect(grip).toHaveAttribute("aria-valuenow", "50");
    expect(grip).toHaveAttribute("aria-valuetext", "Map 50%, panel 50%");
    expect(shell.style.getPropertyValue("--workspace-map-rows")).toBe("1fr");
  });

  it("reaches the largest panel stop but never hides the map entirely", () => {
    const { grip, mapEl, panelEl } = renderWorkspace();
    stubLayout(mapEl, panelEl);

    fireEvent.pointerDown(grip, { pointerId: 5, clientY: 300, button: 0 });
    // Dragged far past the top of the screen.
    fireEvent.pointerMove(window, { pointerId: 5, clientY: -500 });
    fireEvent.pointerUp(window, { pointerId: 5, clientY: -500 });

    expect(grip).toHaveAttribute("aria-valuenow", "20");
    expect(splitPercentages(0.2).map).toBeGreaterThanOrEqual(
      Math.round(MIN_MAP_SHARE * 100),
    );
  });

  it("ignores drags that never left the grip and offers a tap shortcut", () => {
    const { grip, mapEl, panelEl } = renderWorkspace();
    stubLayout(mapEl, panelEl);

    // A plain tap toggles even <-> expanded, so the split is reachable without
    // a precise drag at all.
    fireEvent.pointerDown(grip, { pointerId: 6, clientY: 300, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 6, clientY: 300 });
    expect(grip).toHaveAttribute("aria-valuenow", "30");

    fireEvent.pointerDown(grip, { pointerId: 7, clientY: 180, button: 0 });
    fireEvent.pointerUp(window, { pointerId: 7, clientY: 180 });
    expect(grip).toHaveAttribute("aria-valuenow", "50");
  });

  it("ignores move/up from a different pointer so one finger owns the drag", () => {
    const { grip, shell, mapEl, panelEl } = renderWorkspace();
    stubLayout(mapEl, panelEl);

    fireEvent.pointerDown(grip, { pointerId: 8, clientY: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 99, clientY: 180 });
    expect(grip).toHaveAttribute("aria-valuenow", "50");

    fireEvent.pointerUp(window, { pointerId: 99, clientY: 180 });
    // A foreign pointer must not end the real drag either.
    expect(shell.className).toBe("workspace workspace--resizing");

    fireEvent.pointerUp(window, { pointerId: 8, clientY: 180 });
    expect(shell.className).toBe("workspace");
  });

  it("ignores a non-primary mouse button", () => {
    const { grip, mapEl, panelEl } = renderWorkspace();
    stubLayout(mapEl, panelEl);

    fireEvent.pointerDown(grip, {
      pointerId: 10,
      pointerType: "mouse",
      button: 2,
      clientY: 300,
    });
    fireEvent.pointerMove(window, { pointerId: 10, clientY: 180 });

    expect(grip).toHaveAttribute("aria-valuenow", "50");
  });

  it("supports touch drags", () => {
    const { grip, mapEl, panelEl } = renderWorkspace();
    stubLayout(mapEl, panelEl);

    fireEvent.pointerDown(grip, {
      pointerId: 11,
      pointerType: "touch",
      button: 0,
      clientY: 300,
    });
    fireEvent.pointerMove(window, { pointerId: 11, clientY: 120 });
    fireEvent.pointerUp(window, { pointerId: 11, clientY: 120 });

    expect(grip).toHaveAttribute("aria-valuenow", "20");
  });

  it("holds the split still when the layout cannot be measured", () => {
    const { grip } = renderWorkspace();

    // No stubbed geometry: jsdom reports zero heights, so the drag must not be
    // allowed to divide by zero and jump the panel somewhere arbitrary.
    fireEvent.pointerDown(grip, { pointerId: 12, clientY: 300, button: 0 });
    fireEvent.pointerMove(window, { pointerId: 12, clientY: 100 });

    expect(grip).toHaveAttribute("aria-valuenow", "50");
  });

  it("steps between stops with the keyboard", () => {
    const { grip, shell } = renderWorkspace();

    grip.focus();
    expect(grip).toHaveFocus();

    // ArrowUp moves the divider up: more panel.
    fireEvent.keyDown(grip, { key: "ArrowUp" });
    expect(grip).toHaveAttribute("aria-valuenow", "30");

    fireEvent.keyDown(grip, { key: "ArrowUp" });
    expect(grip).toHaveAttribute("aria-valuenow", "20");

    // ArrowDown moves it back toward more map.
    fireEvent.keyDown(grip, { key: "ArrowDown" });
    expect(grip).toHaveAttribute("aria-valuenow", "30");

    fireEvent.keyDown(grip, { key: "Home" });
    expect(grip).toHaveAttribute("aria-valuenow", "50");

    fireEvent.keyDown(grip, { key: "End" });
    expect(grip).toHaveAttribute("aria-valuenow", "20");

    expect(shell.style.getPropertyValue("--workspace-map-rows")).toBe(
      "0.25fr",
    );
  });

  it("leaves unrelated keys alone", () => {
    const { grip } = renderWorkspace();

    fireEvent.keyDown(grip, { key: "a" });
    fireEvent.keyDown(grip, { key: "Enter" });
    fireEvent.keyDown(grip, { key: "Tab" });

    expect(grip).toHaveAttribute("aria-valuenow", "50");
  });
});
