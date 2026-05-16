"use client";

import { useRef, useState, useTransition } from "react";
import {
  importSalesDriveOrders,
  importGoogleAdsProducts,
  type ImportResult,
} from "../actions";

type Action = (fd: FormData) => Promise<ImportResult>;

function ImportCard({
  title,
  desc,
  accept,
  hint,
  action,
}: {
  title: string;
  desc: string;
  accept: string;
  hint: string;
  action: Action;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, message: "Спершу оберіть файл." });
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await action(fd));
      } catch (e) {
        setResult({
          ok: false,
          message: e instanceof Error ? e.message : "Невідома помилка імпорту.",
        });
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-bg-card p-6">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-text-mute">{desc}</p>

      <label
        className="mt-5 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-bg px-4 py-3 transition hover:border-accent-alt"
      >
        <span className="truncate text-sm text-text-mute">
          {fileName ?? hint}
        </span>
        <span className="shrink-0 rounded-md border border-border px-3 py-1 text-xs font-medium text-text">
          Обрати файл
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            setFileName(e.target.files?.[0]?.name ?? null);
            setResult(null);
          }}
        />
      </label>

      <button
        onClick={run}
        disabled={pending}
        className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Імпортуємо…" : "Імпортувати"}
      </button>

      {result && (
        <div
          className={`mt-4 rounded-lg border p-4 text-sm ${
            result.ok
              ? "border-accent/40 bg-accent/5 text-text"
              : "border-signal-red/40 bg-signal-red/5 text-text"
          }`}
        >
          <div className="font-medium">
            {result.ok ? "✓ " : "✕ "}
            {result.message}
          </div>
          {result.stats && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {Object.entries(result.stats).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-text-mute">{k}</dt>
                  <dd className="font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

export function ImportView() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ImportCard
        title="Замовлення SalesDrive"
        desc="Експорт замовлень із CRM (.xlsx). Рядки групуються в замовлення, рахується комісія еквайрингу. Дані за період у файлі замінюються повністю."
        accept=".xlsx,.xls"
        hint="Оберіть XLSX-файл експорту замовлень"
        action={importSalesDriveOrders}
      />
      <ImportCard
        title="Google Ads — звіт про товари"
        desc="Звіт про товари (.csv) із Google Ads. Імпортуються лише позиції з активністю. Попередній знімок Google Ads замінюється повністю."
        accept=".csv"
        hint="Оберіть CSV-файл звіту про товари"
        action={importGoogleAdsProducts}
      />
    </div>
  );
}
