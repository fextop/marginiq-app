import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-signal-red/15 text-signal-red">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">Доступ обмежений</h1>
        <p className="mt-3 text-text-mute">
          На етапі MVP MarginIQ доступний лише власнику проекту. Якщо ви хочете спробувати продукт — напишіть на{" "}
          <a href="mailto:hello@marginiq.dev" className="text-accent hover:underline">
            hello@marginiq.dev
          </a>{" "}
          або зв'яжіться через{" "}
          <a href="https://t.me/fextop" className="text-accent hover:underline">
            Telegram
          </a>
          .
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="rounded-lg border border-border bg-bg-elevated px-5 py-2.5 text-sm font-semibold transition hover:border-accent/40"
          >
            Спробувати інший акаунт
          </Link>
          <a
            href="https://marginiq.dev"
            className="rounded-lg bg-gradient-accent px-5 py-2.5 text-sm font-semibold text-black shadow-lg shadow-accent/20 transition hover:-translate-y-0.5"
          >
            На головну
          </a>
        </div>
      </div>
    </div>
  );
}
