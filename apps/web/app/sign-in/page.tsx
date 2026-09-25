import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main>
      <h1>Sign in to Dhaka Tesla Pool</h1>
      <SignIn />
      <p>
        New here? <Link href="/sign-up">Create an account</Link>.
      </p>
    </main>
  );
}