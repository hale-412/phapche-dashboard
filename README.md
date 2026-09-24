# Dashboard Phòng Pháp chế - Kiểm tra

Ứng dụng web quản lý văn bản đến & công việc của Phòng: số văn bản, ngày văn bản, nội dung,
thời hạn, tiến độ thực hiện, người phụ trách (mức 1 / mức 2), nhật ký điều chuyển và nhắc việc
khi đến hạn (trên dashboard + email hàng ngày).

**Kiến trúc:** giao diện tĩnh (HTML/CSS/JS) chạy trên **GitHub Pages**, dữ liệu và đăng nhập
dùng **Supabase** (miễn phí). Không cần server riêng.

```
index.html          Giao diện
css/style.css       Giao diện (sáng/tối tự động)
js/config.js        ⚠ Điền URL + anon key Supabase vào đây
js/app.js           Logic ứng dụng
supabase/schema.sql             Tạo bảng, phân quyền, trigger (chạy 1 lần)
supabase/functions/daily-reminder/  Edge Function gửi email nhắc việc
supabase/cron.sql               Lịch chạy email 7h30 sáng thứ 2-6
```

---

## Dùng thử ngay trên máy (không cần Supabase)

Mở `demo.html` — dữ liệu lưu trong trình duyệt của máy bạn (không chia sẻ với người khác, không có đăng nhập).
- `demo.html?sample=1` nạp dữ liệu mẫu để xem giao diện · `demo.html?reset=1` xóa hết · `demo.html?user=3` xem với vai người thứ 3 trong danh sách chuyên viên.
- Sau khi sửa `index.html`, chạy `build-demo.ps1` để sinh lại `demo.html`.

## Bước 1 – Tạo dự án Supabase (5 phút)

1. Vào <https://supabase.com> → **Start your project** → đăng ký (dùng GitHub hoặc email).
2. **New project**: đặt tên `phapche`, chọn **Region: Singapore**, đặt mật khẩu database (lưu lại).
3. Đợi ~1 phút cho dự án khởi tạo.
4. Menu trái **SQL Editor** → **New query** → dán toàn bộ nội dung file `supabase/schema.sql` → **Run**.
   Phải thấy `Success. No rows returned`.
5. Menu trái **Authentication → Providers → Email**: **tắt** *Confirm email* (để Trưởng phòng tạo tài
   khoản cho chuyên viên là dùng được ngay, không cần bấm link xác nhận). Bấm **Save**.
6. **Authentication → Users → Add user → Create new user**: nhập email + mật khẩu của Trưởng phòng,
   tick *Auto Confirm User*.
7. Quay lại **SQL Editor**, chạy:
   ```sql
   update public.profiles set role = 'lead', full_name = 'Họ tên Trưởng phòng'
   where email = 'email-truong-phong@...';
   ```
8. **Project Settings → API**: copy **Project URL** và **anon public** key.

## Bước 2 – Cấu hình ứng dụng

Mở `js/config.js`, điền:

```js
SUPABASE_URL: "https://xxxxxxxx.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```

> Anon key là khóa công khai, được phép đưa lên GitHub. Dữ liệu được bảo vệ bằng
> Row Level Security: chỉ người đã đăng nhập mới đọc được, chuyên viên chỉ sửa được tiến độ
> việc mình phụ trách, Trưởng phòng mới giao/điều chuyển việc.

## Bước 3 – Đưa lên GitHub Pages

1. Tạo repository mới trên GitHub (Public), ví dụ `phapche-dashboard`.
2. Trong thư mục này:
   ```powershell
   git init
   git add .
   git commit -m "Dashboard Phong Phap che"
   git branch -M main
   git remote add origin https://github.com/<tai-khoan>/phapche-dashboard.git
   git push -u origin main
   ```
3. Trên GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   Branch: `main` / `/ (root)` → **Save**.
4. Sau ~1 phút, trang chạy tại `https://<tai-khoan>.github.io/phapche-dashboard/`.
5. Supabase → **Authentication → URL Configuration**: đặt **Site URL** = địa chỉ trên và thêm vào
   **Redirect URLs** (cần cho chức năng *Quên mật khẩu*).

## Bước 4 – Thêm chuyên viên

Đăng nhập bằng tài khoản Trưởng phòng → tab **Chuyên viên → + Thêm chuyên viên** → nhập họ tên,
email, mật khẩu ban đầu. Chuyên viên đăng nhập rồi bấm 🔑 để tự đổi mật khẩu.

## Bước 5 (tùy chọn) – Email nhắc việc hàng ngày

Mỗi sáng 7h30 (thứ 2-6), mỗi chuyên viên nhận email liệt kê việc **quá hạn** và **sắp đến hạn
(≤3 ngày)** mình phụ trách; Trưởng phòng nhận bản tổng hợp toàn phòng.

1. Tạo tài khoản gửi email tại <https://resend.com> (miễn phí 3.000 email/tháng) → **API Keys → Create** → copy key `re_...`.
   - Muốn gửi từ email cơ quan: **Domains → Add domain** và cấu hình DNS theo hướng dẫn. Nếu chưa, dùng
     `onboarding@resend.dev` nhưng chỉ gửi được tới email đã đăng ký Resend (để thử nghiệm).
