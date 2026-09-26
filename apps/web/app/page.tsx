import Link from "next/link";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

export default function HomePage() {
  return (
    <main>
      <h1>Dhaka Tesla Pool</h1>
      <p>Share a seat. Split the fare. Survive Dhaka traffic.</p>

      <nav aria-label="Account">
        <Show when="signed-out">
          <SignInButton />
          <SignUpButton />
        </Show>
        <Show when="signed-in">
          <Link href="/rides">Your rides</Link>
          <Link href="/account">Account</Link>
          <UserButton />
        </Show>
      </nav>

      <p>
        Authentication is managed by Clerk. Sign in or sign up to reach your
        account; the ride-pooling flows arrive in later phases.
      </p>
    </main>
  );
}