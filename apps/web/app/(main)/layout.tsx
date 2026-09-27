import { AppShell } from "@/components/app-shell";

// Main application shell (route group: URL prefixes unchanged). The product
// header/navigation wraps every regular page — the landing, the passenger
// workspace, and the driver workspace. Auth surfaces live in the separate
// `(auth)` group so they render WITHOUT the app navbar (see layout there).
export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppShell>{children}</AppShell>;
}