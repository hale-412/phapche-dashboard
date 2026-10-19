-- =====================================================================
-- 11. NHẮC CẬP NHẬT PROFILE DOANH NGHIỆP SAU KHI HỒ SƠ HOÀN THÀNH
--     Khi hồ sơ DN chuyển sang "Đã cấp phép / Hoàn thành", app hỏi cần
--     cập nhật những phần nào của doanh nghiệp rồi lưu vào 2 cột dưới.
--     Lời nhắc hiện ở trang Tổng quan cho tới khi đánh dấu đã xong.
-- =====================================================================
alter table public.licenses add column if not exists profile_todo    text;         -- mỗi dòng 1 phần cần cập nhật
alter table public.licenses add column if not exists profile_note    text;         -- ghi chú cho người cập nhật
alter table public.licenses add column if not exists profile_done_at timestamptz;  -- đã cập nhật xong lúc nào
create index if not exists licenses_profile_todo_idx on public.licenses(profile_done_at) where profile_todo is not null;
