import { SignIn } from "@clerk/nextjs";

// Catch-all path-routed sign-in (Clerk's documented App Router structure).
// `routing="path"` + `path` makes the component own every step of the flow
// under /sign-in on THIS origin; `signUpUrl` points the "create an account"
// link at our /sign-up instead of the accounts.dev instance URL;
// `fallbackRedirectUrl="/"` lands the user on the landing page, where the
// role is resolved from the API and the user is sent to their workspace.
// The cross-navigation links are Clerk-owned, so no manual <Link>s here.
export default function SignInPage() {
  return (
    <section className="auth-card">
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/"
      />
    </section>
  );
}