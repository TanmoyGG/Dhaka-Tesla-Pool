import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { Providers } from "./providers";
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
              colorPrimary: "#b6f36b",
              colorBackground: "#101216",
              colorForeground: "#f6f7f9",
              colorMutedForeground: "#9aa3ae",
              colorInput: "#0a0b0d",
              colorInputForeground: "#f6f7f9",
              colorPrimaryForeground: "#0a0b0d",
              colorDanger: "#ff5f56",
              borderRadius: "0.5rem",
              fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            },
            elements: {
              card: { boxShadow: "0 12px 40px rgba(0, 0, 0, 0.45)" },
              footerActionLink: { color: "#b6f36b" },
            },
          }}
        >
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}