2. Cài Supabase CLI (một lần): `winget install Supabase.cli` hoặc `npm i -g supabase`.
3. Trong thư mục dự án:
   ```powershell
   supabase login
   supabase link --project-ref <PROJECT_REF>       # mã trong URL dự án
   supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="Phong Phap che <onboarding@resend.dev>" APP_URL=https://<tai-khoan>.github.io/phapche-dashboard/
   supabase functions deploy daily-reminder --no-verify-jwt
   ```
4. Thử ngay: mở `https://<PROJECT_REF>.supabase.co/functions/v1/daily-reminder` trên trình duyệt
   (hoặc **Edge Functions → daily-reminder → Invoke** trong Supabase). Kết quả JSON liệt kê email đã gửi.
5. Đặt lịch: mở `supabase/cron.sql`, thay `<PROJECT_REF>` và `<ANON_KEY>`, dán vào **SQL Editor → Run**.
   (Nếu báo thiếu extension: **Database → Extensions** bật `pg_cron` và `pg_net`.)

## Sử dụng

| Vai trò | Được làm |
|---|---|
| **Trưởng phòng** | Thêm/sửa/xóa văn bản, đặt thời hạn, giao & điều chuyển phụ trách mức 1 ↔ mức 2 (nút ⇅), quản lý chuyên viên |
| **Chuyên viên** | Xem toàn bộ, cập nhật tiến độ / trạng thái / ghi chú / kết quả của việc mình phụ trách (mức 1 hoặc mức 2) |

- **Tổng quan**: thẻ số liệu (bấm để lọc), việc cần chú ý, khối lượng việc theo chuyên viên, việc của tôi.
- **Văn bản / Công việc**: tìm kiếm, lọc theo trạng thái / chuyên viên / thời hạn, sắp xếp theo cột, xuất CSV mở bằng Excel.
- **Hồ sơ Giấy phép**: tiếp nhận hồ sơ (tên DN, mã số DN, số hồ sơ, loại thủ tục, hạn trả kết quả, phụ trách mức 1/2); trạng thái chọn từ danh sách
  *Tiếp nhận → Đang thẩm định → Yêu cầu bổ sung → Trình lãnh đạo → Đã cấp phép / Từ chối / Rút hồ sơ*; ghi số giấy phép & ngày cấp.
  Danh sách trạng thái và loại thủ tục sửa trong `js/config.js` (`LICENSE_STATUSES`, `LICENSE_PROCEDURES`).
  Hồ sơ quá hạn / sắp đến hạn cũng hiện trong *Việc cần chú ý* và email nhắc việc.
- *(2026-09-23)* Tab **Cập nhật thông tin DN** đã bỏ khỏi giao diện — nội dung này nhập ở **Văn bản / Công việc** (loại việc *Doanh nghiệp* → *Cập nhật thông tin DN*)
  hoặc sửa trực tiếp trong hồ sơ **Doanh nghiệp**. Bảng `company_updates` và dữ liệu cũ vẫn giữ nguyên, hiện ở phần lịch sử của từng DN.
- **Doanh nghiệp**: hồ sơ (profile) từng doanh nghiệp có giấy phép — mã số DN, tên, người ĐDPL, địa chỉ, tỉnh/TP, liên hệ, CSĐT, số GP & các lần cấp đổi / điều chỉnh,
  trạng thái *Đang hoạt động / Đã chấm dứt* (thu hồi, nộp lại). Lọc theo tỉnh, loại hình, trạng thái; xuất CSV.
  - **⬆ Nhập từ Excel** (Trưởng phòng): chọn file `.xlsx` → chọn sheet → hệ thống tự nhận diện cột theo tiêu đề (bảng khớp cột có thể sửa tay,
    cột không có tiêu đề được đoán theo nội dung) → xem trước → *Nhập dữ liệu*. Dòng trùng **mã số DN** (hoặc cùng tên + số GP) được **cập nhật**, còn lại thêm mới,
    nên có thể nhập lại file nhiều lần. Sheet "Thu hồi, Nộp lại GP" nhập với trạng thái *Đã chấm dứt*. Ngày dạng số Excel hay `dd/mm/yyyy` đều đọc được.
  - Mở một DN sẽ thấy hồ sơ giấy phép gắn với mã số đó (kèm các yêu cầu cập nhật TTDN cũ để tra cứu).
  - Tab Giấy phép và form Văn bản (loại việc *Doanh nghiệp*) tự điền tên DN khi gõ mã số đã có trong danh sách. Danh sách trường & mẫu tiêu đề nhận diện trong `js/config.js` (`COMPANY_FIELDS`).
- Bấm vào một dòng để xem chi tiết và **lịch sử thay đổi** (ai điều chuyển, khi nào, tiến độ từng bước).
- Màu cảnh báo: 🔴 quá hạn / đến hạn hôm nay, 🟡 còn ≤3 ngày. Số việc quá hạn hiện trên tiêu đề tab trình duyệt.
- Thông báo trình duyệt hiện khi mở app nếu bạn có việc quá hạn / sắp đến hạn (cho phép khi được hỏi).
- Dữ liệu cập nhật thời gian thực: người khác sửa là màn hình của bạn tự làm mới.

## Sao lưu

Supabase → **Database → Backups** (gói miễn phí lưu 7 ngày). Ngoài ra, tab Văn bản → **Xuất Excel (CSV)** với bộ lọc *Tất cả* để tải toàn bộ dữ liệu về máy định kỳ.
