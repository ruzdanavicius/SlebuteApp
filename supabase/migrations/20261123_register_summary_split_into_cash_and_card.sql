-- Applied to production 2026-11-23.
-- Cash/card totals now include each part of SPLIT sales (cash net of change, card amount).
-- split_total stays as an "of which split" figure; gross_total unchanged.
create or replace view public.register_summary with (security_invoker = on) as
 SELECT cr.id AS register_id, cr.location_id, cr.status, cr.opening_float, cr.opened_at, cr.closed_at,
    COALESCE(sum(o.cash_tendered - o.change_due) FILTER (WHERE o.status = 'COMPLETED'), 0::numeric) AS cash_total,
    COALESCE(sum(o.card_amount) FILTER (WHERE o.status = 'COMPLETED'), 0::numeric) AS card_total,
    COALESCE(sum(o.grand_total) FILTER (WHERE o.payment_method = 'SPLIT' AND o.status = 'COMPLETED'), 0::numeric) AS split_total,
    COALESCE(sum(o.grand_total) FILTER (WHERE o.status = 'COMPLETED'), 0::numeric) AS gross_total,
    count(o.id) FILTER (WHERE o.status = 'COMPLETED') AS order_count
   FROM cash_registers cr LEFT JOIN orders o ON o.register_id = cr.id
  GROUP BY cr.id;
