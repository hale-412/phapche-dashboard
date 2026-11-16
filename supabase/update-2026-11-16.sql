-- =====================================================================
-- 13. NHẮC VIỆC TỒN MỘT LẦN (2026-11-16)
--     Trigger notify_assignment (mục 12) chỉ bắn thông báo từ lúc bật trở đi,
--     nên những việc đã giao từ trước đó không có thông báo nào. Chạy file này
--     MỘT LẦN để mỗi chuyên viên đăng nhập là thấy ngay những việc đang gấp
--     của mình: việc đang phụ trách, chưa kết thúc, đã quá hạn hoặc còn <= 3 ngày.
--     Thông báo tạo ra mang kind = 'reminder' (khác 'assign' của việc giao mới).
--     CHẠY LẠI NHIỀU LẦN KHÔNG TẠO TRÙNG (đã bỏ qua việc nào đã có thông báo).
-- =====================================================================

with src as (
  -- Văn bản / công việc đang mở (trạng thái kết thúc: done, cancelled — xem js/config.js)
  select 'task'::text as source, t.id as source_id, t.handler1, t.handler2, t.deadline,
         concat_ws(' · ', nullif(t.doc_number, ''), nullif(t.sender, ''), t.content) as body
  from public.tasks t
  where t.status not in ('done', 'cancelled')
    and t.deadline is not null
  union all
  -- Hồ sơ doanh nghiệp đang mở (kết thúc: issued, answered, rejected, withdrawn, cancelled)
  select 'license', l.id, l.handler1, l.handler2, l.deadline,
         concat_ws(' · ', nullif(l.file_number, ''), l.procedure, l.company_name)
  from public.licenses l
  where l.status not in ('issued', 'answered', 'rejected', 'withdrawn', 'cancelled')
    and l.deadline is not null
),
nguoi as (
  -- Việc có cả phụ trách mức 1 và mức 2 thì nhắc cho cả hai người
  select distinct s.source, s.source_id, s.deadline, s.body, h.user_id
  from src s
  cross join lateral (values (s.handler1), (s.handler2)) as h(user_id)
  where h.user_id is not null
    and s.deadline <= current_date + 3        -- 3 = SOON_DAYS trong js/config.js
)
insert into public.notifications (user_id, actor_id, kind, source, source_id, title, body, deadline)
select n.user_id, null, 'reminder', n.source, n.source_id,
       case when n.deadline < current_date
            then 'Việc bạn đang phụ trách đã quá hạn'
            else 'Việc bạn đang phụ trách sắp đến hạn' end,
       n.body, n.deadline
from nguoi n
join public.profiles p on p.id = n.user_id and p.active
where not exists (                            -- đã có thông báo cho đúng việc này rồi thì thôi
  select 1 from public.notifications x
  where x.user_id = n.user_id and x.source = n.source and x.source_id = n.source_id
);

-- Xem thử đã tạo cho ai, bao nhiêu việc:
-- select p.full_name, count(*) from public.notifications n
--   join public.profiles p on p.id = n.user_id
--  where n.kind = 'reminder' group by p.full_name order by 2 desc;

-- Lỡ tạo nhầm thì xóa hết thông báo nhắc việc tồn (không đụng tới thông báo giao việc):
-- delete from public.notifications where kind = 'reminder';
