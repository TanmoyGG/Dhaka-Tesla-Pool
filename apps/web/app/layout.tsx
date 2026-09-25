import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dhaka Tesla Pool",
  description: "Share a seat. Split the fare. Survive Dhaka traffic.",
};

// ClerkProvider wraps the app inside <body> (never wrapping <html> — Clerk's
// documented placement for the App Router). Authentication UI (sign-in,
// sign-up, user button) is entirely Clerk-managed.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}