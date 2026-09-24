-- =====================================================================
--  Dashboard Phòng Pháp chế - Kiểm tra
--  Chạy toàn bộ file này trong Supabase > SQL Editor (1 lần duy nhất)
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Hồ sơ chuyên viên (gắn với tài khoản đăng nhập auth.users)
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  email      text not null,
  role       text not null default 'staff' check (role in ('lead','staff')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Tự tạo hồ sơ khi có tài khoản mới
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'staff')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Hàm tiện ích: người đang đăng nhập có phải Trưởng phòng không?
create or replace function public.is_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'lead' from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------
-- 2. Văn bản đến / Công việc
-- ---------------------------------------------------------------
create table if not exists public.tasks (
  id            bigint generated always as identity primary key,
  doc_number    text,                         -- Số văn bản
  doc_date      date,                         -- Ngày văn bản
  received_date date default current_date,    -- Ngày đến
  sender        text,                         -- Cơ quan gửi
  category      text default 'Văn bản đến',   -- Loại việc
  tax_code      text,                         -- Mã số doanh nghiệp (khi loại việc thuộc nhóm Doanh nghiệp)
  biz_type      text,                         -- Nội dung hồ sơ / việc DN (khi loại việc = Doanh nghiệp)
  content       text not null,                -- Nội dung / trích yếu
  deadline      date,                         -- Thời hạn xử lý
  handler1      uuid references public.profiles(id), -- Phụ trách mức 1 (chính)
  handler2      uuid references public.profiles(id), -- Phụ trách mức 2 (phối hợp)
  status        text not null default 'new'
                check (status in ('new','in_progress','done','cancelled')),
  progress      int  not null default 0 check (progress between 0 and 100),
  progress_note text,                         -- Ghi chú tiến độ
  result        text,                         -- Kết quả xử lý / số VB đi
  priority      text not null default 'normal' check (priority in ('normal','urgent')),
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Nâng cấp DB đã tạo trước 2026-09-18 (an toàn khi chạy lại)
alter table public.tasks add column if not exists tax_code text;
alter table public.tasks add column if not exists biz_type text;
-- Quy loại việc cũ về nhóm "Doanh nghiệp" (an toàn khi chạy lại)
update public.tasks set category = 'Doanh nghiệp',
       biz_type = coalesce(biz_type, 'Cập nhật thông tin DN')
 where category = 'Cập nhật thông tin doanh nghiệp';

create index if not exists tasks_deadline_idx on public.tasks(deadline);
create index if not exists tasks_handler1_idx on public.tasks(handler1);
create index if not exists tasks_handler2_idx on public.tasks(handler2);
create index if not exists tasks_status_idx   on public.tasks(status);

-- ---------------------------------------------------------------
-- 3. Nhật ký thay đổi (giao việc, điều chuyển, cập nhật tiến độ)
-- ---------------------------------------------------------------
create table if not exists public.task_logs (
  id         bigint generated always as identity primary key,
  task_id    bigint not null references public.tasks(id) on delete cascade,
  user_id    uuid references public.profiles(id),
  action     text not null,   -- create | reassign | status | progress | edit | delete
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists task_logs_task_idx on public.task_logs(task_id);

-- ---------------------------------------------------------------
-- 4. Trigger: cập nhật updated_at, ghi log, chặn chuyên viên sửa
--    các trường chỉ Trưởng phòng được sửa
-- ---------------------------------------------------------------
create or replace function public.name_of(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select full_name from public.profiles where id = p), '—');
$$;

create or replace function public.tasks_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_at := now();
    return new;
  end if;

  new.updated_at := now();

  -- Chuyên viên (không phải Trưởng phòng) chỉ được sửa tiến độ/trạng thái/ghi chú/kết quả
  if not public.is_lead() then
    if new.doc_number    is distinct from old.doc_number
    or new.doc_date      is distinct from old.doc_date
    or new.received_date is distinct from old.received_date
    or new.sender        is distinct from old.sender
    or new.category      is distinct from old.category
    or new.tax_code      is distinct from old.tax_code
    or new.content       is distinct from old.content
    or new.deadline      is distinct from old.deadline
    or new.handler1      is distinct from old.handler1
    or new.handler2      is distinct from old.handler2
    or new.priority      is distinct from old.priority then
      raise exception 'Chỉ Trưởng phòng mới được sửa thông tin văn bản, thời hạn và người phụ trách';
    end if;
  end if;

  -- Tự động đồng bộ trạng thái với tiến độ
  if new.progress = 100 and new.status in ('new','in_progress') then
    new.status := 'done';
  elsif new.status = 'done' and new.progress < 100 then
    new.progress := 100;
  elsif new.progress > 0 and new.status = 'new' then
    new.status := 'in_progress';
  end if;
  return new;
end $$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

create or replace function public.tasks_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text;
begin
  if tg_op = 'INSERT' then
    insert into public.task_logs(task_id, user_id, action, detail)
    values (new.id, auth.uid(), 'create',
      format('Tạo việc. Phụ trách 1: %s; Phụ trách 2: %s; Hạn: %s',
        public.name_of(new.handler1), public.name_of(new.handler2), coalesce(new.deadline::text,'—')));
    return new;
  end if;

  if new.handler1 is distinct from old.handler1 or new.handler2 is distinct from old.handler2 then
    insert into public.task_logs(task_id, user_id, action, detail)
    values (new.id, auth.uid(), 'reassign',
      format('Điều chuyển: PT1 %s → %s; PT2 %s → %s',
        public.name_of(old.handler1), public.name_of(new.handler1),
        public.name_of(old.handler2), public.name_of(new.handler2)));
  end if;

  if new.status is distinct from old.status then
    insert into public.task_logs(task_id, user_id, action, detail)
    values (new.id, auth.uid(), 'status', format('Trạng thái: %s → %s', old.status, new.status));
  end if;

  if new.progress is distinct from old.progress or new.progress_note is distinct from old.progress_note then
    d := format('Tiến độ: %s%% → %s%%', old.progress, new.progress);
    if new.progress_note is distinct from old.progress_note and new.progress_note is not null then
      d := d || '. ' || new.progress_note;
    end if;
    insert into public.task_logs(task_id, user_id, action, detail)
    values (new.id, auth.uid(), 'progress', d);
  end if;

  if new.deadline is distinct from old.deadline then
    insert into public.task_logs(task_id, user_id, action, detail)
    values (new.id, auth.uid(), 'edit',
      format('Thời hạn: %s → %s', coalesce(old.deadline::text,'—'), coalesce(new.deadline::text,'—')));
  end if;
  return new;
end $$;

drop trigger if exists tasks_after_write on public.tasks;
create trigger tasks_after_write
  after insert or update on public.tasks
  for each row execute function public.tasks_after_write();

-- Chỉ Trưởng phòng được đổi vai trò / kích hoạt tài khoản
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Chạy từ SQL Editor / service_role (không có phiên đăng nhập) thì bỏ qua kiểm tra,
  -- để lần đầu cài đặt còn cấp được vai Trưởng phòng đầu tiên.
  if auth.uid() is null then return new; end if;
  if not public.is_lead() then
    if new.role is distinct from old.role or new.active is distinct from old.active then
      raise exception 'Chỉ Trưởng phòng mới được đổi vai trò';
    end if;
  end if;
  -- Không được hạ vai / cho nghỉ Trưởng phòng cuối cùng
  if old.role = 'lead' and old.active and (new.role <> 'lead' or not new.active) then
    if not exists (select 1 from public.profiles where role = 'lead' and active and id <> old.id) then
      raise exception 'Phải còn ít nhất 1 Trưởng phòng đang công tác. Hãy giao vai Trưởng phòng cho người khác trước.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------
alter table public.profiles  enable row level security;
alter table public.tasks     enable row level security;
alter table public.task_logs enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_lead());

drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select to authenticated using (true);

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated with check (public.is_lead());

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update to authenticated
  using (public.is_lead() or handler1 = auth.uid() or handler2 = auth.uid());

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks
  for delete to authenticated using (public.is_lead());

drop policy if exists "logs_select" on public.task_logs;
create policy "logs_select" on public.task_logs
  for select to authenticated using (true);

drop policy if exists "logs_insert" on public.task_logs;
create policy "logs_insert" on public.task_logs
  for insert to authenticated with check (true);

-- ---------------------------------------------------------------
-- 6. Realtime: bật phát sự kiện thay đổi cho bảng tasks
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;

-- ---------------------------------------------------------------
-- 7. Hồ sơ Giấy phép
-- ---------------------------------------------------------------
create table if not exists public.licenses (
  id             bigint generated always as identity primary key,
  file_number    text,                        -- Số hồ sơ / mã tiếp nhận
  company_name   text not null,               -- Tên doanh nghiệp
  tax_code       text,                        -- Mã số doanh nghiệp
  procedure      text not null default 'Cấp mới', -- Loại thủ tục
  received_date  date default current_date,   -- Ngày nhận hồ sơ
  deadline       date,                        -- Hạn trả kết quả
  handler1       uuid references public.profiles(id),
  handler2       uuid references public.profiles(id),
  status         text not null default 'received', -- Trạng thái (danh sách trong js/config.js)
  license_number text,                        -- Số giấy phép (khi đã cấp)
  issued_date    date,                        -- Ngày cấp
  note           text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists licenses_deadline_idx on public.licenses(deadline);
create index if not exists licenses_status_idx   on public.licenses(status);

create table if not exists public.license_logs (
  id         bigint generated always as identity primary key,
  license_id bigint not null references public.licenses(id) on delete cascade,
  user_id    uuid references public.profiles(id),
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists license_logs_idx on public.license_logs(license_id);

create or replace function public.licenses_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;
  -- Chuyên viên chỉ được cập nhật trạng thái, số GP, ngày cấp, ghi chú
  if not public.is_lead() then
    if new.file_number   is distinct from old.file_number
    or new.company_name  is distinct from old.company_name
    or new.tax_code      is distinct from old.tax_code
    or new.procedure     is distinct from old.procedure
    or new.received_date is distinct from old.received_date
    or new.deadline      is distinct from old.deadline
    or new.handler1      is distinct from old.handler1
    or new.handler2      is distinct from old.handler2 then
      raise exception 'Chỉ Trưởng phòng mới được sửa thông tin hồ sơ, thời hạn và người phụ trách';
    end if;
  end if;
  if new.status = 'issued' and new.issued_date is null then new.issued_date := current_date; end if;
  return new;
end $$;
drop trigger if exists licenses_before_write on public.licenses;
create trigger licenses_before_write before insert or update on public.licenses
  for each row execute function public.licenses_before_write();

create or replace function public.licenses_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.license_logs(license_id, user_id, action, detail)
    values (new.id, auth.uid(), 'create',
      format('Tiếp nhận hồ sơ %s. Phụ trách 1: %s; Phụ trách 2: %s; Hạn: %s',
        new.procedure, public.name_of(new.handler1), public.name_of(new.handler2), coalesce(new.deadline::text,'—')));
    return new;
  end if;
  if new.handler1 is distinct from old.handler1 or new.handler2 is distinct from old.handler2 then
    insert into public.license_logs(license_id, user_id, action, detail)
    values (new.id, auth.uid(), 'reassign',
      format('Điều chuyển: PT1 %s → %s; PT2 %s → %s',
        public.name_of(old.handler1), public.name_of(new.handler1),
        public.name_of(old.handler2), public.name_of(new.handler2)));
  end if;
  if new.status is distinct from old.status then
    insert into public.license_logs(license_id, user_id, action, detail)
    values (new.id, auth.uid(), 'status',
      format('Trạng thái: %s → %s%s', old.status, new.status,
        case when new.note is distinct from old.note and new.note is not null then '. ' || new.note else '' end));
  end if;
  if new.deadline is distinct from old.deadline then
    insert into public.license_logs(license_id, user_id, action, detail)
    values (new.id, auth.uid(), 'edit',
      format('Hạn trả kết quả: %s → %s', coalesce(old.deadline::text,'—'), coalesce(new.deadline::text,'—')));
  end if;
  return new;
end $$;
drop trigger if exists licenses_after_write on public.licenses;
create trigger licenses_after_write after insert or update on public.licenses
  for each row execute function public.licenses_after_write();

alter table public.licenses     enable row level security;
alter table public.license_logs enable row level security;

drop policy if exists "licenses_select" on public.licenses;
create policy "licenses_select" on public.licenses for select to authenticated using (true);
drop policy if exists "licenses_insert" on public.licenses;
create policy "licenses_insert" on public.licenses for insert to authenticated with check (public.is_lead());
drop policy if exists "licenses_update" on public.licenses;
create policy "licenses_update" on public.licenses for update to authenticated
  using (public.is_lead() or handler1 = auth.uid() or handler2 = auth.uid());
drop policy if exists "licenses_delete" on public.licenses;
create policy "licenses_delete" on public.licenses for delete to authenticated using (public.is_lead());
drop policy if exists "license_logs_select" on public.license_logs;
create policy "license_logs_select" on public.license_logs for select to authenticated using (true);
drop policy if exists "license_logs_insert" on public.license_logs;
create policy "license_logs_insert" on public.license_logs for insert to authenticated with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'licenses') then
    alter publication supabase_realtime add table public.licenses;
  end if;
end $$;

-- ---------------------------------------------------------------
-- 7b. Cập nhật thông tin doanh nghiệp (phân loại theo mã số DN)
-- ---------------------------------------------------------------
create table if not exists public.company_updates (
  id             bigint generated always as identity primary key,
  tax_code       text not null,               -- Mã số doanh nghiệp (khóa gộp nhóm)
  company_name   text not null,               -- Tên doanh nghiệp
  doc_number     text,                        -- Số văn bản đề nghị của DN
  doc_date       date,                        -- Ngày văn bản
  update_type    text not null,               -- Nội dung cập nhật (danh sách trong js/config.js: UPDATE_TYPES)
  content        text,                        -- Chi tiết nội dung cập nhật
  received_date  date default current_date,   -- Ngày nhận
  deadline       date,                        -- Hạn xử lý
  handler1       uuid references public.profiles(id),
  handler2       uuid references public.profiles(id),
  status         text not null default 'received', -- Trạng thái (js/config.js: UPDATE_STATUSES)
  result         text,                        -- Kết quả / số VB trả lời
  completed_date date,                        -- Ngày hoàn thành
  note           text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists company_updates_tax_code_idx on public.company_updates(tax_code);
create index if not exists company_updates_deadline_idx on public.company_updates(deadline);
create index if not exists company_updates_status_idx   on public.company_updates(status);

create table if not exists public.company_update_logs (
  id         bigint generated always as identity primary key,
  update_id  bigint not null references public.company_updates(id) on delete cascade,
  user_id    uuid references public.profiles(id),
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists company_update_logs_idx on public.company_update_logs(update_id);

create or replace function public.company_updates_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.tax_code := trim(new.tax_code);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;
  -- Chuyên viên chỉ được cập nhật trạng thái, kết quả, ngày hoàn thành, ghi chú
  if not public.is_lead() then
    if new.tax_code      is distinct from old.tax_code
    or new.company_name  is distinct from old.company_name
    or new.doc_number    is distinct from old.doc_number
    or new.doc_date      is distinct from old.doc_date
    or new.update_type   is distinct from old.update_type
    or new.content       is distinct from old.content
    or new.received_date is distinct from old.received_date
    or new.deadline      is distinct from old.deadline
    or new.handler1      is distinct from old.handler1
    or new.handler2      is distinct from old.handler2 then
      raise exception 'Chỉ Trưởng phòng mới được sửa thông tin yêu cầu, thời hạn và người phụ trách';
    end if;
  end if;
  if new.status = 'done' and new.completed_date is null then new.completed_date := current_date; end if;
  return new;
end $$;
drop trigger if exists company_updates_before_write on public.company_updates;
create trigger company_updates_before_write before insert or update on public.company_updates
  for each row execute function public.company_updates_before_write();

create or replace function public.company_updates_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.company_update_logs(update_id, user_id, action, detail)
    values (new.id, auth.uid(), 'create',
      format('Tiếp nhận yêu cầu: %s. Phụ trách 1: %s; Phụ trách 2: %s; Hạn: %s',
        new.update_type, public.name_of(new.handler1), public.name_of(new.handler2), coalesce(new.deadline::text,'—')));
    return new;
  end if;
  if new.handler1 is distinct from old.handler1 or new.handler2 is distinct from old.handler2 then
    insert into public.company_update_logs(update_id, user_id, action, detail)
    values (new.id, auth.uid(), 'reassign',
      format('Điều chuyển: PT1 %s → %s; PT2 %s → %s',
        public.name_of(old.handler1), public.name_of(new.handler1),
        public.name_of(old.handler2), public.name_of(new.handler2)));
  end if;
  if new.status is distinct from old.status then
    insert into public.company_update_logs(update_id, user_id, action, detail)
    values (new.id, auth.uid(), 'status',
      format('Trạng thái: %s → %s%s', old.status, new.status,
        case when new.note is distinct from old.note and new.note is not null then '. ' || new.note else '' end));
  end if;
  if new.deadline is distinct from old.deadline then
    insert into public.company_update_logs(update_id, user_id, action, detail)
    values (new.id, auth.uid(), 'edit',
      format('Hạn xử lý: %s → %s', coalesce(old.deadline::text,'—'), coalesce(new.deadline::text,'—')));
  end if;
  if new.update_type is distinct from old.update_type then
    insert into public.company_update_logs(update_id, user_id, action, detail)
    values (new.id, auth.uid(), 'edit', format('Nội dung cập nhật: %s → %s', old.update_type, new.update_type));
  end if;
  return new;
end $$;
drop trigger if exists company_updates_after_write on public.company_updates;
create trigger company_updates_after_write after insert or update on public.company_updates
  for each row execute function public.company_updates_after_write();

alter table public.company_updates     enable row level security;
alter table public.company_update_logs enable row level security;

drop policy if exists "company_updates_select" on public.company_updates;
create policy "company_updates_select" on public.company_updates for select to authenticated using (true);
drop policy if exists "company_updates_insert" on public.company_updates;
create policy "company_updates_insert" on public.company_updates for insert to authenticated with check (public.is_lead());
drop policy if exists "company_updates_update" on public.company_updates;
create policy "company_updates_update" on public.company_updates for update to authenticated
  using (public.is_lead() or handler1 = auth.uid() or handler2 = auth.uid());
drop policy if exists "company_updates_delete" on public.company_updates;
create policy "company_updates_delete" on public.company_updates for delete to authenticated using (public.is_lead());
drop policy if exists "company_update_logs_select" on public.company_update_logs;
create policy "company_update_logs_select" on public.company_update_logs for select to authenticated using (true);
drop policy if exists "company_update_logs_insert" on public.company_update_logs;
create policy "company_update_logs_insert" on public.company_update_logs for insert to authenticated with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'company_updates') then
    alter publication supabase_realtime add table public.company_updates;
  end if;
end $$;

-- ---------------------------------------------------------------
-- 7c. Doanh nghiệp (profile DN, nhập từ Excel "Danh sách DN có Giấy phép")
-- ---------------------------------------------------------------
create table if not exists public.companies (
  id                   bigint generated always as identity primary key,
  tax_code             text,                        -- Mã số doanh nghiệp (có thể trống với DN cũ)
  name                 text not null,               -- Tên công ty
  short_name           text,                        -- Tên viết tắt
  en_name              text,                        -- Tên tiếng Anh
  legal_rep            text,                        -- Người đại diện theo pháp luật
  company_type         text,                        -- CTCP / TNHH
  address              text,
  province             text,                        -- Tỉnh / Thành phố
  website              text,
  phone                text,
  fax                  text,
  email                text,
  training_facility    text,                        -- Tên cơ sở đào tạo (CSĐT) giáo dục định hướng
  training_address     text,                        -- Địa chỉ cơ sở vật chất đào tạo GDĐH
  charter_capital      bigint,                      -- Vốn điều lệ (VNĐ)
  deposit_amount       bigint,                      -- Số tiền ký quỹ (VNĐ)
  deposit_bank         text,                        -- Ngân hàng nhận ký quỹ (chi nhánh)
  deposit_account      text,                        -- Số tài khoản ký quỹ
  deposit_date         date,                        -- Ngày ký quỹ / ngày xác nhận
  deposit_ref          text,                        -- Số giấy xác nhận ký quỹ
  staff_list           text,                        -- Danh sách nhân viên nghiệp vụ (mỗi dòng 1 người)
  license_number       text,                        -- Số GP hiện tại
  license_date         date,                        -- Ngày cấp GP lần đầu
  first_license_number text,
  first_license_date   date,
  nd38_times           text,                        -- Lần cấp đổi theo NĐ 38
  nd38_date            date,
  law69_number         text,                        -- Số GP (Luật 69)
  law69_date           date,
  adjust_times         text,                        -- Lần điều chỉnh thông tin GP
  adjust_date          date,
  ds101                text,
  note                 text,
  status               text not null default 'active' check (status in ('active','ended')),
  ended_year           text,                        -- Năm chấm dứt (thu hồi / nộp lại)
  ended_type           text,                        -- Nộp lại / Thu hồi / Công bố GP hết hiệu lực
  ended_reason         text,
  ended_ref            text,                        -- Văn bản chấm dứt
  created_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- Nâng cấp DB đã tạo trước 2026-09-23 (an toàn khi chạy lại)
alter table public.companies add column if not exists training_address text;
alter table public.companies add column if not exists charter_capital  bigint;
alter table public.companies add column if not exists staff_list       text;
alter table public.companies add column if not exists deposit_amount   bigint;
alter table public.companies add column if not exists deposit_bank     text;
alter table public.companies add column if not exists deposit_account  text;
alter table public.companies add column if not exists deposit_date     date;
alter table public.companies add column if not exists deposit_ref      text;

create unique index if not exists companies_tax_code_uidx on public.companies(tax_code) where tax_code is not null;
create index if not exists companies_name_idx     on public.companies(lower(name));
create index if not exists companies_province_idx on public.companies(province);
create index if not exists companies_status_idx   on public.companies(status);

create or replace function public.companies_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.tax_code := nullif(trim(new.tax_code), '');
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;
drop trigger if exists companies_before_write on public.companies;
create trigger companies_before_write before insert or update on public.companies
  for each row execute function public.companies_before_write();

alter table public.companies enable row level security;
drop policy if exists "companies_select" on public.companies;
create policy "companies_select" on public.companies for select to authenticated using (true);
drop policy if exists "companies_insert" on public.companies;
create policy "companies_insert" on public.companies for insert to authenticated with check (public.is_lead());
drop policy if exists "companies_update" on public.companies;
create policy "companies_update" on public.companies for update to authenticated using (public.is_lead());
drop policy if exists "companies_delete" on public.companies;
create policy "companies_delete" on public.companies for delete to authenticated using (public.is_lead());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'companies') then
    alter publication supabase_realtime add table public.companies;
  end if;
end $$;

-- ---------------------------------------------------------------
-- 8. View nhắc việc (dùng cho Edge Function gửi email)
--    Gộp công việc, hồ sơ giấy phép và cập nhật thông tin DN
-- ---------------------------------------------------------------
drop view if exists public.v_reminders;
create view public.v_reminders as
select 'task' as kind, t.id, t.doc_number as ref, t.content as title, t.deadline, t.status,
       t.progress::text as progress,
       (t.deadline - current_date) as days_left,
       p1.full_name as handler1_name, p1.email as handler1_email,
       p2.full_name as handler2_name, p2.email as handler2_email
from public.tasks t
left join public.profiles p1 on p1.id = t.handler1
left join public.profiles p2 on p2.id = t.handler2
where t.status in ('new','in_progress')
  and t.deadline is not null and t.deadline <= current_date + 3
union all
select 'license', l.id, l.file_number, l.procedure || ' – ' || l.company_name, l.deadline, l.status,
       l.status,
       (l.deadline - current_date),
       p1.full_name, p1.email, p2.full_name, p2.email
from public.licenses l
left join public.profiles p1 on p1.id = l.handler1
left join public.profiles p2 on p2.id = l.handler2
where l.status not in ('issued','rejected','withdrawn')
  and l.deadline is not null and l.deadline <= current_date + 3
union all
select 'update', u.id, u.doc_number, u.company_name || ' – ' || u.update_type, u.deadline, u.status,
       u.status,
       (u.deadline - current_date),
       p1.full_name, p1.email, p2.full_name, p2.email
from public.company_updates u
left join public.profiles p1 on p1.id = u.handler1
left join public.profiles p2 on p2.id = u.handler2
where u.status not in ('done','rejected')
  and u.deadline is not null and u.deadline <= current_date + 3;

-- =====================================================================
-- SAU KHI CHẠY XONG:
--   Authentication > Users > Add user  -> tạo tài khoản Trưởng phòng
--   rồi chạy:  update public.profiles set role='lead' where email='EMAIL_TRUONG_PHONG';
-- =====================================================================
