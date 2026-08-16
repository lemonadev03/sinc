"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signupAction, type ActionState } from "../actions";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(signupAction, {});
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-12">
      <h1 className="text-2xl font-bold text-zinc-100">Create your account</h1>
      <p className="-mt-4 text-sm text-zinc-500">
        An app account comes first — provider connections are scoped to it.
      </p>
      <form action={formAction} className="card flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password (8+ characters)
          </label>
          <input className="input" id="password" name="password" type="password" minLength={8} required autoComplete="new-password" />
        </div>
        {state.error && <p className="text-sm text-red-400">{state.error}</p>}
        <button className="btn-primary w-full" type="submit" disabled={pending}>
          {pending ? "Creating account…" : "Sign up"}
        </button>
        <p className="text-center text-sm text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="text-violet-400 hover:text-violet-300">
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}
