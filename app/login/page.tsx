import { LoginForm } from "./login-form";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Sign in · Logview",
  description: "Authenticate to use Logview",
};

export default function LoginPage() {
  return (
    <main className="main">
      <Suspense fallback={<p className="login-suspense">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
