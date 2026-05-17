"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type Props = {
  /** Поточний обраний діапазон (з URL). */
  from: string | null;
  to: string | null;
  /** Повний діапазон наявних даних — для меж та підказки. */
  fullStart: string | null; // YYYY-MM-DD
  fullEnd: string | null; // YYYY-MM-DD
};

// Локальна дата у формат YYYY-MM-DD БЕЗ переведення в UTC.
// (toISOString() зсував би дату на день назад у часових поясах схід від UTC.)
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateRangePicker({ from, to, fullStart, fullEnd }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(from ?? fullStart ?? "");
  const [customTo, setCustomTo] = useState(to ?? fullEnd ?? "");

  // Синхронізація полів календаря з URL: після натискання пресета або
  // навігації поля показують актуальний період, а не застаріле значення.
  useEffect(() => {
    setCustomFrom(from ?? fullStart ?? "");
    setCustomTo(to ?? fullEnd ?? "");
  }, [from, to, fullStart, fullEnd]);

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

  // Пресет завжди закриває панель кастомного періоду.
  function selectPreset(f: string | null, t: string | null) {
    setCustomOpen(false);
    apply(f, t);
  }

  const presets: { label: string; active: boolean; onClick: () => void }[] = [
    { label: "Весь період", active: isAll, onClick: () => selectPreset(null, null) },
    {
      label: "Цей місяць",
      active: isThisMonth,
      onClick: () => selectPreset(thisMonthStart, thisMonthEnd),
    },
    {
      label: "Минулий місяць",
      active: isLastMonth,
      onClick: () => selectPreset(lastMonthStart, lastMonthEnd),
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
        {isCustom && from && to ? `${from} … ${to}` : "Інший період"}
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
                setCustomOpen(false);
                apply(lo, hi);
              }
            }}
            className="rounded-md bg-accent px-3 py-1 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            Застосувати
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setCustomOpen(false);
              apply(null, null);
            }}
            className="rounded-md border border-border px-3 py-1 text-sm font-medium text-text-mute transition hover:border-signal-red/50 hover:text-text disabled:opacity-50"
          >
            Скинути
          </button>
        </div>
      )}

      {pending && <span className="text-xs text-text-mute">Оновлення…</span>}
    </div>
  );
}
