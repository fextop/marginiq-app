"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ImportStats = {
  total_rows: number;
  parsed_campaigns: number;
  skipped_summary_rows: number;
  total_spend: number;
  total_clicks: number;
  total_impressions: number;
  total_conversions: number;
  upserted_campaigns?: number;
};

type Period = { start: string | null; end: string | null };

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | {
      kind: "success";
      stats: ImportStats;
      filename: string;
      period: Period;
      currency: string | null;
    }
  | { kind: "error"; message: string };

export function GoogleAdsUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);

  async function uploadFile(file: File) {
    setState({ kind: "uploading", filename: file.name });

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import/google-ads", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setState({
          kind: "error",
          message: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }

      setState({
        kind: "success",
        stats: data.stats,
        filename: file.name,
        period: data.period ?? { start: null, end: null },
        currency: data.currency ?? null,
      });
      router.refresh();
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Мережева помилка",
      });
    }
  }

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  const isBusy = state.kind === "uploading";

  return (
    <div className="rounded-xl border border-border bg-bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">
            Імпорт Google Ads — звіт по кампаніях
          </h2>
          <p className="mt-2 text-sm text-text-mute">
            Завантажте CSV експорт звіту про кампанії з Google Ads
            (Campaigns → Download → CSV). Дані запишуться у{" "}
            <code className="text-text">ad_metrics</code> та підтягнуться у KPI дашборду.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleSelect}
        disabled={isBusy}
        className="hidden"
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!isBusy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !isBusy && inputRef.current?.click()}
        className={`mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
          dragOver
            ? "border-accent-alt bg-accent-alt/5"
            : "border-border bg-bg-elevated hover:border-accent-alt/40"
        } ${isBusy ? "pointer-events-none opacity-60" : ""}`}
      >
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-xl ${
            dragOver
              ? "bg-gradient-accent text-black"
              : "bg-bg-card text-text-mute"
          }`}
        >
          {isBusy ? (
            <svg className="animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          )}
        </div>
        <div className="text-sm font-semibold">
          {isBusy
            ? `Завантаження ${state.filename}…`
            : dragOver
              ? "Відпустіть файл тут"
              : "Перетягніть CSV або клікніть для вибору"}
        </div>
        <div className="text-xs text-text-mute">
          .csv звіт із Google Ads, до 10 МБ
        </div>
      </div>

      {state.kind === "success" && (
        <SuccessReport
          stats={state.stats}
          filename={state.filename}
          period={state.period}
          currency={state.currency}
        />
      )}

      {state.kind === "error" && (
        <div className="mt-5 rounded-lg border border-signal-red/30 bg-signal-red/10 p-4">
          <div className="flex items-start gap-3">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="mt-0.5 shrink-0 text-signal-red"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="text-sm">
              <div className="font-semibold text-signal-red">Помилка імпорту</div>
              <div className="mt-1 text-text-mute">{state.message}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SuccessReport({
  stats,
  filename,
  period,
  currency,
}: {
  stats: ImportStats;
  filename: string;
  period: Period;
  currency: string | null;
}) {
  const periodLabel =
    period.start && period.end
      ? `${formatDate(period.start)} — ${formatDate(period.end)}`
      : null;

  return (
    <div className="mt-5 rounded-lg border border-accent/30 bg-accent/5 p-5">
      <div className="flex items-start gap-3">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="mt-0.5 shrink-0 text-accent"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <div className="flex-1 text-sm">
          <div className="font-semibold text-accent">Імпорт успішний</div>
          <div className="mt-1 text-text-mute">{filename}</div>

          {periodLabel && (
            <div className="mt-1 text-xs text-text-mute">
              Період: {periodLabel} {currency ? `· ${currency}` : ""}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 tabular-nums">
            <Stat
              label="Кампаній імпортовано"
              value={String(stats.upserted_campaigns ?? stats.parsed_campaigns)}
            />
            <Stat
              label="Загальні витрати"
              value={
                formatNumber(stats.total_spend) + (currency ? " " + currencySymbol(currency) : "")
              }
            />
            <Stat label="Кліків" value={formatNumber(stats.total_clicks)} />
            <Stat label="Показів" value={formatNumber(stats.total_impressions)} />
            <Stat
              label="Конверсій (Google)"
              value={formatNumber(stats.total_conversions, 1)}
            />
            {stats.skipped_summary_rows > 0 && (
              <Stat
                label="Пропущено підсумкових"
                value={String(stats.skipped_summary_rows)}
                muted
              />
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-accent px-4 py-2 text-sm font-semibold text-black shadow-lg shadow-accent/20 transition hover:-translate-y-0.5"
            >
              Переглянути дашборд
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-xs ${muted ? "text-text-mute" : "text-text"}`}>{label}</span>
      <span className={`font-semibold ${muted ? "text-text-mute" : "text-text"}`}>{value}</span>
    </div>
  );
}

function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function currencySymbol(code: string): string {
  switch (code.toUpperCase()) {
    case "UAH":
      return "₴";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    default:
      return code;
  }
}
