"use server";

import * as XLSX from "xlsx";
import { createClient, createAdminClient } from "@/lib/supabase/server";

/* ───────────────────────── Результат ───────────────────────── */

export type ImportResult = {
  ok: boolean;
  message: string;
  stats?: Record<string, string | number>;
};

/* ───────────────────────── Хелпери ───────────────────────── */

// Парсинг числа з українського ("грн.18 999,00") та англ. форматів.
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[^\d,.-]/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", "."); // 18.999,00 -> 18999.00
  } else if (s.includes(",")) {
    s = s.replace(",", "."); // 2,47 -> 2.47
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

// Тільки цифри телефону — для ключа замовлення.
function phoneDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

// Дата комірки -> ISO рядок.
function toISO(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Статус SalesDrive -> група статусів для аналітики.
function statusGroup(status: string): string {
  const s = (status || "").trim().toLowerCase();
  if (s === "продажа") return "success";
  if (s === "отказ" || s === "возврат") return "cancelled";
  if (s === "дубль") return "duplicate";
  if (s.startsWith("admin")) return "test";
  return "pending"; // Подтверджен, Прибыл, Жду подтверждение, Предзаказ Китай…
}

// Перетворює аркуш у масив рядків (масив масивів).
function sheetRows(buf: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/* ─────────────────── №1: Замовлення SalesDrive (.xlsx) ─────────────────── */

// Жорсткі індекси колонок експорту SalesDrive (0-based) — підтверджено розвідкою.
const SD = {
  date: 0, // Дата створення
  phone: 3, // Телефон [Контакт]
  sum: 4, // Сума
  fee: 5, // Комісія (еквайринг, рівень замовлення)
  cost: 7, // Собівартість
  discount: 8, // Знижка
  status: 14, // Статус
  extNo: 19, // Зовнішній номер замовлення
  source: 29, // Источник
  utm: 31, // Кампания (utm_campaign)
  itemName: 33, // Назва [Товари/Послуги]
  itemSku: 36, // SKU [Товари/Послуги]
  itemPrice: 37, // Ціна за од. [Товари/Послуги]
  itemQty: 38, // К-ть [Товари/Послуги]
  itemTotal: 40, // Сума [Товари/Послуги]
  itemCost: 48, // Собівартість [Товари/Послуги]
};

export async function importSalesDriveOrders(
  formData: FormData,
): Promise<ImportResult> {
  const user = await requireUser();
  if (!user) return { ok: false, message: "Не авторизовано." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Файл не вибрано." };
  }

  let rows: unknown[][];
  try {
    rows = sheetRows(await file.arrayBuffer());
  } catch {
    return { ok: false, message: "Не вдалося прочитати XLSX-файл." };
  }
  if (rows.length < 2) {
    return { ok: false, message: "Файл порожній." };
  }

  // Sanity-check формату.
  const header = (rows[0] as unknown[]).map((c) => String(c ?? "").trim());
  if (!header[SD.date]?.toLowerCase().includes("дата")) {
    return {
      ok: false,
      message:
        "Несподіваний формат файлу — очікувався експорт замовлень SalesDrive.",
    };
  }

  // Групуємо рядки-позиції у замовлення за ключем (Дата створення + Телефон).
  type OrderAcc = {
    extId: string;
    createdAt: string | null;
    phone: string;
    revenue: number;
    fee: number;
    cost: number;
    discount: number;
    status: string;
    extNo: string | null;
    source: string | null;
    utm: string | null;
    items: {
      sku: string;
      name: string;
      qty: number;
      unitPrice: number;
      unitCost: number;
      lineTotal: number;
    }[];
  };

  const orders = new Map<string, OrderAcc>();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const iso = toISO(r[SD.date]);
    const phone = phoneDigits(r[SD.phone]);
    if (!iso && !phone) continue; // повністю порожній рядок

    const key = `${iso ?? "nodate"}|${phone || "nophone"}`;
    let o = orders.get(key);
    if (!o) {
      o = {
        extId: `sd-${(iso ?? "").replace(/[^\dZ]/g, "")}-${phone || "x"}`,
        createdAt: iso,
        phone,
        revenue: num(r[SD.sum]),
        fee: 0,
        cost: num(r[SD.cost]),
        discount: num(r[SD.discount]),
        status: String(r[SD.status] ?? "").trim(),
        extNo: String(r[SD.extNo] ?? "").trim() || null,
        source: String(r[SD.source] ?? "").trim() || null,
        utm: String(r[SD.utm] ?? "").trim() || null,
        items: [],
      };
      orders.set(key, o);
    }
    // Комісія/собівартість дублюються по рядках заказу — беремо максимум непорожнього.
    o.fee = Math.max(o.fee, num(r[SD.fee]));
    o.cost = Math.max(o.cost, num(r[SD.cost]));

    const sku = String(r[SD.itemSku] ?? "").trim();
    const name = String(r[SD.itemName] ?? "").trim();
    if (sku || name) {
      o.items.push({
        sku,
        name,
        qty: num(r[SD.itemQty]) || 1,
        unitPrice: num(r[SD.itemPrice]),
        unitCost: num(r[SD.itemCost]),
        lineTotal: num(r[SD.itemTotal]),
      });
    }
  }

  const orderList = [...orders.values()];
  if (orderList.length === 0) {
    return { ok: false, message: "У файлі не знайдено замовлень." };
  }

  // Діапазон дат файлу — для idempotent replace-by-range.
  const dates = orderList
    .map((o) => o.createdAt)
    .filter((d): d is string => !!d)
    .sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  const admin = createAdminClient();

  // Видаляємо замовлення SalesDrive у діапазоні дат файлу (order_items зникнуть каскадно).
  if (minDate && maxDate) {
    const { error: delErr } = await admin
      .from("orders")
      .delete()
      .eq("source", "salesdrive")
      .gte("created_at_external", minDate)
      .lte("created_at_external", maxDate);
    if (delErr) {
      return { ok: false, message: `Помилка очищення: ${delErr.message}` };
    }
  }

  // Вставляємо замовлення.
  const orderRows = orderList.map((o) => ({
    source: "salesdrive",
    external_id: o.extId,
    external_order_no: o.extNo,
    status: o.status,
    status_group: statusGroup(o.status),
    revenue: o.revenue,
    cost_of_goods: o.cost,
    acquiring_fee: o.fee,
    discount: o.discount,
    utm_source: o.source,
    utm_campaign: o.utm,
    created_at_external: o.createdAt,
  }));

  const { data: inserted, error: insErr } = await admin
    .from("orders")
    .insert(orderRows)
    .select("id, external_id");
  if (insErr || !inserted) {
    return {
      ok: false,
      message: `Помилка вставки замовлень: ${insErr?.message ?? "невідомо"}`,
    };
  }

  // Мапа external_id -> id для прив'язки позицій.
  const idByExt = new Map(inserted.map((r) => [r.external_id, r.id]));
  const itemRows: Record<string, unknown>[] = [];
  for (const o of orderList) {
    const orderId = idByExt.get(o.extId);
    if (!orderId) continue;
    for (const it of o.items) {
      itemRows.push({
        order_id: orderId,
        sku: it.sku || null,
        product_name: it.name || null,
        qty: it.qty,
        unit_price: it.unitPrice,
        unit_cost: it.unitCost,
        line_total: it.lineTotal,
      });
    }
  }

  if (itemRows.length > 0) {
    const { error: itemErr } = await admin.from("order_items").insert(itemRows);
    if (itemErr) {
      return {
        ok: false,
        message: `Замовлення збережено, але позиції — помилка: ${itemErr.message}`,
      };
    }
  }

  const feeTotal = orderList.reduce((s, o) => s + o.fee, 0);
  const successCount = orderList.filter(
    (o) => statusGroup(o.status) === "success",
  ).length;

  await admin.from("sync_logs").insert({
    source: "salesdrive_import",
    status: "success",
    rows_inserted: orderRows.length,
    finished_at: new Date().toISOString(),
    meta: { period: `${minDate?.slice(0, 10)} … ${maxDate?.slice(0, 10)}` },
  });

  return {
    ok: true,
    message: "Замовлення SalesDrive імпортовано.",
    stats: {
      "Замовлень": orderRows.length,
      "Позицій": itemRows.length,
      "Зі статусом «Продажа»": successCount,
      "Комісія еквайрингу, ₴": feeTotal.toFixed(2),
      "Період": `${minDate?.slice(0, 10)} … ${maxDate?.slice(0, 10)}`,
    },
  };
}

/* ─────────────────── №1: Google Ads — звіт про товари (.csv) ─────────────────── */

// Жорсткі індекси колонок звіту Google Ads (після 2 рядків преамбули).
const GA = {
  name: 1, // Название
  itemId: 3, // Идентификатор позиции
  status: 4, // Статус
  clicks: 6, // Клики
  impr: 7, // Показы
  currency: 9, // Код валюты
  spend: 11, // Расходы
  conv: 12, // Конверсии
  problems: 14, // Проблемы
  convValue: 15, // Ценность конв.
};

export async function importGoogleAdsProducts(
  formData: FormData,
): Promise<ImportResult> {
  const user = await requireUser();
  if (!user) return { ok: false, message: "Не авторизовано." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Файл не вибрано." };
  }

  // SheetJS читає CSV так само, як XLSX — з урахуванням лапок у назвах.
  let rows: unknown[][];
  try {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const wb = XLSX.read(text, { type: "string" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
      defval: "",
    });
  } catch {
    return { ok: false, message: "Не вдалося прочитати CSV-файл." };
  }

  // Преамбула: рядок 0 «Отчет о товаре», рядок 1 — період, рядок 2 — заголовки.
  let headerIdx = rows.findIndex(
    (r) =>
      Array.isArray(r) &&
      r.some((c) => String(c ?? "").includes("Идентификатор позиции")),
  );
  if (headerIdx < 0) {
    return {
      ok: false,
      message:
        "Несподіваний формат — очікувався звіт про товари Google Ads.",
    };
  }

  const dataRows = rows.slice(headerIdx + 1) as unknown[][];
  type AdRow = Record<string, unknown>;
  const adRows: AdRow[] = [];

  for (const r of dataRows) {
    const itemId = String(r[GA.itemId] ?? "").trim();
    if (!itemId) continue;
    const clicks = Math.round(num(r[GA.clicks]));
    const impressions = Math.round(num(r[GA.impr]));
    const spend = num(r[GA.spend]);
    // Беремо лише позиції з активністю — інакше 10 000+ нульових рядків.
    if (clicks === 0 && impressions === 0 && spend === 0) continue;
    adRows.push({
      source: "google_ads",
      date: new Date().toISOString().slice(0, 10),
      item_id: itemId,
      product_name: String(r[GA.name] ?? "").trim() || null,
      status: String(r[GA.status] ?? "").trim() || null,
      problems: String(r[GA.problems] ?? "").trim() || null,
      currency_code: String(r[GA.currency] ?? "").trim() || "UAH",
      impressions,
      clicks,
      spend,
      conversions: num(r[GA.conv]),
      conv_value: num(r[GA.convValue]),
    });
  }

  if (adRows.length === 0) {
    return { ok: false, message: "У файлі немає товарів з активністю." };
  }

  const admin = createAdminClient();

  // Місячний знімок — повністю замінюємо дані Google Ads.
  const { error: delErr } = await admin
    .from("ad_metrics_by_product")
    .delete()
    .eq("source", "google_ads");
  if (delErr) {
    return { ok: false, message: `Помилка очищення: ${delErr.message}` };
  }

  const { error: insErr } = await admin
    .from("ad_metrics_by_product")
    .insert(adRows);
  if (insErr) {
    return { ok: false, message: `Помилка вставки: ${insErr.message}` };
  }

  const spendTotal = adRows.reduce((s, r) => s + (r.spend as number), 0);
  const clicksTotal = adRows.reduce((s, r) => s + (r.clicks as number), 0);

  await admin.from("sync_logs").insert({
    source: "google_ads_import",
    status: "success",
    rows_inserted: adRows.length,
    finished_at: new Date().toISOString(),
  });

  return {
    ok: true,
    message: "Звіт про товари Google Ads імпортовано.",
    stats: {
      "Товарів з активністю": adRows.length,
      "Кліків": clicksTotal,
      "Витрати, ₴": spendTotal.toFixed(2),
    },
  };
}
