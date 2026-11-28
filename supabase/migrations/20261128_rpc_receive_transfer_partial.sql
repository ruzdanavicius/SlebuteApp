-- Applied to production 2026-11-28.
-- Receive only what was physically scanned from an IN_TRANSIT store transfer.
-- p_received: [{"variant_id": 123, "quantity": 1}, ...] (units actually scanned).
-- Received units are credited exactly like rpc_update_stock_request_status
-- 'COMPLETED' (inventory + ARRIVAL log when the source is the virtual
-- incoming-goods store). Whatever was NOT scanned is split off into a new
-- IN_TRANSIT transfer (same source/target) so it stays visible: receive it
-- when it turns up, or cancel it (a real source store then gets it back).
create or replace function public.rpc_receive_transfer_partial(p_request_id bigint, p_received jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_req record; v_item record; v_role text; v_my_store bigint; v_active boolean;
  v_src_virtual boolean; v_src_code text; v_got int; v_missing int;
  v_new_id bigint; v_new_number text; v_units_in int := 0; v_units_missing int := 0;
begin
  select role, store_id, is_active into v_role, v_my_store, v_active from profiles where id = auth.uid();
  if auth.uid() is null or not coalesce(v_active, false) then raise exception 'Not authorized.'; end if;

  select * into v_req from stock_requests where id = p_request_id for update;
  if v_req.id is null then raise exception 'Request not found.'; end if;
  if v_req.request_type <> 'STORE_TRANSFER' or v_req.status <> 'IN_TRANSIT' then
    raise exception 'Only an in-transit store transfer can be received (% is %).', v_req.request_number, v_req.status;
  end if;
  if v_role is distinct from 'admin' and v_req.target_location_id is distinct from v_my_store then
    raise exception 'Only the receiving store can scan in %.', v_req.request_number;
  end if;
  if p_received is null or jsonb_typeof(p_received) <> 'array' then raise exception 'Nothing received.'; end if;
  if exists (select 1 from jsonb_array_elements(p_received) e where (e->>'quantity')::int < 0) then
    raise exception 'Quantity cannot be negative.';
  end if;

  select coalesce(is_virtual, false), code into v_src_virtual, v_src_code from stores where id = v_req.source_location_id;

  for v_item in select * from stock_request_items where request_id = p_request_id order by id loop
    select least(v_item.quantity, coalesce(sum((e->>'quantity')::int), 0))::int into v_got
      from jsonb_array_elements(p_received) e where (e->>'variant_id')::bigint = v_item.variant_id;
    v_missing := v_item.quantity - v_got;

    if v_got > 0 then
      insert into inventory (variant_id, location_id, quantity) values (v_item.variant_id, v_req.target_location_id, v_got)
        on conflict (variant_id, location_id) do update set quantity = inventory.quantity + v_got;
      if v_src_virtual then
        insert into stock_adjustments (variant_id, location_id, quantity_change, reason, notes, created_by)
          values (v_item.variant_id, v_req.target_location_id, v_got, 'ARRIVAL',
                  format('Priimta iš Atvykstančios prekės (%s)', v_req.request_number), auth.uid());
      end if;
      v_units_in := v_units_in + v_got;
    end if;

    if v_missing > 0 then
      if v_new_id is null then
        v_new_number := next_document_number(v_src_code, 'REQ');
        insert into stock_requests (request_number, request_type, source_location_id, target_location_id, status, notes, created_by)
          values (v_new_number, 'STORE_TRANSFER', v_req.source_location_id, v_req.target_location_id, 'IN_TRANSIT',
                  format('Negautos prekės iš %s — priimkite, kai atvyks, arba atšaukite.', v_req.request_number), auth.uid())
          returning id into v_new_id;
      end if;
      insert into stock_request_items (request_id, variant_id, quantity) values (v_new_id, v_item.variant_id, v_missing);
      if v_got > 0 then
        update stock_request_items set quantity = v_got where id = v_item.id;
      else
        delete from stock_request_items where id = v_item.id;
      end if;
      v_units_missing := v_units_missing + v_missing;
    end if;
  end loop;

  if v_units_in = 0 then raise exception 'No scanned items to receive for %.', v_req.request_number; end if;

  update stock_requests set status = 'COMPLETED', resolved_at = now(),
    notes = case when v_new_id is null then notes
                 else coalesce(notes || ' ', '') || format('[Priimta dalinai: negautos prekės perkeltos į %s]', v_new_number) end
    where id = p_request_id;

  return jsonb_build_object('request_id', p_request_id, 'units_received', v_units_in,
    'units_missing', v_units_missing, 'missing_request_id', v_new_id, 'missing_request_number', v_new_number);
end $$;
revoke all on function public.rpc_receive_transfer_partial(bigint, jsonb) from public, anon;
grant execute on function public.rpc_receive_transfer_partial(bigint, jsonb) to authenticated;
