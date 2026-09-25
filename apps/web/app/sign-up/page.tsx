import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main>
      <h1>Create your Dhaka Tesla Pool account</h1>
      <SignUp />
      <p>
        Already registered? <Link href="/sign-in">Sign in</Link>.
      </p>
    </main>
  );
}