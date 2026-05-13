"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);

    const supabase = createClient();

    // Беремо `next` з URL якщо є — куди повернутись після логіну
    const nextParam =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("next") ?? "/dashboard"
        : "/dashboard";

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextParam)}`
        : undefined;

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
    }
    // Якщо все ок — Supabase сам зробить redirect на Google
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -right-40 -top-40 h-[600px] w-[600px] rounded-full opacity-30"
          style={{
            background:
              "radial-gradient(circle, rgba(0,217,163,0.4) 0%, transparent 60%)",
          }}
        />
        <div
          className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full opacity-25"
          style={{
            background:
              "radial-gradient(circle, rgba(0,184,230,0.4) 0%, transparent 60%)",
          }}
        />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-accent font-black text-black shadow-lg shadow-accent/30">
              M
            </div>
            <span className="text-2xl font-bold tracking-tight">MarginIQ</span>
          </div>
          <p className="mt-4 text-sm text-text-mute">
            Справжня маржа по кожному товару після реклами
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-bg-card p-8 shadow-2xl">
          <h1 className="text-xl font-bold">Вхід у дашборд</h1>
          <p className="mt-2 text-sm text-text-mute">
            Доступ обмежений. Якщо ви не власник проекту і хочете спробувати MarginIQ — напишіть на{" "}
            <a
              href="mailto:hello@marginiq.dev"
              className="text-accent hover:underline"
            >
              hello@marginiq.dev
            </a>
          </p>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-bg-elevated px-4 py-3 text-sm font-semibold transition hover:border-accent/40 hover:bg-bg-elevated/80 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"
                fill="#EA4335"
              />
            </svg>
            <span>
              {loading ? "Перенаправлення..." : "Увійти через Google"}
            </span>
          </button>

          {error && (
            <div className="mt-4 rounded-lg border border-signal-red/30 bg-signal-red/10 px-4 py-3 text-sm text-signal-red">
              {error}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-text-mute">
          ← <a href="https://marginiq.dev" className="hover:text-text">
            На головну
          </a>
        </p>
      </div>
    </div>
  );
}
