// Cấu hình kết nối Supabase
// Lấy tại: Supabase > Project Settings > API
//   - Project URL  -> SUPABASE_URL
//   - anon public  -> SUPABASE_ANON_KEY   (khóa công khai, an toàn để đưa lên GitHub vì đã có RLS)
window.APP_CONFIG = {
  SUPABASE_URL: "https://bzmhywghrcodnpgguqov.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Tn3uGzxYcS0bvbvPlmDroQ_53vzTPgg",
  DEPT_NAME: "Phòng Pháp chế - Kiểm tra",
  SOON_DAYS: 3, // số ngày trước hạn để cảnh báo "sắp đến hạn"
};

// Danh sách dùng cho module Hồ sơ Giấy phép (sửa tự do; value là mã lưu trong DB, không đổi sau khi đã có dữ liệu)
window.LICENSE_STATUSES = [
  { value: "received",   label: "Tiếp nhận",        cls: "new" },
  { value: "reviewing",  label: "Đang thẩm định",   cls: "in_progress" },
  { value: "supplement", label: "Yêu cầu bổ sung",  cls: "supplement" },
  { value: "submitted",  label: "Trình lãnh đạo",   cls: "in_progress" },
  { value: "issued",     label: "Đã cấp phép",      cls: "done",      final: true },
  { value: "rejected",   label: "Từ chối",          cls: "cancelled", final: true },
  { value: "withdrawn",  label: "Rút hồ sơ",        cls: "cancelled", final: true },
];
window.LICENSE_PROCEDURES = ["Cấp mới", "Cấp đổi", "Điều chỉnh thông tin", "Cấp lại", "Thu hồi"];

// Loại việc "Doanh nghiệp" trong mô-đun Văn bản / Công việc → danh sách hồ sơ con
window.BIZ_TASK_TYPES = [
  "Cập nhật thông tin DN",
  "Hồ sơ cấp mới",
  "Hồ sơ cấp đổi",
  "Hồ sơ cấp lại",
  "Hồ sơ điều chỉnh thông tin trên Giấy phép",
  "Nộp lại Giấy phép",
];

// Module Cập nhật thông tin doanh nghiệp
window.UPDATE_TYPES = [
  "Cập nhật danh sách nhân viên nghiệp vụ",
  "Cập nhật địa chỉ trụ sở chính hoặc chi nhánh",
  "Cập nhật thay đổi cơ sở đào tạo",
  "Thay đổi người đại diện theo pháp luật",
  "Cập nhật thông tin khác không liên quan đến điều kiện (số điện thoại, số căn cước, số fax, email…)",
];
window.UPDATE_STATUSES = [
  { value: "received",   label: "Tiếp nhận",        cls: "new" },
  { value: "processing", label: "Đang xử lý",       cls: "in_progress" },
  { value: "supplement", label: "Yêu cầu bổ sung",  cls: "supplement" },
  { value: "done",       label: "Đã cập nhật",      cls: "done",      final: true },
  { value: "rejected",   label: "Không chấp thuận", cls: "cancelled", final: true },
];

