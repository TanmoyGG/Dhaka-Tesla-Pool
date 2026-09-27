"use client";

import { DriverHistorySection } from "@/components/driver/history-section";
import { RoleGate } from "@/components/role-gate";

// Driver trip history — reached from the header menu (docs/frontend-design.md
// §6.6 / §7). Same middleware protection as /driver (the /driver(.*) matcher);
// RoleGate keeps the passenger flow on /rides/history.
export default function DriverHistoryPage() {
  return (
    <RoleGate roles={["DRIVER"]} fallback="/rides">
      <main className="container">
        <h1 className="page-header">Trip history</h1>
        <DriverHistorySection />
      </main>
    </RoleGate>
  );
}