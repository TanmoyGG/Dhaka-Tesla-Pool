import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { Providers } from "./providers";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dhaka Tesla Pool",
  description: "Share a seat. Split the fare. Survive Dhaka traffic.",
};

// ClerkProvider wraps the app inside <body> (never wrapping <html> — Clerk's
// documented placement for the App Router). Authentication UI (sign-in,
// sign-up, user button) is entirely Clerk-managed.
//
// The product is always dark (globals.css token set), so Clerk's hosted
// surfaces share the same look: `dark` baseTheme plus the app's tokens via
// variables/elements. Must stay in sync with globals.css --bg/--border/--text.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider
          appearance={{
            theme: dark,
            variables: {
              colorPrimary: "#2f81f7",
              colorBackground: "#161b22",
              colorForeground: "#e6edf3",
              colorMutedForeground: "#8b949e",
              colorInput: "#0d1117",
              colorInputForeground: "#e6edf3",
              colorPrimaryForeground: "#ffffff",
              colorDanger: "#da3633",
              borderRadius: "0.375rem",
              fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            },
            elements: {
              card: { boxShadow: "0 12px 40px rgba(0, 0, 0, 0.45)" },
              footerActionLink: { color: "#2f81f7" },
            },
          }}
        >
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}