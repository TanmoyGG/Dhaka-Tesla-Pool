// Leaflet must be told when its container changes size, otherwise the map
// keeps rendering at its old dimensions — grey/blank bands, clipped tiles and
// zoom controls anchored to the wrong edges. This is the mechanism the mobile
// split resizer depends on: dragging the divider resizes the map's grid track,
// which must flow through to `invalidateSize()`.
//
// The assertion is deliberately structural (a ResizeObserver watches the rendered
// map container and its callback calls invalidateSize) rather than pixel-based:
// jsdom performs no layout, so real geometry cannot be checked here. What this
// locks in is that the wiring exists and points at the right node — the node
// whose CSS box is `height: 100%` of the resizable `.workspace-map` track.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import MapPane from "@/components/workspace/map-pane";

const leaflet = vi.hoisted(() => ({
  invalidateSize: vi.fn(),
  remove: vi.fn(),
  map: vi.fn(),
  tileLayer: vi.fn(),
}));

vi.mock("leaflet", () => {
  const instance = {
    invalidateSize: leaflet.invalidateSize,
    remove: leaflet.remove,
  };
  leaflet.map.mockReturnValue(instance);
  leaflet.tileLayer.mockReturnValue({ addTo: () => instance });
  return {
    default: {
      map: leaflet.map,
      tileLayer: leaflet.tileLayer,
      divIcon: () => ({}),
      marker: () => ({}),
      latLngBounds: () => ({}),
    },
  };
});

// The zones query only gates marker rendering; this suite is about resizing, so
// it stays in its loading state and no Leaflet marker code runs.
vi.mock("@/lib/queries", () => ({
  useZones: () => ({ data: undefined }),
}));

type ObserverCallback = () => void;

let observers: { callback: ObserverCallback; targets: Element[] }[] = [];

class FakeResizeObserver {
  callback: ObserverCallback;
  targets: Element[] = [];

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }

  observe(target: Element) {
    this.targets.push(target);
  }

  disconnect() {
    this.targets = [];
  }
}

beforeEach(() => {
  observers = [];
  leaflet.invalidateSize.mockClear();
  leaflet.remove.mockClear();
  leaflet.map.mockClear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

describe("MapPane resize handling", () => {
  it("watches its own container with a ResizeObserver", () => {
    const { container } = render(<MapPane />);

    expect(observers).toHaveLength(1);
    // The observed node must be the rendered map element — that is the node
    // whose height follows the resizable workspace track.
    expect(observers[0].targets).toEqual([container.firstChild]);
  });

  it("tells Leaflet to recalculate when the container resizes", () => {
    render(<MapPane />);
    expect(leaflet.invalidateSize).not.toHaveBeenCalled();

    // What the browser does when the map's grid track changes height.
    observers[0].callback();

    expect(leaflet.invalidateSize).toHaveBeenCalled();
  });

  it("stops observing and disposes the map on unmount", () => {
    const { unmount } = render(<MapPane />);
    const observer = observers[0];

    unmount();

    // disconnect() is what stops the browser from delivering further resize
    // notifications to a map that no longer exists.
    expect(observer.targets).toEqual([]);
    expect(leaflet.remove).toHaveBeenCalled();
  });
});
