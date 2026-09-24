-- Lịch gửi email nhắc việc: 7h30 sáng giờ Việt Nam (00:30 UTC), thứ 2 - thứ 6
-- Chạy trong SQL Editor SAU KHI đã deploy Edge Function daily-reminder.
-- Thay <PROJECT_REF> bằng mã dự án (thấy trong URL Supabase: https://<PROJECT_REF>.supabase.co)
-- Thay <ANON_KEY> bằng anon key (Settings > API)

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('daily-reminder') where exists
  (select 1 from cron.job where jobname = 'daily-reminder');

select cron.schedule(
  'daily-reminder',
  '30 0 * * 1-5',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Kiểm tra: select * from cron.job;
