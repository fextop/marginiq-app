-- ============================================================
-- Views для розрахунку чистої маржі.
-- На MVP — звичайні views (швидко змінювати). На Ступені 2 переведемо
-- у materialized views з refresh у cron.
-- ============================================================

-- ----------
-- v_orders_attributed: замовлення + кампанія, з якою воно прив'язане
-- ----------
create or replace view public.v_orders_attributed as
select
  o.id,
  o.source,
  o.external_id,
  o.external_order_no,
  o.status_group,
  o.created_at_external,
  o.revenue,
  o.cost_of_goods,
  o.acquiring_fee,
  o.delivery_cost,
  o.discount,
  o.utm_campaign,
  o.gclid,
  o.attributed_campaign_id,
  o.attributed_ad_group_id,
  o.attribution_method,
  -- чистий прибуток на рівні замовлення (БЕЗ урахування реклами — її прив'язуємо нижче)
  (o.revenue - o.cost_of_goods - o.acquiring_fee - o.delivery_cost - o.discount)
    as gross_margin
from public.orders o
where o.status_group = 'success';

-- ----------
-- v_campaign_daily: щоденна агрегація по кампанії
--   = виручка / витрата / чиста маржа з урахуванням ad spend
-- ----------
create or replace view public.v_campaign_daily as
with order_agg as (
  select
    date_trunc('day', o.created_at_external)::date as day,
    o.attributed_campaign_id as campaign_id,
    count(*) as orders_count,
    sum(o.revenue) as revenue,
    sum(o.cost_of_goods) as cost_of_goods,
    sum(o.acquiring_fee) as acquiring_fee,
    sum(o.gross_margin) as gross_margin
  from public.v_orders_attributed o
  where o.attributed_campaign_id is not null
  group by 1, 2
),
ad_agg as (
  select
    am.date as day,
    am.campaign_id,
    max(am.campaign_name) as campaign_name,
    sum(am.spend) as spend,
    sum(am.clicks) as clicks,
    sum(am.impressions) as impressions
  from public.ad_metrics am
  group by 1, 2
)
select
  coalesce(oa.day, aa.day) as day,
  coalesce(oa.campaign_id, aa.campaign_id) as campaign_id,
  aa.campaign_name,
  coalesce(aa.spend, 0) as ad_spend,
  coalesce(aa.clicks, 0) as clicks,
  coalesce(aa.impressions, 0) as impressions,
  coalesce(oa.orders_count, 0) as orders_count,
  coalesce(oa.revenue, 0) as revenue,
  coalesce(oa.cost_of_goods, 0) as cost_of_goods,
  coalesce(oa.acquiring_fee, 0) as acquiring_fee,
  coalesce(oa.gross_margin, 0) as gross_margin,
  -- чиста маржа з урахуванням рекламних витрат
  (coalesce(oa.gross_margin, 0) - coalesce(aa.spend, 0)) as net_margin,
  case
    when coalesce(oa.revenue, 0) > 0
    then ((coalesce(oa.gross_margin, 0) - coalesce(aa.spend, 0)) / oa.revenue * 100)
    else null
  end as net_margin_pct,
  case
    when coalesce(aa.spend, 0) > 0
    then (coalesce(oa.revenue, 0) / aa.spend)
    else null
  end as real_roas
from order_agg oa
full outer join ad_agg aa
  on oa.day = aa.day and oa.campaign_id = aa.campaign_id;

-- ----------
-- v_kpi_summary: загальна зведена картина для дашборда (останні 30 днів)
-- ----------
create or replace view public.v_kpi_summary as
select
  sum(revenue) as total_revenue,
  sum(ad_spend) as total_ad_spend,
  sum(gross_margin) as total_gross_margin,
  sum(net_margin) as total_net_margin,
  case
    when sum(revenue) > 0
    then sum(net_margin) / sum(revenue) * 100
    else null
  end as net_margin_pct,
  case
    when sum(ad_spend) > 0
    then sum(revenue) / sum(ad_spend)
    else null
  end as overall_real_roas,
  count(distinct case when net_margin < 0 then campaign_id end) as campaigns_in_loss
from public.v_campaign_daily
where day >= current_date - interval '30 days';

-- ----------
-- v_product_margin: маржа по SKU
-- ----------
create or replace view public.v_product_margin as
select
  oi.sku,
  oi.product_name,
  count(distinct oi.order_id) as orders_count,
  sum(oi.qty) as units_sold,
  sum(oi.line_total) as revenue,
  sum(oi.unit_cost * oi.qty) as cost_of_goods,
  sum(oi.line_total) - sum(oi.unit_cost * oi.qty) as gross_margin,
  case
    when sum(oi.line_total) > 0
    then (sum(oi.line_total) - sum(oi.unit_cost * oi.qty)) / sum(oi.line_total) * 100
    else null
  end as gross_margin_pct
from public.order_items oi
join public.orders o on o.id = oi.order_id
where o.status_group = 'success'
  and o.created_at_external >= current_date - interval '30 days'
group by oi.sku, oi.product_name;
