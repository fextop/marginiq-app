"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type UploadSummary = {
  rows_with_activity: number;
  total_rows: number;
  skipped_zero: number;
  period_start: string | null;
  period_end: string | null;
  total_spend?: number;
  total_clicks?: number;
  total_conversions?: number;
};

export function GoogleAdsProductsUpload() {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [_isPending, startTransition] = useTransition();

  async function upload(file: File) {
    setError(null);
    setSummary(null);
    setIsUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import/google-ads-products", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setSummary(data.summary);
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Очікується файл .csv");
      return;
    }
    upload(file);
  }

  return (
    <div className="rounded-xl border border-border bg-bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Google Ads — товарний звіт</h2>
          <p className="mt-1 text-sm text-text-mute">
            Завантажте CSV експорт <em>«Звіт о товаре»</em> з Google Ads
            (Reports → Predefined → Shopping → Products). Це дозволить
            рахувати чисту маржу на рівні кожного SKU.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-alt/15 px-2 py-0.5 text-xs font-medium text-accent-alt">
          Точна маржа SKU
        </span>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition ${
          dragOver
            ? "border-accent-alt bg-accent-alt/5"
            : "border-border hover:border-accent-alt/60 hover:bg-bg-elevated/50"
        } ${isUploading ? "pointer-events-none opacity-50" : ""}`}
      >
        <input
          type="file"
          accept=".csv"
          className="hidden"
          disabled={isUploading}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="mb-2 text-text-mute"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <div className="text-sm font-medium">
          {isUploading
            ? "Завантажуємо..."
            : "Перетягніть CSV або натисніть для вибору"}
        </div>
        <div className="mt-1 text-xs text-text-mute">
          Google Ads → Reports → Shopping → Products → Download CSV
        </div>
      </label>

      {error && (
        <div className="mt-4 rounded-lg border border-signal-red/30 bg-signal-red/5 p-3 text-sm text-signal-red">
          {error}
        </div>
      )}

      {summary && (
        <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm">
          <div className="font-semibold text-accent">
            ✓ Імпортовано {summary.rows_with_activity.toLocaleString("uk-UA")}{" "}
            товарів з активністю
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-mute md:grid-cols-3">
            {summary.period_start && summary.period_end && (
              <div>
                <span className="text-text-mute">Період:</span>{" "}
                <span className="text-text">
                  {formatDate(summary.period_start)} —{" "}
                  {formatDate(summary.period_end)}
                </span>
              </div>
            )}
            {summary.total_spend != null && (
              <div>
                <span className="text-text-mute">Витрата:</span>{" "}
                <span className="text-text">
                  {formatMoney(summary.total_spend)}
                </span>
              </div>
            )}
            {summary.total_clicks != null && (
              <div>
                <span className="text-text-mute">Кліки:</span>{" "}
                <span className="text-text">
                  {summary.total_clicks.toLocaleString("uk-UA")}
                </span>
              </div>
            )}
            {summary.total_conversions != null && (
              <div>
                <span className="text-text-mute">Конверсії Google:</span>{" "}
                <span className="text-text">
                  {summary.total_conversions.toFixed(1)}
                </span>
              </div>
            )}
            <div>
              <span className="text-text-mute">Усього рядків:</span>{" "}
              <span className="text-text">
                {summary.total_rows.toLocaleString("uk-UA")}
              </span>
            </div>
            <div>
              <span className="text-text-mute">Пропущено (0 активності):</span>{" "}
              <span className="text-text">
                {summary.skipped_zero.toLocaleString("uk-UA")}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: number): string {
  return (
    new Intl.NumberFormat("uk-UA", {
      maximumFractionDigits: 0,
    }).format(Math.round(value)) + " ₴"
  );
}