// Module Doanh nghiệp (hồ sơ / profile doanh nghiệp, nhập từ Excel)
window.COMPANY_STATUSES = [
  { value: "active", label: "Đang hoạt động",   cls: "done" },
  { value: "ended",  label: "Đã chấm dứt",      cls: "cancelled" }, // thu hồi / nộp lại giấy phép
];
// Trường dữ liệu doanh nghiệp + mẫu tiêu đề cột Excel để tự nhận diện khi nhập (regex, không phân biệt hoa thường)
window.COMPANY_FIELDS = [
  { key: "tax_code",             label: "Mã số doanh nghiệp",       match: /msdn|mã số/i },
  { key: "name",                 label: "Tên công ty",              match: /tên công ty|tên doanh nghiệp|^tên dn/i },
  { key: "short_name",           label: "Tên viết tắt",             match: /viết tắt/i },
  { key: "en_name",              label: "Tên tiếng Anh",            match: /tiếng anh/i },
  { key: "legal_rep",            label: "Người đại diện theo PL",   match: /đại diện/i },
  { key: "training_address",     label: "Địa chỉ CSVC đào tạo",       match: /địa chỉ.*(đào tạo|csđt|cơ sở vật chất)/i },
  { key: "address",              label: "Địa chỉ trụ sở chính",       match: /^địa chỉ/i },
  { key: "province",             label: "Tỉnh / Thành phố",         match: /tỉnh/i },
  { key: "website",              label: "Trang thông tin điện tử",  match: /trang thông tin|website|web/i },
  { key: "training_facility",    label: "Tên cơ sở đào tạo (CSĐT)", match: /csđt|cơ sở đào tạo/i },
  { key: "charter_capital",      label: "Vốn điều lệ (VNĐ)",       match: /vốn điều lệ|vốn/i, num: true },
  { key: "staff_list",           label: "Nhân viên nghiệp vụ",       match: /nhân viên nghiệp vụ|nv nghiệp vụ/i },
  { key: "deposit_amount",       label: "Số tiền ký quỹ (VNĐ)",    match: /(số tiền|mức).*ký quỹ|^ký quỹ$/i, num: true },
  { key: "deposit_bank",         label: "Ngân hàng nhận ký quỹ",   match: /ngân hàng/i },
  { key: "deposit_account",      label: "Số tài khoản ký quỹ",    match: /tài khoản/i },
  { key: "deposit_date",         label: "Ngày ký quỹ",             match: /ngày.*ký quỹ/i, date: true },
  { key: "deposit_ref",          label: "Giấy xác nhận ký quỹ",   match: /(giấy|số).*xác nhận.*ký quỹ|xác nhận ký quỹ/i },
  { key: "phone",                label: "Điện thoại",               match: /điện thoại|phone/i },
  { key: "fax",                  label: "Fax",                      match: /fax/i },
  { key: "email",                label: "Email",                    match: /mail/i },
  { key: "company_type",         label: "Loại hình (CTCP/TNHH)",    match: /ghi chú 2|loại hình/i },
  { key: "license_number",       label: "Số GP (hiện tại)",         match: /^số gp$/i },
  { key: "license_date",         label: "Ngày cấp GP lần đầu",      match: /ngày cấp gp lần đầu|^ngày cấp$/i, date: true },
  { key: "first_license_number", label: "Số GP lần đầu",            match: /số gp lần đầu/i },
  { key: "first_license_date",   label: "Ngày cấp lần đầu",         match: /^ngày cấp lần đầu/i, date: true },
  { key: "nd38_times",           label: "Lần cấp đổi theo NĐ 38",   match: /lần\s*cấp đổi/i },
  { key: "nd38_date",            label: "Ngày cấp đổi theo NĐ 38",  match: /ngày\s*cấp đổi/i, date: true },
  { key: "law69_number",         label: "Số GP (Luật 69)",          match: /số gp \(luật 69\)/i },
  { key: "law69_date",           label: "Ngày cấp GP theo Luật 69", match: /ngày cấp gp theo luật 69/i, date: true },
  { key: "adjust_times",         label: "Lần điều chỉnh thông tin", match: /lần điều chỉnh/i },
  { key: "adjust_date",          label: "Ngày điều chỉnh thông tin",match: /ngày điều chỉnh/i, date: true },
  { key: "ds101",                label: "DS 101",                   match: /ds ?101/i },
  { key: "note",                 label: "Ghi chú",                  match: /ghi chú 1|^ghi chú$/i },
  { key: "ended_year",           label: "Năm chấm dứt",             match: /năm chấm dứt/i },
  { key: "ended_type",           label: "Hình thức chấm dứt",       match: /nộp lại|thu hồi/i },
  { key: "ended_reason",         label: "Lý do chấm dứt",           match: /lý do/i },
  { key: "ended_ref",            label: "Văn bản chấm dứt",         match: /văn bản|công văn/i },
];
