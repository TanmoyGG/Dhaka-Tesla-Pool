import Link from "next/link";

// Auth-only layout: one consistent, centered surface for the Clerk-hosted
// sign-in / sign-up flows. Deliberately NOT wrapped in the AppShell — the
// product navbar would duplicate the auth controls the Clerk card already
// owns (docs/frontend-design.md §4). The root layout still provides the
// ClerkProvider and the dark design tokens.
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="auth-center">
      <p className="auth-brand">
        Dhaka <span>Tesla</span> Pool
      </p>
      {children}
      <Link className="auth-back" href="/">
        Back to home
      </Link>
    </main>
  );
}