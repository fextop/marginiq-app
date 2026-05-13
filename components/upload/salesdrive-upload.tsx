"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ImportStats = {
  total_rows: number;
  skipped_test: number;
  skipped_no_id: number;
  skipped_no_product: number;
  unique_orders: number;
  item_rows: number;
  upserted_orders?: number;
  inserted_items?: number;
};

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "success"; stats: ImportStats; filename: string }
  | { kind: "error"; message: string };

export function SalesDriveUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);

  async function uploadFile(file: File) {
    setState({ kind: "uploading", filename: file.name });

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import/salesdrive", {
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

      setState({ kind: "success", stats: data.stats, filename: file.name });
      router.refresh(); // оновлюємо дашборд якщо там вже є дані
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
    e.target.value = ""; // дозволити вибір того ж файлу знову
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
          <h2 className="text-lg font-bold">Імпорт замовлень із SalesDrive</h2>
          <p className="mt-2 text-sm text-text-mute">
            Завантажте XLSX експорт замовлень із кабінету SalesDrive
            (Замовлення → Експорт). Дані запишуться в БД та підтягнуться у дашборд.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
            ? "border-accent bg-accent/5"
            : "border-border bg-bg-elevated hover:border-accent/40"
        } ${isBusy ? "pointer-events-none opacity-60" : ""}`}
      >
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-xl ${
            dragOver ? "bg-gradient-accent text-black" : "bg-bg-card text-text-mute"
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
              : "Перетягніть XLSX або клікніть для вибору"}
        </div>
        <div className="text-xs text-text-mute">
          .xlsx файл із SalesDrive, до 25 МБ
        </div>
      </div>

      {state.kind === "success" && (
        <SuccessReport stats={state.stats} filename={state.filename} />
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
}: {
  stats: ImportStats;
  filename: string;
}) {
  return (
    <div className="mt-5 rounded-lg border border-accent/30 bg-accent/5 p-4">
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
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 tabular-nums">
            <Stat label="Замовлень додано/оновлено" value={stats.upserted_orders ?? stats.unique_orders} />
            <Stat label="Позицій товарів" value={stats.inserted_items ?? stats.item_rows} />
            <Stat label="Усього рядків у файлі" value={stats.total_rows} />
            <Stat label="Пропущено (тестові)" value={stats.skipped_test} muted />
            <Stat label="Пропущено (без номера)" value={stats.skipped_no_id} muted />
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
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-xs ${muted ? "text-text-mute" : "text-text"}`}>{label}</span>
      <span className={`font-semibold ${muted ? "text-text-mute" : "text-text"}`}>
        {value.toLocaleString("uk-UA")}
      </span>
    </div>
  );
}
