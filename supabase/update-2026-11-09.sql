-- =====================================================================
-- 12. THÔNG BÁO KHI ĐƯỢC PHÂN / GIAO NHIỆM VỤ (2026-11-09)
--     Mỗi lần Trưởng phòng tạo việc mới hoặc điều chuyển người phụ trách,
--     hệ thống ghi một thông báo cho đúng tài khoản được giao. Thông báo
--     hiện ở chuông 🔔 trên thanh trên cùng (kèm số chưa đọc) và bật
--     thông báo của trình duyệt nếu người dùng cho phép.
--     Áp dụng cho cả 3 nguồn việc: tasks, licenses, company_updates.
--     CHẠY ĐƯỢC NHIỀU LẦN.
-- =====================================================================

-- 12.1 Bảng thông báo
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade, -- người nhận
  actor_id   uuid references public.profiles(id),                            -- người giao việc
  kind       text not null,            -- assign (giao mới) | reassign (điều chuyển sang)
  source     text not null,            -- task | license | update
  source_id  bigint,                   -- id của việc để bấm vào mở ra
  title      text not null,
  body       text,
  deadline   date,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(user_id) where read_at is null;

-- 12.2 Trigger dùng chung cho tasks / licenses / company_updates
--      Chỉ thông báo cho người MỚI được giao (người đã phụ trách từ trước
--      thì không bắn lại), và không tự thông báo cho chính người bấm lưu.
create or replace function public.notify_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r      jsonb := to_jsonb(new);
  src    text;
  bdy    text;
  olds   uuid[] := array[]::uuid[];
  hs     uuid[];
  h      uuid;
  lvl    int;
  actor  uuid := auth.uid();
begin
  src := case tg_table_name
           when 'tasks'           then 'task'
           when 'licenses'        then 'license'
           else 'update'
         end;

  -- Mô tả ngắn gọn việc được giao (mỗi bảng một cách gọi tên cột)
  if src = 'task' then
    bdy := concat_ws(' · ', nullif(new.doc_number, ''), nullif(new.sender, ''), new.content);
  elsif src = 'license' then
    bdy := concat_ws(' · ', nullif(new.file_number, ''), new.procedure, new.company_name);
  else
    bdy := concat_ws(' · ', nullif(new.doc_number, ''), new.company_name, new.update_type);
  end if;

  if tg_op = 'UPDATE' then
    olds := array[old.handler1, old.handler2];
    -- Không có thay đổi người phụ trách thì không làm gì
    if new.handler1 is not distinct from old.handler1
       and new.handler2 is not distinct from old.handler2 then
      return new;
    end if;
  end if;

  hs := array[new.handler1, new.handler2];
  for lvl in 1..2 loop
    h := hs[lvl];
    if h is null then continue; end if;
    if h = any(olds) then continue; end if;   -- đã phụ trách việc này từ trước
    if h = actor then continue; end if;       -- tự giao cho chính mình

    insert into public.notifications(user_id, actor_id, kind, source, source_id, title, body, deadline)
    values (
      h, actor,
      case when tg_op = 'INSERT' then 'assign' else 'reassign' end,
      src, new.id,
      case when tg_op = 'INSERT'
           then format('Bạn được giao %s mới (phụ trách mức %s)',
                       case src when 'license' then 'hồ sơ doanh nghiệp'
                                when 'update'  then 'yêu cầu cập nhật TTDN'
                                else 'văn bản / công việc' end, lvl)
           else format('Bạn được điều chuyển phụ trách %s (mức %s)',
                       case src when 'license' then 'hồ sơ doanh nghiệp'
                                when 'update'  then 'yêu cầu cập nhật TTDN'
                                else 'văn bản / công việc' end, lvl)
      end,
      bdy,
      new.deadline
    );
  end loop;
  return new;
end $$;

drop trigger if exists tasks_notify_assignment on public.tasks;
create trigger tasks_notify_assignment
  after insert or update of handler1, handler2 on public.tasks
  for each row execute function public.notify_assignment();

drop trigger if exists licenses_notify_assignment on public.licenses;
create trigger licenses_notify_assignment
  after insert or update of handler1, handler2 on public.licenses
  for each row execute function public.notify_assignment();

drop trigger if exists company_updates_notify_assignment on public.company_updates;
create trigger company_updates_notify_assignment
  after insert or update of handler1, handler2 on public.company_updates
  for each row execute function public.notify_assignment();

-- 12.3 RLS: mỗi người chỉ thấy và chỉ đánh dấu đã đọc thông báo của mình
alter table public.notifications enable row level security;

drop policy if exists "notifications_select" on public.notifications;
create policy "notifications_select" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notifications_delete" on public.notifications;
create policy "notifications_delete" on public.notifications
  for delete to authenticated using (user_id = auth.uid());

-- 12.4 Realtime: chuông sáng ngay khi được giao việc, không cần tải lại trang
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- 12.5 Dọn thông báo cũ (đã đọc và quá 90 ngày) — chạy tay khi cần
-- delete from public.notifications where read_at is not null and created_at < now() - interval '90 days';
