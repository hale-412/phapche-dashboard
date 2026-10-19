-- =====================================================================
-- 10. GỘP TOÀN BỘ THỦ TỤC DOANH NGHIỆP VỀ BẢNG licenses (2026-10-19)
--     Tab "Hồ sơ Giấy phép" đổi tên thành "Hồ sơ doanh nghiệp" và nhận
--     tất cả việc liên quan đến DN. Các văn bản trong bảng tasks có
--     loại việc "Doanh nghiệp" được CHUYỂN sang bảng licenses.
--     Tab "Văn bản / Công việc" vẫn hiện cả hai nguồn (gộp trên giao diện).
--     CHẠY ĐƯỢC NHIỀU LẦN — đã chống chuyển trùng bằng cột moved_task_id.
-- =====================================================================

-- 10.1 Các cột mới: hồ sơ DN nay mang đủ thông tin như một văn bản
alter table public.licenses add column if not exists doc_date      date;
alter table public.licenses add column if not exists content       text;
alter table public.licenses add column if not exists update_item   text;
alter table public.licenses add column if not exists priority      text not null default 'normal';
alter table public.licenses add column if not exists progress      int  not null default 0;
alter table public.licenses add column if not exists result        text;
alter table public.licenses add column if not exists moved_task_id bigint;  -- id văn bản gốc đã chuyển sang
create unique index if not exists licenses_moved_task_idx on public.licenses(moved_task_id) where moved_task_id is not null;

-- 10.2 Chuyển dữ liệu: tasks (loại việc Doanh nghiệp) → licenses
--      ĐẶT SAU phần tạo trigger ở mục 7 (trigger cũ sẽ chặn nếu chạy trước).
insert into public.licenses (
  file_number, company_name, tax_code, procedure, update_item,
  doc_date, received_date, deadline, handler1, handler2,
  status, content, priority, progress, note, result,
  created_by, created_at, moved_task_id)
select
  t.doc_number,
  coalesce(nullif(c.name, ''), nullif(t.sender, ''), 'Chưa rõ tên doanh nghiệp'),
  t.tax_code,
  case t.biz_type
    when 'Hồ sơ cấp mới'  then 'Cấp mới'
    when 'Hồ sơ cấp đổi'  then 'Cấp đổi'
    when 'Hồ sơ cấp lại'  then 'Cấp lại'
    when 'Hồ sơ điều chỉnh thông tin trên Giấy phép' then 'Điều chỉnh thông tin'
    when '' then 'Đề nghị khác'
    else coalesce(t.biz_type, 'Đề nghị khác')
  end,
  t.update_item,
  t.doc_date,
  coalesce(t.received_date, t.doc_date, current_date),
  t.deadline, t.handler1, t.handler2,
  case t.status
    when 'in_progress' then 'reviewing'
    when 'submit_dept' then 'submit_dept'
    when 'submit_cuc'  then 'submitted'
    when 'submit_bo'   then 'submit_bo'
    when 'done'        then 'issued'
    when 'cancelled'   then 'cancelled'
    else 'received'
  end,
  t.content, coalesce(t.priority, 'normal'), coalesce(t.progress, 0),
  t.progress_note, t.result, t.created_by, t.created_at, t.id
from public.tasks t
left join public.companies c on c.tax_code = t.tax_code
where t.category in ('Doanh nghiệp', 'Cập nhật thông tin doanh nghiệp')
  and not exists (select 1 from public.licenses l where l.moved_task_id = t.id);

-- 10.3 Chuyển luôn nhật ký của các văn bản đó sang nhật ký hồ sơ
insert into public.license_logs (license_id, user_id, action, detail, created_at)
select l.id, g.user_id, g.action, g.detail, g.created_at
from public.task_logs g
join public.licenses l on l.moved_task_id = g.task_id
where not exists (
  select 1 from public.license_logs x
  where x.license_id = l.id and x.created_at = g.created_at and x.detail is not distinct from g.detail);

-- 10.4 Xóa các văn bản đã chuyển khỏi bảng tasks (tránh hiện trùng)
delete from public.tasks t
where t.category in ('Doanh nghiệp', 'Cập nhật thông tin doanh nghiệp')
  and exists (select 1 from public.licenses l where l.moved_task_id = t.id);
