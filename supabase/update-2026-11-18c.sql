-- =====================================================================
-- VA 3 LOI SUPABASE DATABASE LINTER (2026-11-18) — BAN CHAY DUOC AN TOAN
-- Chay 1 lan trong Supabase > SQL Editor. Chay lai nhieu lan van duoc.
--
-- Khac ban truoc: moi buoc nam trong khoi "do ... exception" rieng, nen
-- mot buoc loi KHONG lam huy cac buoc con lai (SQL Editor chay ca file
-- trong 1 giao dich — day la ly do ban truoc bi huy sach).
--
-- Xu ly:
--   1) rls_disabled_in_public    — public.company_adjustments chua bat RLS
--   2) sensitive_columns_exposed — cung nguyen nhan voi (1), cot license_number
--   3) security_definer_view     — view public.v_reminders doc bang quyen
--                                  nguoi tao view thay vi quyen nguoi doc
-- =====================================================================

-- ---------------------------------------------------------------
-- BUOC 1 + 2. Bat RLS va cap policy cho 6 bang con cua doanh nghiep
--   Quyen giong bang companies: ai dang nhap cung xem duoc,
--   chi Truong phong duoc them / sua / xoa.
--   Bang nao loi thi bao qua notice va lam tiep bang khac.
-- ---------------------------------------------------------------
do $do$
declare
  tb text;
  tbs text[] := array['company_reps','company_facilities','company_violations',
                      'company_inspections','company_adjustments','company_events'];
begin
  foreach tb in array tbs
  loop
    begin
      if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = tb) then
        raise notice 'Bo qua: chua co bang public.%', tb;
        continue;
      end if;
      execute format('alter table public.%I enable row level security', tb);
      execute format('drop policy if exists "%1$s_select" on public.%1$I', tb);
      execute format('create policy "%1$s_select" on public.%1$I for select to authenticated using (true)', tb);
      execute format('drop policy if exists "%1$s_insert" on public.%1$I', tb);
      execute format('create policy "%1$s_insert" on public.%1$I for insert to authenticated with check (public.is_lead())', tb);
      execute format('drop policy if exists "%1$s_update" on public.%1$I', tb);
      execute format('create policy "%1$s_update" on public.%1$I for update to authenticated using (public.is_lead())', tb);
      execute format('drop policy if exists "%1$s_delete" on public.%1$I', tb);
      execute format('create policy "%1$s_delete" on public.%1$I for delete to authenticated using (public.is_lead())', tb);
      raise notice 'OK: da bat RLS + 4 policy cho public.%', tb;
    exception when others then
      raise notice 'LOI o bang public.%: %', tb, sqlerrm;
    end;
  end loop;
end $do$;

-- ---------------------------------------------------------------
-- BUOC 3. Chan anon doc view nhac viec (chay duoc tren moi phien ban)
-- ---------------------------------------------------------------
do $do$
begin
  execute 'revoke all on public.v_reminders from anon';
  execute 'grant select on public.v_reminders to authenticated';
  raise notice 'OK: anon khong con doc duoc v_reminders';
exception when others then
  raise notice 'LOI khi thu hoi quyen anon: %', sqlerrm;
end $do$;

-- ---------------------------------------------------------------
-- BUOC 4. Bat security_invoker cho view (can Postgres >= 15)
--   Edge Function daily-reminder dung SERVICE_ROLE_KEY nen van doc du.
-- ---------------------------------------------------------------
do $do$
begin
  execute 'alter view public.v_reminders set (security_invoker = on)';
  raise notice 'OK: da bat security_invoker cho v_reminders';
exception when others then
  raise notice 'KHONG bat duoc security_invoker (%) — Postgres cu hon 15. Buoc 3 da chan anon nen du lieu khong lo ra.', sqlerrm;
end $do$;

-- ---------------------------------------------------------------
-- BUOC 5. BANG TONG KET — day la bang ket qua ban se nhin thay
-- ---------------------------------------------------------------
select 'Phien ban Postgres' as muc,
       current_setting('server_version') as ket_qua,
       '(>= 15 thi moi bat duoc security_invoker)' as mong_doi
union all
select 'Thuoc tinh view v_reminders',
       coalesce((select array_to_string(reloptions, ',') from pg_class where relname = 'v_reminders'), '(trong)'),
       'security_invoker=on'
union all
select 'anon doc duoc v_reminders?',
       coalesce((select has_table_privilege('anon', 'public.v_reminders', 'select')::text), '?'),
       'false'
union all
select 'Bang trong public con thieu RLS',
       coalesce((select string_agg(relname, ', ' order by relname) from pg_class
                  where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity),
                '(khong con bang nao)'),
       '(khong con bang nao)';
