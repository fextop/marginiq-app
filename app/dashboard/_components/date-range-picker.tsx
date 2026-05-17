"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  /** Поточний обраний діапазон (з URL). */
  from: string | null;
  to: string | null;
  /** Повний діапазон наявних даних — для підказки та пресета «весь період». */
  fullStart: string | null; // YYYY-MM-DD
  fullEnd: string | null; // YYYY-MM-DD
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function DateRangePicker({ from, to, fullStart, fullEnd }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(from ?? fullStart ?? "");
  const [customTo, setCustomTo] = useState(to ?? fullEnd ?? "");

  function apply(nextFrom: string | null, nextTo: string | null) {
    const params = new URLSearchParams();
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  // Пресети рахуються від поточної дати.
  const now = new Date();
  const thisMonthStart = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const thisMonthEnd = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const lastMonthStart = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd = iso(new Date(now.getFullYear(), now.getMonth(), 0));

  const isAll = !from && !to;
  const isThisMonth = from === thisMonthStart && to === thisMonthEnd;
  const isLastMonth = from === lastMonthStart && to === lastMonthEnd;
  const isCustom = !isAll && !isThisMonth && !isLastMonth;

  const presets: { label: string; active: boolean; onClick: () => void }[] = [
    { label: "Весь період", active: isAll, onClick: () => apply(null, null) },
    {
      label: "Цей місяць",
      active: isThisMonth,
      onClick: () => apply(thisMonthStart, thisMonthEnd),
    },
    {
      label: "Минулий місяць",
      active: isLastMonth,
      onClick: () => apply(lastMonthStart, lastMonthEnd),
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          disabled={pending}
          onClick={p.onClick}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
            p.active
              ? "border-accent/50 bg-accent/10 text-text"
              : "border-border bg-bg-card text-text-mute hover:border-accent-alt/50 hover:text-text"
          }`}
        >
          {p.label}
        </button>
      ))}

      <button
        type="button"
        disabled={pending}
        onClick={() => setCustomOpen((v) => !v)}
        className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
          isCustom
            ? "border-accent/50 bg-accent/10 text-text"
            : "border-border bg-bg-card text-text-mute hover:border-accent-alt/50 hover:text-text"
        }`}
      >
        {isCustom && from && to
          ? `${from} … ${to}`
          : "Інший період"}
        <span className="ml-1.5 opacity-60">{customOpen ? "▴" : "▾"}</span>
      </button>

      {customOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2">
          <input
            type="date"
            value={customFrom}
            min={fullStart ?? undefined}
            max={fullEnd ?? undefined}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text [color-scheme:dark]"
          />
          <span className="text-text-mute">—</span>
          <input
            type="date"
            value={customTo}
            min={fullStart ?? undefined}
            max={fullEnd ?? undefined}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-text [color-scheme:dark]"
          />
          <button
            type="button"
            disabled={pending || !customFrom || !customTo}
            onClick={() => {
              if (customFrom && customTo) {
                const lo = customFrom <= customTo ? customFrom : customTo;
                const hi = customFrom <= customTo ? customTo : customFrom;
                apply(lo, hi);
                setCustomOpen(false);
              }
            }}
            className="rounded-md bg-accent px-3 py-1 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            Застосувати
          </button>
        </div>
      )}

      {pending && (
        <span className="text-xs text-text-mute">Оновлення…</span>
      )}
    </div>
  );
}
