// Shared responsive ride-workspace skeleton (frontend-design.md §8, §13
// step 7.3). Role-agnostic and purely presentational: the passenger booking
// flow and (later) the driver hub both slot into `panel`, the map into `map`.
//
// Layout: desktop → left controls panel (min 20rem, max 26rem) beside a map
// that fills the majority width; mobile → map on top (~40vh, prominent), the
// panel below and scrolling. Exactly the signed-in header height is reserved
// via --app-header-height, so the workspace fills the real viewport with no
// scroll of its own at 100dvh.

import type { ReactNode } from "react";

export function WorkspaceShell({
  map,
  children,
}: {
  map: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="workspace">
      <aside className="workspace-panel">{children}</aside>
      <div className="workspace-map">{map}</div>
    </main>
  );
}