// Che do dung thu tren may (khong can Supabase):
//  - Du lieu luu trong localStorage cua trinh duyet nay, khong chia se voi nguoi khac.
//  - demo.html            : dung thu, bat dau voi du lieu trong (1 tai khoan Truong phong)
//  - demo.html?sample=1   : nap 40 van ban + 14 chuyen vien mau de xem giao dien
//  - demo.html?reset=1    : xoa toan bo du lieu dung thu
//  - demo.html?user=N     : xem voi vai tro cua nguoi thu N trong danh sach chuyen vien
(() => {
  const KEY = "phapche_local_db";
  const params = new URLSearchParams(location.search);
  const uid = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
  const now = () => new Date().toISOString();

  function seedEmpty() {
    return {
      profiles: [{ id: uid(1), full_name: "Trưởng phòng", email: "truongphong@demo.local", role: "lead", active: true, created_at: now() }],
      tasks: [], task_logs: [], licenses: [], license_logs: [], company_updates: [], company_update_logs: [], companies: [],
    };
  }

  function seedSample() {
    const names = ["Nguyễn Văn An", "Trần Thị Bình", "Lê Văn Cường", "Phạm Thị Dung", "Hoàng Văn Em", "Vũ Thị Phương", "Đặng Văn Giang", "Bùi Thị Hoa", "Đỗ Văn Inh", "Ngô Thị Kim", "Dương Văn Long", "Lý Thị Mai", "Trịnh Văn Nam", "Phan Thị Oanh"];
    const profiles = names.map((n, i) => ({ id: uid(i + 1), full_name: n, email: `cv${i + 1}@so.gov.vn`, role: i === 0 ? "lead" : "staff", active: i !== 13, created_at: now() }));
    const d = (off) => { const x = new Date(); x.setDate(x.getDate() + off); return x.toISOString().slice(0, 10); };
    const tasks = [];
    for (let i = 0; i < 40; i++) {
      const off = (i % 9) - 4;
      tasks.push({ id: i + 1, doc_number: `${1200 + i}/UBND-NC`, doc_date: d(-10 - i), received_date: d(-9 - i), sender: ["UBND tỉnh", "Sở Tư pháp", "Bộ LĐTBXH", "Thanh tra tỉnh"][i % 4],
        category: ["Văn bản đến", "Thẩm định", "Góp ý dự thảo", "Kiểm tra"][i % 4], content: `Về việc xử lý hồ sơ số ${i + 1} theo đề nghị của đơn vị liên quan, rà soát và tham mưu lãnh đạo`,
        deadline: i % 7 === 6 ? null : d(off), handler1: uid((i % 13) + 1), handler2: i % 3 === 0 ? uid(((i + 5) % 13) + 1) : null,
        status: i % 5 === 4 ? "done" : i % 2 ? "in_progress" : "new", progress: i % 5 === 4 ? 100 : (i * 15) % 100, progress_note: i % 2 ? "Đã dự thảo" : null,
        result: null, priority: i % 8 === 0 ? "urgent" : "normal", created_by: uid(1), created_at: now(), updated_at: now() });
    }
    const companies = ["Công ty CP Nhân lực Việt Á", "Công ty TNHH Cung ứng lao động Hoàng Long", "Công ty CP XKLĐ Sao Việt", "Công ty TNHH Nhân lực Đại Dương", "Công ty CP Đầu tư và Nhân lực Thăng Long", "Công ty TNHH Việc làm Toàn cầu", "Công ty CP Nhân lực Quốc tế Bắc Á", "Công ty TNHH Phát triển nguồn nhân lực Miền Trung"];
    const procs = ["Cấp mới", "Cấp đổi", "Điều chỉnh thông tin", "Cấp lại", "Thu hồi"];
    const stats = ["received", "reviewing", "supplement", "submitted", "issued", "reviewing", "rejected", "received"];
    const licenses = companies.map((c, i) => ({
      id: i + 1, file_number: `HS${String(101 + i)}/2026`, company_name: c, tax_code: `01${String(10000000 + i * 7919)}`, procedure: procs[i % 5],
      received_date: d(-20 + i), deadline: d((i % 6) - 3), handler1: uid((i % 13) + 2), handler2: i % 2 ? uid(((i + 4) % 13) + 1) : null,
      status: stats[i], license_number: stats[i] === "issued" ? `${300 + i}/LĐTBXH-GP` : null, issued_date: stats[i] === "issued" ? d(-1) : null,
      note: stats[i] === "supplement" ? "Thiếu xác nhận ký quỹ ngân hàng" : null, created_by: uid(1), created_at: now(), updated_at: now(),
    }));
    const utypes = window.UPDATE_TYPES || ["Cập nhật danh sách nhân viên nghiệp vụ"];
    const ustats = ["received", "processing", "supplement", "done", "processing", "done", "received", "rejected", "processing", "done"];
    const company_updates = Array.from({ length: 10 }, (_, i) => {
      const c = i % 5; // 5 doanh nghiệp, mỗi DN 2 lần cập nhật → thấy được gộp nhóm
      return { id: i + 1, tax_code: `01${String(10000000 + c * 7919)}`, company_name: companies[c], doc_number: `${20 + i}/CV-${["VA", "HL", "SV", "DD", "TL"][c]}`, doc_date: d(-15 + i),
        update_type: utypes[i % utypes.length], content: ["Bổ sung 02 nhân viên nghiệp vụ", "Đổi địa chỉ trụ sở sang số 15 Lê Lợi", "Thay cơ sở đào tạo mới tại KCN", "Người ĐDPL mới: Nguyễn Văn B", "Đổi số điện thoại, email liên hệ"][i % 5],
        received_date: d(-14 + i), deadline: d((i % 6) - 2), handler1: uid((i % 13) + 2), handler2: i % 3 === 0 ? uid(((i + 6) % 13) + 1) : null,
        status: ustats[i], result: ustats[i] === "done" ? `${500 + i}/SLĐTBXH-PC` : null, completed_date: ustats[i] === "done" ? d(-1) : null,
        note: ustats[i] === "supplement" ? "Thiếu bản sao hợp đồng thuê trụ sở" : null, created_by: uid(1), created_at: now(), updated_at: now() };
    });
    const provs = ["TP Hà Nội", "TP Hồ Chí Minh", "TP Hải Phòng", "TP Hà Nội", "TP Đà Nẵng", "TP Hà Nội", "Tỉnh Thanh Hóa", "TP Hồ Chí Minh"];
    const companyRows = companies.map((c, i) => ({
      id: i + 1, tax_code: i === 7 ? null : `01${String(10000000 + i * 7919)}`, name: c, short_name: c.split(" ").filter((w) => /^[A-ZĐ]/.test(w)).map((w) => w[0]).join("").slice(0, 6) + " JSC",
      en_name: `MANPOWER SUPPLY JSC No.${i + 1}`, legal_rep: ["Nguyễn Văn An - TGĐ", "Trần Thị Bình - GĐ", "Lê Văn Cường - TGĐ"][i % 3], company_type: i % 3 ? "CTCP" : "TNHH",
      address: `Số ${10 + i} phố Láng Hạ, phường Láng, ${provs[i]}`, province: provs[i], website: `www.dn${i + 1}.vn`, phone: `02437${String(100000 + i * 731)}`, fax: null, email: `info@dn${i + 1}.vn`,
      training_facility: i % 2 ? `Trung tâm đào tạo số ${i + 1}, ${provs[i]}` : null,
      training_address: i % 2 ? `Lô ${i + 1}, KCN Quế Võ, ${provs[i]}` : null,
      charter_capital: (5 + i * 3) * 1000000000,
      deposit_amount: 2000000000, deposit_bank: `Ngân hàng TMCP Công thương VN - CN ${provs[i]}`,
      deposit_account: `1${String(2000000000 + i * 137)}`, deposit_date: d(-800 - i * 30), deposit_ref: `${100 + i}/XN-NH`,
      staff_list: [`Nguyễn Thị ${String.fromCharCode(66 + i)} - Chuyên viên tuyển chọn`, `Trần Văn ${String.fromCharCode(67 + i)} - Chuyên viên thị trường`, `Lê Thị ${String.fromCharCode(68 + i)} - Kế toán`].slice(0, 2 + (i % 2)).join(String.fromCharCode(10)), license_number: String(300 + i), license_date: d(-900 - i * 60),
      first_license_number: null, first_license_date: null, nd38_times: i % 4 === 1 ? "1" : null, nd38_date: i % 4 === 1 ? d(-500) : null,
      law69_number: i % 2 ? String(10 + i) : null, law69_date: i % 2 ? d(-200 - i * 10) : null, adjust_times: null, adjust_date: null, ds101: null, note: i % 2 ? "Đổi lần 1 theo Luật 69" : "Cấp mới",
      status: i === 6 ? "ended" : "active", ended_year: i === 6 ? "2025" : null, ended_type: i === 6 ? "Nộp lại" : null, ended_reason: i === 6 ? "Chấm dứt hoạt động" : null, ended_ref: null,
      created_by: uid(1), created_at: now(), updated_at: now(),
    }));
    return { profiles, tasks, task_logs: [], licenses, license_logs: [], company_updates, company_update_logs: [], companies: companyRows };
  }

  let db;
  if (params.get("reset")) { localStorage.removeItem(KEY); }
  if (params.get("sample")) { db = seedSample(); }
  else { try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; } }
  if (!db) db = seedEmpty();
  db.licenses ||= []; db.license_logs ||= []; db.company_updates ||= []; db.company_update_logs ||= []; db.companies ||= []; // nâng cấp dữ liệu cũ
  // Luôn phải có ít nhất 1 Trưởng phòng, nếu không sẽ không ai thêm được việc
  if (!db.profiles.some((p) => p.role === "lead" && p.active)) { db.profiles[0].role = "lead"; db.profiles[0].active = true; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  save();

  const nextId = (rows) => rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  const nameOf = (id) => db.profiles.find((p) => p.id === id)?.full_name || "—";
  const me = () => db.profiles[(+(params.get("user") || 1)) - 1] || db.profiles[0];

  // Mo phong trigger ghi nhat ky (giong schema.sql)
  function logChange(oldT, newT) {
    const add = (action, detail) => db.task_logs.push({ id: nextId(db.task_logs), task_id: newT.id, user_id: me().id, action, detail, created_at: now() });
    if (!oldT) { add("create", `Tạo việc. Phụ trách 1: ${nameOf(newT.handler1)}; Phụ trách 2: ${nameOf(newT.handler2)}; Hạn: ${newT.deadline || "—"}`); return; }
    if (oldT.handler1 !== newT.handler1 || oldT.handler2 !== newT.handler2) add("reassign", `Điều chuyển: PT1 ${nameOf(oldT.handler1)} → ${nameOf(newT.handler1)}; PT2 ${nameOf(oldT.handler2)} → ${nameOf(newT.handler2)}`);
    if (oldT.status !== newT.status) add("status", `Trạng thái: ${oldT.status} → ${newT.status}`);
    if (oldT.progress !== newT.progress || oldT.progress_note !== newT.progress_note) add("progress", `Tiến độ: ${oldT.progress}% → ${newT.progress}%${newT.progress_note && newT.progress_note !== oldT.progress_note ? ". " + newT.progress_note : ""}`);
    if (oldT.deadline !== newT.deadline) add("edit", `Thời hạn: ${oldT.deadline || "—"} → ${newT.deadline || "—"}`);
  }
  function logLicense(oldL, newL) {
    const add = (action, detail) => db.license_logs.push({ id: nextId(db.license_logs), license_id: newL.id, user_id: me().id, action, detail, created_at: now() });
    if (!oldL) { add("create", `Tiếp nhận hồ sơ ${newL.procedure}. Phụ trách 1: ${nameOf(newL.handler1)}; Phụ trách 2: ${nameOf(newL.handler2)}; Hạn: ${newL.deadline || "—"}`); return; }
    if (oldL.handler1 !== newL.handler1 || oldL.handler2 !== newL.handler2) add("reassign", `Điều chuyển: PT1 ${nameOf(oldL.handler1)} → ${nameOf(newL.handler1)}; PT2 ${nameOf(oldL.handler2)} → ${nameOf(newL.handler2)}`);
    if (oldL.status !== newL.status) add("status", `Trạng thái: ${oldL.status} → ${newL.status}${newL.note && newL.note !== oldL.note ? ". " + newL.note : ""}`);
    if (oldL.deadline !== newL.deadline) add("edit", `Hạn trả kết quả: ${oldL.deadline || "—"} → ${newL.deadline || "—"}`);
  }
  function logUpdate(oldU, newU) {
    const add = (action, detail) => db.company_update_logs.push({ id: nextId(db.company_update_logs), update_id: newU.id, user_id: me().id, action, detail, created_at: now() });
    if (!oldU) { add("create", `Tiếp nhận yêu cầu: ${newU.update_type}. Phụ trách 1: ${nameOf(newU.handler1)}; Phụ trách 2: ${nameOf(newU.handler2)}; Hạn: ${newU.deadline || "—"}`); return; }
    if (oldU.handler1 !== newU.handler1 || oldU.handler2 !== newU.handler2) add("reassign", `Điều chuyển: PT1 ${nameOf(oldU.handler1)} → ${nameOf(newU.handler1)}; PT2 ${nameOf(oldU.handler2)} → ${nameOf(newU.handler2)}`);
    if (oldU.status !== newU.status) add("status", `Trạng thái: ${oldU.status} → ${newU.status}${newU.note && newU.note !== oldU.note ? ". " + newU.note : ""}`);
    if (oldU.deadline !== newU.deadline) add("edit", `Hạn xử lý: ${oldU.deadline || "—"} → ${newU.deadline || "—"}`);
    if (oldU.update_type !== newU.update_type) add("edit", `Nội dung cập nhật: ${oldU.update_type} → ${newU.update_type}`);
  }
  function syncUpdate(u) { if (u.status === "done" && !u.completed_date) u.completed_date = new Date().toISOString().slice(0, 10); }
  function syncLicense(l) { if (l.status === "issued" && !l.issued_date) l.issued_date = new Date().toISOString().slice(0, 10); }
  function syncStatus(t) {
    if (t.progress === 100 && (t.status === "new" || t.status === "in_progress")) t.status = "done";
    else if (t.status === "done" && t.progress < 100) t.progress = 100;
    else if (t.progress > 0 && t.status === "new") t.status = "in_progress";
  }

  function builder(name) {
    const rows = db[name];
    let filters = [], order = null, one = false, op = "select", payload = null;
    const b = {
      select() { return b; }, eq(k, v) { filters.push((r) => String(r[k]) === String(v)); return b; },
      order(k, o = {}) { order = { k, asc: o.ascending !== false }; return b; }, single() { one = true; return b; },
      range() { return b; }, limit() { return b; },
      insert(p) { op = "insert"; payload = p; return b; }, update(p) { op = "update"; payload = p; return b; }, delete() { op = "delete"; return b; },
      then(res) {
        let data = null;
        const hit = () => rows.filter((r) => filters.every((f) => f(r)));
        if (op === "insert") {
          const list = (Array.isArray(payload) ? payload : [payload]).map((pl) => {
            const t = { ...(name === "tasks" ? { status: "new", progress: 0 } : {}), ...pl, id: nextId(rows), created_by: me().id, created_at: now(), updated_at: now() };
            if (name === "tasks") { syncStatus(t); rows.push(t); logChange(null, t); }
            else if (name === "licenses") { syncLicense(t); rows.push(t); logLicense(null, t); }
            else if (name === "company_updates") { syncUpdate(t); rows.push(t); logUpdate(null, t); }
            else rows.push(t);
            return t;
          });
          data = Array.isArray(payload) ? list : list[0]; save();
        } else if (op === "update") {
          if (name === "profiles") {
            const ids = new Set(hit().map((r) => r.id));
            const leadsAfter = db.profiles.filter((p) => ids.has(p.id) ? (payload.role ?? p.role) === "lead" && (payload.active ?? p.active) : p.role === "lead" && p.active).length;
            if (!leadsAfter) { res({ data: null, error: { message: "Phải còn ít nhất 1 Trưởng phòng đang công tác. Hãy giao vai Trưởng phòng cho người khác trước." } }); return; }
          }
          hit().forEach((r) => {
            const old = { ...r }; Object.assign(r, payload, { updated_at: now() });
            if (name === "tasks") { syncStatus(r); logChange(old, r); }
            if (name === "licenses") { syncLicense(r); logLicense(old, r); }
            if (name === "company_updates") { syncUpdate(r); logUpdate(old, r); }
          });
          save();
        } else if (op === "delete") {
          const ids = new Set(hit().map((r) => r.id)); db[name] = rows.filter((r) => !ids.has(r.id));
          if (name === "tasks") db.task_logs = db.task_logs.filter((l) => !ids.has(l.task_id));
          if (name === "licenses") db.license_logs = db.license_logs.filter((l) => !ids.has(l.license_id));
          if (name === "company_updates") db.company_update_logs = db.company_update_logs.filter((l) => !ids.has(l.update_id));
          save();
        } else {
          data = hit();
          if (order) data.sort((a, c) => { const x = a[order.k] ?? "￿", y = c[order.k] ?? "￿"; return (x > y ? 1 : x < y ? -1 : 0) * (order.asc ? 1 : -1); });
          if (one) data = data[0] || null;
        }
        res({ data, error: null });
      },
    };
    return b;
  }

  window.supabase = {
    createClient() {
      return {
        auth: {
          onAuthStateChange() {},
          async getSession() { return { data: { session: { user: { id: me().id } } } }; },
          async signInWithPassword() { return { error: null }; },
          async signOut() { alert("Chế độ dùng thử trên máy không có đăng nhập. Để có tài khoản thật, cấu hình Supabase theo README."); },
          async updateUser() { return { error: null }; },
          async resetPasswordForEmail() { return { error: null }; },
          async signUp({ email, options }) {
            if (db.profiles.some((p) => p.email === email)) return { data: {}, error: { message: "Email đã tồn tại" } };
            db.profiles.push({ id: crypto.randomUUID(), full_name: options?.data?.full_name || email, email, role: options?.data?.role || "staff", active: true, created_at: now() });
            save();
            return { data: { user: {}, session: {} }, error: null };
          },
        },
        from: builder,
        channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
      };
    },
  };
})();
