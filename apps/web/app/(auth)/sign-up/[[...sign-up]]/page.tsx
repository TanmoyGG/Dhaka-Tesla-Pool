import { SignUp } from "@clerk/nextjs";

// Catch-all path-routed sign-up (see sign-in page for the routing rationale).
// `signInUrl` points the "already registered? sign in" link at our /sign-in,
// `fallbackRedirectUrl="/"` sends the new user to the landing page, where
// their role is resolved against the API before the workspace redirect.
export default function SignUpPage() {
  return (
    <section className="auth-card">
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/"
      />
    </section>
  );
}