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

// Nhập từ Excel/CSV cho tab Văn bản / Công việc.
// conv: "date" ngày · "person" tên chuyên viên → tài khoản · "int" số · "status"/"priority"/"category" quy về mã lưu trong DB.
// THỨ TỰ QUAN TRỌNG: trường nào khớp trước thì chiếm cột đó (vd. "Nội dung hồ sơ DN" phải đứng trước "Nội dung").
window.TASK_FIELDS = [
  { key: "doc_number",    label: "Số văn bản",         match: /số vb|số văn bản|số đến/i },
  { key: "doc_date",      label: "Ngày văn bản",       match: /ngày vb|ngày văn bản|ngày ký/i, conv: "date" },
  { key: "received_date", label: "Ngày đến",           match: /ngày đến|ngày nhận|ngày tiếp nhận/i, conv: "date" },
  { key: "sender",        label: "Cơ quan gửi",        match: /cơ quan|nơi gửi|người gửi|đơn vị gửi/i },
  { key: "biz_type",      label: "Nội dung hồ sơ DN",  match: /nội dung hồ sơ|hồ sơ dn|loại hồ sơ/i },
  { key: "category",      label: "Loại việc",          match: /loại việc|loại công việc|loại vb/i, conv: "category" },
  { key: "tax_code",      label: "Mã số DN",           match: /mã số|msdn|mst/i },
  { key: "content",       label: "Nội dung / Trích yếu", match: /nội dung|trích yếu|tóm tắt/i },
  { key: "deadline",      label: "Thời hạn xử lý",     match: /thời hạn|hạn xử lý|hạn hoàn thành/i, conv: "date" },
  { key: "handler1",      label: "Phụ trách mức 1",    match: /phụ trách 1|phụ trách mức 1|chuyên viên chính/i, conv: "person" },
  { key: "handler2",      label: "Phụ trách mức 2",    match: /phụ trách 2|phụ trách mức 2|phối hợp/i, conv: "person" },
  { key: "status",        label: "Trạng thái",         match: /trạng thái|tình trạng/i, conv: "status" },
  { key: "progress_note", label: "Ghi chú tiến độ",    match: /ghi chú tiến độ|diễn biến/i },
  { key: "progress",      label: "Tiến độ %",          match: /tiến độ/i, conv: "int" },
  { key: "result",        label: "Kết quả xử lý",      match: /kết quả|số vb đi/i },
  { key: "priority",      label: "Mức độ",             match: /mức độ|ưu tiên|khẩn/i, conv: "priority" },
];

// Nhập từ Excel/CSV cho tab Hồ sơ Giấy phép
window.LICENSE_FIELDS = [
  { key: "file_number",    label: "Số hồ sơ",        match: /số hồ sơ|mã tiếp nhận|mã hồ sơ/i },
  { key: "company_name",   label: "Tên doanh nghiệp", match: /tên doanh nghiệp|tên công ty|^tên dn/i },
  { key: "tax_code",       label: "Mã số DN",        match: /mã số|msdn|mst/i },
  { key: "procedure",      label: "Thủ tục",         match: /thủ tục|loại hồ sơ/i },
  { key: "received_date",  label: "Ngày nhận",       match: /ngày nhận|ngày tiếp nhận|ngày đến/i, conv: "date" },
  { key: "deadline",       label: "Hạn trả KQ",      match: /hạn trả|thời hạn|hạn xử lý/i, conv: "date" },
  { key: "handler1",       label: "Phụ trách mức 1", match: /phụ trách 1|phụ trách mức 1/i, conv: "person" },
  { key: "handler2",       label: "Phụ trách mức 2", match: /phụ trách 2|phụ trách mức 2/i, conv: "person" },
  { key: "status",         label: "Trạng thái",      match: /trạng thái|tình trạng/i, conv: "lstatus" },
  { key: "license_number", label: "Số giấy phép",    match: /số giấy phép|^số gp/i },
  { key: "issued_date",    label: "Ngày cấp",        match: /ngày cấp/i, conv: "date" },
  { key: "note",           label: "Ghi chú",         match: /ghi chú/i },
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
  { key: "license_number",       label: "Số GP (hiện tại)",         match: /^số gp$|^số gp \(hiện tại\)$/i },
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
  { key: "ended_type",           label: "Hình thức chấm dứt",       match: /nộp lại|thu hồi|hình thức chấm dứt/i },
  { key: "ended_reason",         label: "Lý do chấm dứt",           match: /lý do/i },
  { key: "ended_ref",            label: "Văn bản chấm dứt",         match: /văn bản|công văn/i },
];
