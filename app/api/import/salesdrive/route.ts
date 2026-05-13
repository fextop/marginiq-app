import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowed-emails";
import { parseSalesDriveXlsx } from "@/lib/import/salesdrive";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/import/salesdrive
 *
 * Приймає XLSX експорт замовлень із SalesDrive.
 * Парсить, групує за external_id, UPSERT в orders + order_items.
 *
 * Авторизація: тільки залогінений email у whitelist.
 */
export async function POST(request: NextRequest) {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isEmailAllowed(user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Read file from FormData
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      { error: "Не вдалося прочитати multipart/form-data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Поле 'file' не знайдено в запиті" },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Файл порожній" }, { status: 400 });
  }

  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Файл занадто великий (макс 25 МБ)" },
      { status: 413 },
    );
  }

  // 3. Parse
  const admin = createAdminClient();
  const startedAt = new Date().toISOString();

  let logId: string | null = null;
  {
    const { data } = await admin
      .from("sync_logs")
      .insert({
        source: "salesdrive_xlsx",
        started_at: startedAt,
        status: "running",
        meta: { filename: file.name, size: file.size, uploader: user.email },
      })
      .select("id")
      .single();
    logId = data?.id ?? null;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const parsed = parseSalesDriveXlsx(arrayBuffer);

    if (parsed.orders.length === 0) {
      await admin
        .from("sync_logs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          rows_inserted: 0,
          meta: { ...parsed.stats, message: "Жодного валідного замовлення" },
        })
        .eq("id", logId!);

      return NextResponse.json({
        ok: true,
        stats: parsed.stats,
        message: "У файлі немає замовлень для імпорту",
      });
    }

    // 4. UPSERT orders. .select() повертає inserted/updated рядки з id.
    const ordersPayload = parsed.orders.map((o) => ({
      source: "salesdrive",
      external_id: o.external_id,
      external_order_no: o.external_order_no,
      status: o.status,
      status_group: o.status_group,
      revenue: o.revenue,
      cost_of_goods: o.cost_of_goods,
      acquiring_fee: o.acquiring_fee,
      delivery_cost: o.delivery_cost,
      discount: o.discount,
      utm_source: o.utm_source,
      utm_medium: o.utm_medium,
      utm_campaign: o.utm_campaign,
      utm_content: o.utm_content,
      utm_term: o.utm_term,
      gclid: o.gclid,
      referrer: o.referrer,
      created_at_external: o.created_at_external,
      raw_data: o.raw_data,
    }));

    const { data: upsertedOrders, error: upsertError } = await admin
      .from("orders")
      .upsert(ordersPayload, { onConflict: "source,external_id" })
      .select("id, external_id");

    if (upsertError) {
      throw new Error(`UPSERT orders failed: ${upsertError.message}`);
    }

    // 5. Build map external_id -> internal uuid
    const idMap = new Map<string, string>();
    for (const row of upsertedOrders ?? []) {
      idMap.set(row.external_id, row.id);
    }

    // 6. Видаляємо існуючі items для цих orders (на випадок повторного імпорту)
    const orderIds = Array.from(idMap.values());
    if (orderIds.length > 0) {
      await admin.from("order_items").delete().in("order_id", orderIds);
    }

    // 7. Insert order_items
    const itemsPayload = parsed.items
      .map((it) => {
        const orderId = idMap.get(it.external_order_id);
        if (!orderId) return null;
        return {
          order_id: orderId,
          sku: it.sku,
          product_name: it.product_name,
          qty: it.qty,
          unit_price: it.unit_price,
          unit_cost: it.unit_cost,
          line_total: it.line_total,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    let insertedItems = 0;
    if (itemsPayload.length > 0) {
      const { error: itemsError, count } = await admin
        .from("order_items")
        .insert(itemsPayload, { count: "exact" });

      if (itemsError) {
        throw new Error(`Insert order_items failed: ${itemsError.message}`);
      }
      insertedItems = count ?? itemsPayload.length;
    }

    // 8. Log success
    await admin
      .from("sync_logs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        rows_inserted: (upsertedOrders?.length ?? 0) + insertedItems,
        meta: { ...parsed.stats, orders: upsertedOrders?.length ?? 0, items: insertedItems },
      })
      .eq("id", logId!);

    return NextResponse.json({
      ok: true,
      stats: {
        ...parsed.stats,
        upserted_orders: upsertedOrders?.length ?? 0,
        inserted_items: insertedItems,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[import/salesdrive] error:", message);

    if (logId) {
      await admin
        .from("sync_logs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", logId);
    }

    return NextResponse.json(
      { error: "Помилка під час імпорту", details: message },
      { status: 500 },
    );
  }
}
