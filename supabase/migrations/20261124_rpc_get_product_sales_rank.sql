-- Applied to production 2026-11-24.
-- Total units sold per product across all stores (completed sales, minus refunded units).
-- Used only to order the POS product grid best-sellers first; returns no prices or store detail.
create or replace function public.rpc_get_product_sales_rank()
returns table(product_id bigint, units_sold bigint)
language sql stable security definer set search_path to 'public'
as $$
  select pc.product_id, sum(greatest(oi.quantity - coalesce(oi.refunded_quantity, 0), 0))::bigint
  from order_items oi
  join orders o on o.id = oi.order_id and o.status = 'COMPLETED'
  join product_variants pv on pv.id = oi.variant_id
  join product_colors pc on pc.id = pv.color_id
  where auth.uid() is not null
  group by pc.product_id
  having sum(greatest(oi.quantity - coalesce(oi.refunded_quantity, 0), 0)) > 0;
$$;
revoke all on function public.rpc_get_product_sales_rank() from public, anon;
grant execute on function public.rpc_get_product_sales_rank() to authenticated;
