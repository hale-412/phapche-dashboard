/* ==========================================================
   Dashboard Phòng Pháp chế - Kiểm tra
   Frontend tĩnh (GitHub Pages) + Supabase (Auth, Postgres, Realtime)
   ========================================================== */
(() => {
  const CFG = window.APP_CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const STATUS = { new: "Mới", in_progress: "Đang xử lý", done: "Hoàn thành", cancelled: "Hủy" };
  const ACTION = { create: "Tạo việc", reassign: "Điều chuyển", status: "Trạng thái", progress: "Tiến độ", edit: "Sửa", delete: "Xóa" };
  const LSTAT = window.LICENSE_STATUSES || [];
  const LSTAT_MAP = Object.fromEntries(LSTAT.map((s) => [s.value, s]));
  const PROCEDURES = window.LICENSE_PROCEDURES || [];
  const USTAT = window.UPDATE_STATUSES || [];
  const USTAT_MAP = Object.fromEntries(USTAT.map((s) => [s.value, s]));
  const UPDATE_TYPES = window.UPDATE_TYPES || [];
  const BIZ_TASK_TYPES = window.BIZ_TASK_TYPES || [];
  const CSTAT = window.COMPANY_STATUSES || [];
  const CSTAT_MAP = Object.fromEntries(CSTAT.map((s) => [s.value, s]));
  const CFIELDS = window.COMPANY_FIELDS || [];
  const TFIELDS = window.TASK_FIELDS || [];
  const LFIELDS = window.LICENSE_FIELDS || [];

  const state = {
    sb: null, session: null, me: null,
    profiles: [], tasks: [], licenses: [], updates: [], companies: [],
    sort: { key: "deadline", dir: "asc" },
    lsort: { key: "deadline", dir: "asc" },
    usort: { key: "deadline", dir: "asc" },
    csort: { key: "name", dir: "asc" },
    view: "overview",
    // Hồ sơ doanh nghiệp đang mở + 5 bảng con của nó (nạp riêng khi mở hồ sơ)
    cur: null,
    sub: { reps: [], facilities: [], violations: [], inspections: [], events: [] },
    tfilter: "all",
  };

  // ---------- Helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const fmtDate = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
  const fmtDateTime = (iso) => { const d = new Date(iso); return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }); };
  const daysLeft = (t) => (t.deadline ? Math.round((new Date(t.deadline) - new Date(todayISO())) / 86400000) : null);
  const isLicense = (t) => t.kind === "license";
  const isUpdate = (t) => t.kind === "update";
  const isOpen = (t) => (isLicense(t) ? !LSTAT_MAP[t.status]?.final : isUpdate(t) ? !USTAT_MAP[t.status]?.final : t.status === "new" || t.status === "in_progress");
  const statusLabel = (t) => (isLicense(t) ? LSTAT_MAP[t.status]?.label || t.status : isUpdate(t) ? USTAT_MAP[t.status]?.label || t.status : STATUS[t.status]);
  const isOverdue = (t) => isOpen(t) && daysLeft(t) !== null && daysLeft(t) < 0;
  const isSoon = (t) => isOpen(t) && daysLeft(t) !== null && daysLeft(t) >= 0 && daysLeft(t) <= CFG.SOON_DAYS;
  const nameOf = (id) => state.profiles.find((p) => p.id === id)?.full_name || "—";
  const isLead = () => state.me?.role === "lead";
  const mine = (t) => t.handler1 === state.me?.id || t.handler2 === state.me?.id;

  function dueLabel(t) {
    const d = daysLeft(t);
    if (d === null) return { cls: "ok", text: "Không có hạn" };
    if (!isOpen(t)) return { cls: "ok", text: fmtDate(t.deadline) };
    if (d < 0) return { cls: "crit", text: `Quá hạn ${-d} ngày` };
    if (d === 0) return { cls: "crit", text: "Hôm nay" };
    if (d <= CFG.SOON_DAYS) return { cls: "warn", text: `Còn ${d} ngày` };
    return { cls: "ok", text: `Còn ${d} ngày` };
  }

  let toastTimer;
  function toast(msg, err = false) {
    const el = $("#toast");
    el.textContent = msg; el.className = "toast" + (err ? " err" : ""); el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), err ? 5000 : 2500);
  }

  // ---------- Khởi tạo ----------
  // Dù hỏng gì cũng phải hiện được màn hình đăng nhập kèm lý do — không để người dùng nhìn trang trắng
  function fatal(msg) {
    const box = document.getElementById("view-login");
    if (box) box.hidden = false;
    const err = document.getElementById("login-error");
    if (err) { err.textContent = msg; err.hidden = false; }
  }

  async function init() {
    if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("YOUR-PROJECT")) {
      $("#view-login").hidden = false;
      $("#login-error").textContent = "Chưa cấu hình Supabase. Sửa file js/config.js theo hướng dẫn trong README.";
      $("#login-error").hidden = false;
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      return fatal("Không tải được thư viện kết nối (vendor/supabase-2.45.4.min.js). "
        + "Tải lại trang bằng Ctrl+F5; nếu vẫn lỗi thì mạng đang chặn trang này.");
    }
    state.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    bindUI();

    state.sb.auth.onAuthStateChange(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") { $("#pass-dialog").showModal(); }
      if (session && !state.session) { state.session = session; await enterApp(); }
      else if (!session && state.session) { state.session = null; showLogin(); }
    });
    // Nếu getSession() treo (lỗi khóa của thư viện trên vài trình duyệt) thì vẫn phải hiện màn hình đăng nhập,
    // chứ không để người dùng nhìn trang trắng. Có phiên thật thì onAuthStateChange sẽ vào app sau.
    const timeout = new Promise((r) => setTimeout(() => r({ data: { session: null }, timedOut: true }), 8000));
    const res = await Promise.race([state.sb.auth.getSession(), timeout]);
    const session = res?.data?.session || null;
    if (session) { state.session = session; await enterApp(); }
    else { showLogin(); if (res?.timedOut) console.warn("getSession() quá hạn 8s — vẫn hiện màn hình đăng nhập"); }
  }

  function showLogin() {
    $("#app").hidden = true; $("#view-login").hidden = false;
    state.me = null; state.tasks = []; state.profiles = [];
  }

  async function enterApp() {
    const uid = state.session.user.id;
    const { data: me, error } = await state.sb.from("profiles").select("*").eq("id", uid).single();
    if (error || !me) { toast("Không tìm thấy hồ sơ người dùng. Liên hệ Trưởng phòng.", true); await state.sb.auth.signOut(); return; }
    state.me = me;
    $("#user-name").textContent = me.full_name;
    $("#user-role").textContent = me.role === "lead" ? "Trưởng phòng" : "Chuyên viên";
    document.body.classList.toggle("is-lead", isLead());
    $$(".lead-only").forEach((el) => (el.hidden = !isLead()));
    $("#view-login").hidden = true; $("#app").hidden = false;
    await loadAll();
    subscribeRealtime();
    notifyBrowser();
  }

  async function loadAll() {
    const [p, t, l, u, c] = await Promise.all([
      state.sb.from("profiles").select("*").order("full_name"),
      state.sb.from("tasks").select("*").order("deadline", { ascending: true, nullsFirst: false }),
      state.sb.from("licenses").select("*").order("deadline", { ascending: true, nullsFirst: false }),
      state.sb.from("company_updates").select("*").order("deadline", { ascending: true, nullsFirst: false }),
      fetchAllRows("companies", "name"),
    ]);
    if (p.error) toast(p.error.message, true);
    if (t.error) toast(t.error.message, true);
    if (l.error) toast(l.error.message, true);
    if (u.error) toast(u.error.message, true);
    if (c.error) toast(c.error.message, true);
    state.profiles = (p.data || []).sort((a, b) => a.full_name.localeCompare(b.full_name, "vi"));
    state.tasks = t.data || [];
    state.licenses = (l.data || []).map((x) => ({ ...x, kind: "license" }));
    state.updates = (u.data || []).map((x) => ({ ...x, kind: "update" }));
    state.companies = c.data || [];
    fillHandlerSelects();
    fillCompanySelect();
    fillCompanyFilters();
    renderAll();
  }

  // Supabase trả tối đa 1000 dòng/lần → tải theo trang (bảng doanh nghiệp có thể > 1000)
  async function fetchAllRows(table, orderKey) {
    const PAGE = 1000; let from = 0; const all = [];
    for (;;) {
      const { data, error } = await state.sb.from(table).select("*").order(orderKey).range(from, from + PAGE - 1);
      if (error) return { data: all, error };
      all.push(...(data || []));
      if (!data || data.length < PAGE) return { data: all, error: null };
      from += PAGE;
    }
  }

  // Gộp nhiều sự kiện realtime liên tiếp (vd. khi nhập Excel hàng trăm dòng) thành 1 lần tải lại
  let reloadTimer;
  const reloadSoon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 400); };

  let channel;
  function subscribeRealtime() {
    if (channel) return;
    channel = state.sb.channel("tasks-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "licenses" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "company_updates" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "companies" }, reloadSoon)
      .subscribe();
  }

  // Thông báo trình duyệt khi có việc quá hạn / sắp đến hạn của tôi
  async function notifyBrowser() {
    if (!("Notification" in window)) return;
    const my = allItems().filter((t) => mine(t) && (isOverdue(t) || isSoon(t)));
    if (!my.length) return;
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") return;
    const od = my.filter(isOverdue).length;
    new Notification(CFG.DEPT_NAME, {
      body: `${od ? od + " việc quá hạn, " : ""}${my.length - od} việc sắp đến hạn của bạn.`,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚖️</text></svg>",
    });
  }

  // ---------- Render ----------
  // Yêu cầu cập nhật TTDN (state.updates) đã bỏ khỏi giao diện → không đưa vào danh sách việc cần chú ý / việc của tôi;
  // dữ liệu vẫn tải về để hiện lịch sử trong hồ sơ doanh nghiệp.
  const allItems = () => state.tasks.concat(state.licenses);

  function renderAll() {
    renderTiles(); renderAttention(); renderWorkload(); renderMine(); renderTasks(); renderLicenseTiles(); renderLicenses(); renderCompanyTiles(); renderCompanies(); renderStaff();
    const od = allItems().filter(isOverdue).length;
    document.title = `${od ? "(" + od + ") " : ""}Dashboard ${CFG.DEPT_NAME}`;
  }

  function renderTiles() {
    const t = state.tasks;
    const ym = todayISO().slice(0, 7);
    const tiles = [
      { cls: "info", icon: "📂", label: "Đang xử lý", value: t.filter(isOpen).length, sub: `${t.filter((x) => x.status === "new").length} mới`, filter: { status: "open" } },
      { cls: "warn", icon: "⏳", label: `Sắp đến hạn (${CFG.SOON_DAYS} ngày)`, value: t.filter(isSoon).length, sub: `${t.filter((x) => isOpen(x) && daysLeft(x) === 0).length} hôm nay`, filter: { status: "open", due: "3d" } },
      { cls: "crit", icon: "⚠️", label: "Quá hạn", value: t.filter(isOverdue).length, sub: "cần xử lý ngay", filter: { status: "open", due: "overdue" } },
      { cls: "good", icon: "✅", label: "Hoàn thành tháng này", value: t.filter((x) => x.status === "done" && (x.updated_at || "").startsWith(ym)).length, sub: `tổng ${t.filter((x) => x.status === "done").length} hoàn thành`, filter: { status: "done" } },
      { cls: "", icon: "📋", label: "Hồ sơ GP đang xử lý", value: state.licenses.filter(isOpen).length, sub: `${state.licenses.filter(isOverdue).length} quá hạn · ${state.licenses.filter((x) => x.status === "supplement").length} chờ bổ sung`, view: "licenses", filter: { status: "open" } },

      { cls: "", icon: "👤", label: "Việc của tôi", value: allItems().filter((x) => isOpen(x) && mine(x)).length, sub: `${allItems().filter((x) => mine(x) && isOverdue(x)).length} quá hạn`, filter: { status: "open", handler: state.me.id } },
    ];
    $("#tiles").innerHTML = tilesHTML(tiles);
    $$("#tiles .tile").forEach((el) => el.addEventListener("click", () => {
      const x = tiles[+el.dataset.i];
      if (x.view === "licenses") { applyLicenseFilter(x.filter); switchView("licenses"); }
      else if (x.view === "companies") { applyCompanyFilter(x.filter); switchView("companies"); }
      else { applyFilter(x.filter); switchView("tasks"); }
    }));
  }

  const tilesHTML = (tiles) => tiles.map((x, i) => `
      <div class="tile ${x.cls}" data-i="${i}" role="button" tabindex="0">
        <div class="label"><span>${x.icon}</span>${esc(x.label)}</div>
        <div class="value">${x.value}</div>
        <div class="sub">${esc(x.sub)}</div>
      </div>`).join("");

  function renderLicenseTiles() {
    const l = state.licenses, ym = todayISO().slice(0, 7);
    const tiles = [
      { cls: "info", icon: "📋", label: "Đang xử lý", value: l.filter(isOpen).length, sub: `${l.filter((x) => x.status === "received").length} mới tiếp nhận`, filter: { status: "open" } },
      { cls: "warn", icon: "📝", label: "Chờ bổ sung", value: l.filter((x) => x.status === "supplement").length, sub: "doanh nghiệp cần bổ sung", filter: { status: "supplement" } },
      { cls: "crit", icon: "⚠️", label: "Quá hạn trả KQ", value: l.filter(isOverdue).length, sub: `${l.filter(isSoon).length} sắp đến hạn`, filter: { status: "open", due: "overdue" } },
      { cls: "good", icon: "🏅", label: "Đã cấp tháng này", value: l.filter((x) => x.status === "issued" && (x.issued_date || "").startsWith(ym)).length, sub: `tổng ${l.filter((x) => x.status === "issued").length} đã cấp`, filter: { status: "issued" } },
    ];
    $("#license-tiles").innerHTML = tilesHTML(tiles);
    $$("#license-tiles .tile").forEach((el) => el.addEventListener("click", () => applyLicenseFilter(tiles[+el.dataset.i].filter)));
  }

  function listItem(t) {
    const d = dueLabel(t);
    const dot = isOverdue(t) ? "crit" : isSoon(t) ? "warn" : isOpen(t) ? "info" : "";
    const title = isLicense(t)
      ? `<span class="tag license">Hồ sơ GP</span> ${esc(t.procedure)} · ${esc(t.company_name)}`
      : isUpdate(t)
      ? `<span class="tag update">Cập nhật TTDN</span> ${esc(t.company_name)} · ${esc(t.update_type)}`
      : `${t.priority === "urgent" ? '<span class="tag urgent">Khẩn</span> ' : ""}${esc(t.doc_number ? t.doc_number + " · " : "")}${esc(t.content)}`;
    const meta = `${esc(nameOf(t.handler1))}${t.handler2 ? " / " + esc(nameOf(t.handler2)) : ""} · ${isLicense(t) || isUpdate(t) ? "" : t.progress + "% · "}${statusLabel(t)}`;
    return `<div class="list-item" data-id="${t.id}" data-kind="${t.kind || "task"}">
      <span class="dot ${dot}"></span>
      <div>
        <div class="title">${title}</div>
        <div class="meta">${meta}</div>
      </div>
      <div class="due ${d.cls}">${esc(d.text)}<br><span class="muted small">${fmtDate(t.deadline)}</span></div>
    </div>`;
  }

  function renderAttention() {
    const list = allItems().filter((t) => isOverdue(t) || isSoon(t)).sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));
    $("#attention-list").innerHTML = list.length ? list.slice(0, 30).map(listItem).join("") : `<p class="muted center">Không có việc nào quá hạn hoặc sắp đến hạn 👍</p>`;
  }

  function renderMine() {
    const list = allItems().filter((t) => mine(t) && isOpen(t)).sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
    $("#my-count").textContent = `${list.length} việc / hồ sơ đang mở`;
    $("#my-list").innerHTML = list.length ? list.map(listItem).join("") : `<p class="muted center">Bạn không có việc nào đang mở.</p>`;
  }

  function renderWorkload() {
    const rows = state.profiles.filter((p) => p.active).map((p) => {
      const open = allItems().filter(isOpen);
      const l1 = open.filter((t) => t.handler1 === p.id).length;
      const l2 = open.filter((t) => t.handler2 === p.id).length;
      const od = open.filter((t) => (t.handler1 === p.id || t.handler2 === p.id) && isOverdue(t)).length;
      return { name: p.full_name, l1, l2, od, total: l1 + l2 };
    }).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...rows.map((r) => r.total));
    $("#workload-chart").innerHTML = `<div class="bars">${rows.map((r) => `
      <div class="bar-row" title="${esc(r.name)}: ${r.l1} mức 1, ${r.l2} mức 2${r.od ? ", " + r.od + " quá hạn" : ""}">
        <span class="name">${esc(r.name)}</span>
        <div class="bar-track">
          <div class="bar-seg l1" style="width:${(r.l1 / max) * 100}%"></div>
          <div class="bar-seg l2" style="width:${(r.l2 / max) * 100}%"></div>
        </div>
        <span class="val">${r.total}${r.od ? ` <span style="color:var(--critical-ink)">⚠ ${r.od}</span>` : ""}</span>
      </div>`).join("")}</div>
      <div class="legend"><span><i style="background:var(--series-1)"></i>Phụ trách mức 1</span><span><i style="background:var(--series-2)"></i>Phụ trách mức 2</span><span>⚠ quá hạn</span></div>`;
  }

  // ---- Bảng văn bản ----
  function filteredTasks() {
    const q = $("#f-search").value.trim().toLowerCase();
    const st = $("#f-status").value, h = $("#f-handler").value, due = $("#f-due").value;
    const today = todayISO(), ym = today.slice(0, 7);
    return state.tasks.filter((t) => {
      if (st === "open" ? !isOpen(t) : st !== "all" && t.status !== st) return false;
      if (h && t.handler1 !== h && t.handler2 !== h) return false;
      if (due) {
        const d = daysLeft(t);
        if (due === "overdue" && !isOverdue(t)) return false;
        if (due === "today" && d !== 0) return false;
        if (due === "3d" && !(d !== null && d >= 0 && d <= 3)) return false;
        if (due === "7d" && !(d !== null && d >= 0 && d <= 7)) return false;
        if (due === "month" && !(t.deadline || "").startsWith(ym)) return false;
      }
      if (q && !`${t.doc_number} ${t.content} ${t.sender} ${t.tax_code || ""} ${t.biz_type || ""} ${t.result} ${nameOf(t.handler1)} ${nameOf(t.handler2)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function sortTasks(list) {
    const { key, dir } = state.sort;
    const val = (t) => {
      if (key === "handler1" || key === "handler2") return nameOf(t[key]);
      if (key === "deadline" || key === "doc_date") return t[key] || "9999-99-99";
      return t[key] ?? "";
    };
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "vi");
      return dir === "asc" ? c : -c;
    });
  }

  function renderTasks() {
    const list = sortTasks(filteredTasks());
    $("#tasks-empty").hidden = list.length > 0;
    $$("#tasks-table th[data-sort]").forEach((th) => { th.classList.toggle("sorted", th.dataset.sort === state.sort.key); th.classList.toggle("desc", state.sort.dir === "desc"); });
    $("#tasks-body").innerHTML = list.map((t) => {
      const d = dueLabel(t);
      const rowCls = isOverdue(t) ? "overdue" : isSoon(t) ? "soon" : "";
      return `<tr data-id="${t.id}" class="${rowCls}">
        <td class="nowrap mono">${esc(t.doc_number) || "—"}${t.priority === "urgent" ? ' <span class="tag urgent">Khẩn</span>' : ""}</td>
        <td class="nowrap mono">${fmtDate(t.doc_date)}</td>
        <td class="content-cell">${esc(t.content)}<div class="sender">${esc(t.sender || "")}${t.category && t.category !== "Văn bản đến" ? " · " + esc(t.category) : ""}${t.biz_type ? " · " + esc(t.biz_type) : ""}${t.tax_code ? " · MSDN " + esc(t.tax_code) : ""}</div></td>
        <td class="nowrap"><span class="mono">${fmtDate(t.deadline)}</span><br><span class="due ${d.cls}">${esc(d.text)}</span></td>
        <td>${esc(nameOf(t.handler1))}</td>
        <td>${t.handler2 ? esc(nameOf(t.handler2)) : '<span class="muted">—</span>'}</td>
        <td><div class="progress"><div class="track"><div class="fill ${t.status === "done" ? "done" : ""}" style="width:${t.progress}%"></div></div><span>${t.progress}%</span></div></td>
        <td><span class="tag ${t.status}">${STATUS[t.status]}</span></td>
      </tr>`;
    }).join("");
  }

  function renderStaff() {
    const ym = todayISO().slice(0, 7);
    const open = allItems().filter(isOpen);
    $("#staff-summary").textContent = `${state.profiles.filter((p) => p.active).length} người đang công tác`;
    $("#staff-body").innerHTML = state.profiles.map((p) => {
      const l1 = open.filter((t) => t.handler1 === p.id).length;
      const l2 = open.filter((t) => t.handler2 === p.id).length;
      const od = open.filter((t) => (t.handler1 === p.id || t.handler2 === p.id) && isOverdue(t)).length;
      const done = state.tasks.filter((t) => t.status === "done" && (t.handler1 === p.id || t.handler2 === p.id) && (t.updated_at || "").startsWith(ym)).length;
      return `<tr data-id="${p.id}" style="${p.active ? "" : "opacity:.5"}">
        <td><b>${esc(p.full_name)}</b>${p.active ? "" : ' <span class="chip">Nghỉ</span>'}</td>
        <td>${esc(p.email)}</td>
        <td><span class="chip">${p.role === "lead" ? "Trưởng phòng" : "Chuyên viên"}</span></td>
        <td class="mono">${l1}</td><td class="mono">${l2}</td>
        <td class="mono" style="${od ? "color:var(--critical-ink);font-weight:600" : ""}">${od}</td>
        <td class="mono">${done}</td>
        <td>${isLead() ? `<button class="btn small ghost" data-edit="${p.id}">Sửa</button>` : ""}</td>
      </tr>`;
    }).join("");
  }

  // ---------- Điều hướng & bộ lọc ----------
  function switchView(v) {
    state.view = v;
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    $$(".view").forEach((s) => (s.hidden = s.id !== "view-" + v));
    window.scrollTo({ top: 0 });
  }

  function applyFilter(f = {}) {
    $("#f-search").value = f.search || "";
    $("#f-status").value = f.status || "open";
    $("#f-handler").value = f.handler || "";
    $("#f-due").value = f.due || "";
    renderTasks();
  }

  function fillHandlerSelects() {
    const opts = state.profiles.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("");
    const cur = $("#f-handler").value;
    $("#f-handler").innerHTML = `<option value="">Mọi chuyên viên</option>` + opts;
    $("#f-handler").value = cur;
    $("#t-handler1").innerHTML = `<option value="">— Chưa giao —</option>` + opts;
    $("#t-handler2").innerHTML = `<option value="">— Không —</option>` + opts;
    const lcur = $("#l-handler").value;
    $("#l-handler").innerHTML = `<option value="">Mọi chuyên viên</option>` + opts;
    $("#l-handler").value = lcur;
    $("#l-handler1").innerHTML = `<option value="">— Chưa giao —</option>` + opts;
    $("#l-handler2").innerHTML = `<option value="">— Không —</option>` + opts;
  }

  // Danh mục doanh nghiệp (mã số → tên): ưu tiên bảng Doanh nghiệp, rồi đến hồ sơ giấy phép / yêu cầu cập nhật
  function companyDir() {
    const m = new Map();
    state.companies.forEach((x) => { if (x.tax_code && !m.has(x.tax_code)) m.set(x.tax_code, x.name); });
    state.licenses.concat(state.updates).forEach((x) => { if (x.tax_code && !m.has(x.tax_code)) m.set(x.tax_code, x.company_name); });
    return m;
  }
  function fillCompanySelect() {
    const dir = companyDir();
    $("#t-tax_code-list").innerHTML = [...dir].map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`).join("");
  }

  function fillLicenseSelects() {
    const st = LSTAT.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join("");
    $("#l-status").innerHTML = `<option value="open">Đang xử lý</option>` + st + `<option value="all">Tất cả</option>`;
    $("#l-status-f").innerHTML = st;
    const pr = PROCEDURES.map((p) => `<option>${esc(p)}</option>`).join("");
    $("#l-procedure").innerHTML = `<option value="">Mọi thủ tục</option>` + pr;
    $("#l-procedure-f").innerHTML = pr;
  }

  // ---------- Hồ sơ Giấy phép ----------
  function applyLicenseFilter(f = {}) {
    $("#l-search").value = f.search || "";
    $("#l-status").value = f.status || "open";
    $("#l-procedure").value = f.procedure || "";
    $("#l-handler").value = f.handler || "";
    state.lDue = f.due || "";
    renderLicenses();
  }

  function filteredLicenses() {
    const q = $("#l-search").value.trim().toLowerCase();
    const st = $("#l-status").value, pr = $("#l-procedure").value, h = $("#l-handler").value;
    return state.licenses.filter((l) => {
      if (st === "open" ? !isOpen(l) : st !== "all" && l.status !== st) return false;
      if (pr && l.procedure !== pr) return false;
      if (h && l.handler1 !== h && l.handler2 !== h) return false;
      if (state.lDue === "overdue" && !isOverdue(l)) return false;
      if (q && !`${l.file_number} ${l.company_name} ${l.tax_code} ${l.license_number} ${nameOf(l.handler1)} ${nameOf(l.handler2)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function sortLicenses(list) {
    const { key, dir } = state.lsort;
    const val = (l) => {
      if (key === "handler1" || key === "handler2") return nameOf(l[key]);
      if (key === "deadline" || key === "received_date") return l[key] || "9999-99-99";
      if (key === "status") return LSTAT.findIndex((s) => s.value === l.status);
      return l[key] ?? "";
    };
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "vi");
      return dir === "asc" ? c : -c;
    });
  }

  function renderLicenses() {
    const list = sortLicenses(filteredLicenses());
    $("#licenses-empty").hidden = list.length > 0;
    $$("#licenses-table th[data-sort]").forEach((th) => { th.classList.toggle("sorted", th.dataset.sort === state.lsort.key); th.classList.toggle("desc", state.lsort.dir === "desc"); });
    $("#licenses-body").innerHTML = list.map((l) => {
      const d = dueLabel(l);
      const s = LSTAT_MAP[l.status] || { label: l.status, cls: "new" };
      const rowCls = isOverdue(l) ? "overdue" : isSoon(l) ? "soon" : "";
      return `<tr data-id="${l.id}" class="${rowCls}">
        <td class="nowrap mono">${esc(l.file_number) || "—"}</td>
        <td class="content-cell"><b>${esc(l.company_name)}</b><div class="sender">${l.tax_code ? "MSDN " + esc(l.tax_code) : ""}${l.license_number ? " · GP số " + esc(l.license_number) + (l.issued_date ? " (" + fmtDate(l.issued_date) + ")" : "") : ""}</div></td>
        <td class="nowrap">${esc(l.procedure)}</td>
        <td class="nowrap mono">${fmtDate(l.received_date)}</td>
        <td class="nowrap"><span class="mono">${fmtDate(l.deadline)}</span><br><span class="due ${d.cls}">${esc(d.text)}</span></td>
        <td>${esc(nameOf(l.handler1))}</td>
        <td>${l.handler2 ? esc(nameOf(l.handler2)) : '<span class="muted">—</span>'}</td>
        <td><span class="tag ${s.cls}">${esc(s.label)}</span></td>
      </tr>`;
    }).join("");
  }

  async function openLicense(id) {
    const l = id ? state.licenses.find((x) => x.id === id) : null;
    const dlg = $("#license-dialog");
    $("#license-dialog-title").textContent = l ? `Hồ sơ ${l.file_number || "#" + l.id} – ${l.company_name}` : "Tiếp nhận hồ sơ giấy phép";
    $("#l-id").value = l?.id || "";
    $("#l-company_name").value = l?.company_name || "";
    $("#l-tax_code").value = l?.tax_code || "";
    $("#l-file_number").value = l?.file_number || "";
    $("#l-procedure-f").value = l?.procedure || PROCEDURES[0] || "";
    $("#l-received_date").value = l?.received_date || todayISO();
    $("#l-deadline").value = l?.deadline || "";
    $("#l-status-f").value = l?.status || LSTAT[0]?.value || "";
    $("#l-handler1").value = l?.handler1 || "";
    $("#l-handler2").value = l?.handler2 || "";
    $("#l-license_number").value = l?.license_number || "";
    $("#l-issued_date").value = l?.issued_date || "";
    $("#l-note").value = l?.note || "";

    const canEditAll = isLead();
    const canEditStatus = canEditAll || (l && mine(l));
    $$(".lead-field", dlg).forEach((el) => (el.disabled = !canEditAll));
    ["#l-status-f", "#l-license_number", "#l-issued_date", "#l-note"].forEach((s) => ($(s).disabled = !canEditStatus));
    $("#save-license-btn").hidden = !canEditStatus;
    $("#delete-license-btn").hidden = !(canEditAll && l);

    $("#license-history").hidden = !l;
    if (l) {
      $("#license-history-list").innerHTML = `<li class="muted">Đang tải…</li>`;
      const { data } = await state.sb.from("license_logs").select("*").eq("license_id", l.id).order("created_at", { ascending: false });
      $("#license-history-list").innerHTML = (data || []).map((g) => `<li><span class="when">${fmtDateTime(g.created_at)}</span><span><span class="who">${esc(nameOf(g.user_id))}</span> · ${ACTION[g.action] || g.action}: ${esc(g.detail)}</span></li>`).join("") || `<li class="muted">Chưa có</li>`;
    }
    dlg.showModal();
  }

  async function saveLicense(e) {
    e.preventDefault();
    const id = $("#l-id").value;
    const payload = {
      status: $("#l-status-f").value,
      license_number: $("#l-license_number").value.trim() || null,
      issued_date: $("#l-issued_date").value || null,
      note: $("#l-note").value.trim() || null,
    };
    if (isLead()) Object.assign(payload, {
      company_name: $("#l-company_name").value.trim(),
      tax_code: $("#l-tax_code").value.trim() || null,
      file_number: $("#l-file_number").value.trim() || null,
      procedure: $("#l-procedure-f").value,
      received_date: $("#l-received_date").value || null,
      deadline: $("#l-deadline").value || null,
      handler1: $("#l-handler1").value || null,
      handler2: $("#l-handler2").value || null,
    });
    if (payload.handler1 && payload.handler1 === payload.handler2) { toast("Phụ trách mức 1 và mức 2 không được trùng nhau", true); return; }
    $("#save-license-btn").disabled = true;
    const q = id ? state.sb.from("licenses").update(payload).eq("id", id) : state.sb.from("licenses").insert(payload);
    const { error } = await q;
    $("#save-license-btn").disabled = false;
    if (error) { toast(error.message, true); return; }
    toast(id ? "Đã lưu hồ sơ" : "Đã tiếp nhận hồ sơ");
    $("#license-dialog").close();
    await loadAll();
  }

  async function deleteLicense() {
    const id = $("#l-id").value;
    if (!id || !confirm("Xóa hồ sơ này? Không thể hoàn tác.")) return;
    const { error } = await state.sb.from("licenses").delete().eq("id", id);
    if (error) { toast(error.message, true); return; }
    toast("Đã xóa"); $("#license-dialog").close(); await loadAll();
  }

  function exportLicensesCSV() {
    const rows = sortLicenses(filteredLicenses());
    const head = ["Số hồ sơ", "Tên doanh nghiệp", "Mã số DN", "Thủ tục", "Ngày nhận", "Hạn trả KQ", "Phụ trách 1", "Phụ trách 2", "Trạng thái", "Số giấy phép", "Ngày cấp", "Ghi chú"];
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(",")].concat(rows.map((l) => [
      l.file_number, l.company_name, l.tax_code, l.procedure, fmtDate(l.received_date), fmtDate(l.deadline),
      nameOf(l.handler1), l.handler2 ? nameOf(l.handler2) : "", LSTAT_MAP[l.status]?.label || l.status, l.license_number, fmtDate(l.issued_date), l.note,
    ].map(cell).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `phapche-hoso-giayphep-${todayISO()}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- Doanh nghiệp ----------
  const normTax = (v) => {
    let s = String(v ?? "").trim();
    if (!s) return "";
    if (/^\d(\.\d+)?e\+?\d+$/i.test(s)) s = Number(s).toFixed(0);       // Excel lưu dạng số khoa học
    const digits = s.replace(/\D/g, "");
    if (/^\d{10}(-\d{3})?$/.test(s)) return s;
    if (digits.length === 9) return "0" + digits;                         // mất số 0 đầu khi Excel coi là số
    if (digits.length === 10 || digits.length === 13) return digits.length === 13 ? digits.slice(0, 10) + "-" + digits.slice(10) : digits;
    return s;
  };
  const validTax = (s) => /^\d{10}(-\d{3})?$/.test(s || "");
  const fmtCompanyStatus = (c) => CSTAT_MAP[c.status] || { label: c.status, cls: "new" };

  function fillCompanyFilters() {
    const keep = (sel, opts, first) => { const cur = sel.value; sel.innerHTML = `<option value="">${first}</option>` + opts; sel.value = cur; };
    const prov = [...new Set(state.companies.map((c) => (c.province || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
    keep($("#cf-province"), prov.map((p) => `<option>${esc(p)}</option>`).join(""), "Mọi tỉnh / TP");
    $("#c-province-list").innerHTML = prov.map((p) => `<option value="${esc(p)}">`).join("");
    const types = [...new Set(state.companies.map((c) => (c.company_type || "").trim()).filter(Boolean))].sort();
    keep($("#c-type"), types.map((p) => `<option>${esc(p)}</option>`).join(""), "Mọi loại hình");
    if (!$("#c-status-f").options.length) $("#c-status-f").innerHTML = CSTAT.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join("");
  }

  function applyCompanyFilter(f = {}) {
    $("#c-search").value = f.search || "";
    $("#c-status").value = f.status || "active";
    $("#cf-province").value = f.province || "";
    $("#c-type").value = f.type || "";
    renderCompanies();
  }

  function filteredCompanies() {
    const q = $("#c-search").value.trim().toLowerCase();
    const st = $("#c-status").value, pv = $("#cf-province").value, ty = $("#c-type").value;
    return state.companies.filter((c) => {
      if (st !== "all" && c.status !== st) return false;
      if (pv && (c.province || "").trim() !== pv) return false;
      if (ty && (c.company_type || "").trim() !== ty) return false;
      if (q && !`${c.tax_code} ${c.name} ${c.short_name} ${c.en_name} ${c.license_number} ${c.legal_rep} ${c.address} ${c.phone} ${c.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function sortCompanies(list) {
    const { key, dir } = state.csort;
    const val = (c) => {
      if (key === "license_date") return c[key] || "9999-99-99";
      if (key === "license_number") return +String(c[key] || "").replace(/\D/g, "") || 0;
      return c[key] ?? "";
    };
    return list.sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "vi");
      return dir === "asc" ? cmp : -cmp;
    });
  }

  function renderCompanyTiles() {
    const c = state.companies, act = c.filter((x) => x.status === "active");
    const byProv = {}; act.forEach((x) => { const p = (x.province || "—").trim(); byProv[p] = (byProv[p] || 0) + 1; });
    const top = Object.entries(byProv).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([p, n]) => `${p}: ${n}`).join(" · ");
    const tiles = [
      { cls: "good", icon: "🏢", label: "DN đang hoạt động", value: act.length, sub: top || "chưa có dữ liệu", filter: { status: "active" } },

      { cls: "warn", icon: "❔", label: "Thiếu mã số DN", value: act.filter((x) => !validTax(x.tax_code)).length, sub: "cần bổ sung để liên kết hồ sơ", filter: { status: "active", search: "" }, missing: true },
      { cls: "", icon: "⛔", label: "Đã chấm dứt", value: c.filter((x) => x.status === "ended").length, sub: "thu hồi / nộp lại giấy phép", filter: { status: "ended" } },
    ];
    $("#company-tiles").innerHTML = tilesHTML(tiles);
    $$("#company-tiles .tile").forEach((el) => el.addEventListener("click", () => {
      const x = tiles[+el.dataset.i];
      applyCompanyFilter(x.filter);
      if (x.missing) { state.cMissing = true; renderCompanies(); }
    }));
  }

  const SHOW_MAX = 300;
  function renderCompanies() {
    let list = filteredCompanies();
    if (state.cMissing) list = list.filter((x) => !validTax(x.tax_code));
    list = sortCompanies(list);
    $("#companies-empty").hidden = list.length > 0 || state.companies.length > 0;
    $$("#companies-table th[data-sort]").forEach((th) => { th.classList.toggle("sorted", th.dataset.sort === state.csort.key); th.classList.toggle("desc", state.csort.dir === "desc"); });
    const shown = list.slice(0, SHOW_MAX);
    $("#companies-more").hidden = list.length <= SHOW_MAX;
    $("#companies-more").textContent = `Đang hiển thị ${SHOW_MAX} / ${list.length} doanh nghiệp — dùng ô tìm kiếm hoặc bộ lọc để thu hẹp.`;
    $("#companies-body").innerHTML = shown.map((c) => {
      const s = fmtCompanyStatus(c);
      const contact = [c.phone, c.email].filter(Boolean).map((x) => esc(String(x).split(/\n/)[0])).join("<br>");
      return `<tr data-id="${c.id}">
        <td class="nowrap mono">${validTax(c.tax_code) ? esc(c.tax_code) : `<span class="muted" title="Mã số chưa hợp lệ">${esc(c.tax_code) || "—"}</span>`}</td>
        <td class="content-cell"><b>${esc(c.name)}</b><div class="sender">${esc([c.short_name, c.company_type].filter(Boolean).join(" · "))}</div></td>
        <td class="nowrap mono">${esc(c.license_number) || "—"}${c.law69_number ? `<br><span class="muted small">L69: ${esc(c.law69_number)}</span>` : ""}</td>
        <td class="nowrap mono">${fmtDate(c.license_date)}</td>
        <td>${esc(c.legal_rep)}</td>
        <td class="nowrap">${esc(c.province)}</td>
        <td class="small">${contact || '<span class="muted">—</span>'}</td>
        <td><span class="tag ${s.cls}">${esc(s.label)}</span>${c.status === "ended" && c.ended_year ? `<br><span class="muted small">${esc(c.ended_year)}</span>` : ""}</td>
      </tr>`;
    }).join("") + (list.length === 0 && state.companies.length ? `<tr><td colspan="8" class="muted center">Không có doanh nghiệp nào phù hợp.</td></tr>` : "");
  }

  const C_TEXT = ["tax_code", "name", "short_name", "en_name", "legal_rep", "company_type", "address", "province", "website", "phone", "fax", "email", "training_facility",
    "training_address", "staff_list", "deposit_bank", "deposit_account", "deposit_ref",
    "license_number", "first_license_number", "nd38_times", "law69_number", "adjust_times", "ds101", "note", "ended_year", "ended_type", "ended_reason", "ended_ref"];
  const C_DATE = ["license_date", "first_license_date", "nd38_date", "law69_date", "adjust_date", "deposit_date"];
  const C_NUM = ["charter_capital", "deposit_amount"];

  // Vốn điều lệ: chấp nhận "20000000000", "20.000.000.000", "20 tỷ", "500 triệu"
  const parseVnd = (v) => {
    const raw = String(v ?? "").trim();
    if (!raw) return null;
    const n = Number(raw.replace(/[^\d]/g, ""));
    if (!n) return null;
    const kh = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); // bo dau de nhan "ty" / "tỷ"
    if (/(^|[^a-z])(ty|ti)([^a-z]|$)/.test(kh) && n < 1e6) return n * 1e9;
    if (/(^|[^a-z])(trieu|tr)([^a-z]|$)/.test(kh) && n < 1e6) return n * 1e6;
    return n;
  };
  const fmtVnd = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("vi-VN") + " đồng");
  const countStaff = (t) => String(t || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).length;

  function openCompany(id, prefill) {
    const c = id ? state.companies.find((x) => x.id === id) : null;
    const dlg = $("#company-dialog");
    $("#company-dialog-title").textContent = c ? c.name : "Thêm doanh nghiệp";
    $("#c-id").value = c?.id || "";
    C_TEXT.concat(C_DATE).forEach((k) => ($("#c-" + k).value = c?.[k] ?? prefill?.[k] ?? ""));
    C_NUM.forEach((k) => ($("#c-" + k).value = c?.[k] ?? prefill?.[k] ?? ""));
    $("#c-status-f").value = c?.status || "active";
    syncCompanyHints();
    const canEdit = isLead();
    $$(".lead-field", dlg).forEach((el) => (el.disabled = !canEdit));
    $("#save-company-btn").hidden = !canEdit;
    $("#delete-company-btn").hidden = !(canEdit && c);

    // Các tab lịch sử chỉ có nghĩa với doanh nghiệp đã lưu
    state.cur = c;
    state.sub = { reps: [], facilities: [], violations: [], inspections: [], events: [] };
    state.tfilter = "all";
    $$("#company-tabs .ctab").forEach((b) => (b.hidden = !c && b.dataset.ctab !== "info"));
    $("#c-docref-box").hidden = !(c && canEdit);
    ["c-ev-doc_number", "c-ev-doc_date", "c-ev-note"].forEach((k) => ($("#" + k).value = ""));
    fillEventDocList(c);
    showCompanyTab("info");
    renderCompanyPanes();
    dlg.showModal();
    if (c) loadCompanySubs(c.id);
  }

  function companyPayload() {
    const p = {};
    C_TEXT.forEach((k) => (p[k] = $("#c-" + k).value.trim() || null));
    C_DATE.forEach((k) => (p[k] = $("#c-" + k).value || null));
    C_NUM.forEach((k) => (p[k] = parseVnd($("#c-" + k).value)));
    p.tax_code = normTax(p.tax_code) || null;
    p.status = $("#c-status-f").value;
    return p;
  }

  // Hiện số tiền đã chuẩn hóa và đếm số nhân viên nghiệp vụ ngay dưới ô nhập
  function syncCompanyHints() {
    const cap = parseVnd($("#c-charter_capital").value);
    const h1 = $("#c-capital-hint");
    h1.textContent = cap ? "= " + fmtVnd(cap) : "";
    h1.hidden = !cap;
    const dep = parseVnd($("#c-deposit_amount").value);
    const hd = $("#c-deposit-hint");
    hd.textContent = dep ? "= " + fmtVnd(dep) : "";
    hd.hidden = !dep;
    const n = countStaff($("#c-staff_list").value);
    const h2 = $("#c-staff-hint");
    h2.textContent = n ? n + " nhân viên nghiệp vụ" : "";
    h2.hidden = !n;
  }

  async function saveCompany(e) {
    e.preventDefault();
    const id = $("#c-id").value;
    const payload = companyPayload();
    if (payload.tax_code && state.companies.some((x) => x.tax_code === payload.tax_code && String(x.id) !== id)) { toast("Mã số DN này đã có trong danh sách", true); return; }
    // Chụp bản sao trước khi lưu — không giữ tham chiếu, vì dòng dữ liệu có thể bị ghi đè ngay khi lưu
    const found = id ? state.companies.find((x) => String(x.id) === id) : null;
    const before = found ? { ...found } : null;
    $("#save-company-btn").disabled = true;
    const q = id
      ? state.sb.from("companies").update(payload).eq("id", id).select("id").single()
      : state.sb.from("companies").insert(payload).select("id").single();
    const { data, error } = await q;
    $("#save-company-btn").disabled = false;
    if (error) { toast(error.message, true); return; }
    // Ghi nhật ký thay đổi kèm căn cứ (văn bản đến) để tra cứu về sau
    const newId = data?.id || id;
    const ref = docRef();
    let n = 0;
    if (id) n = await logCompanyChanges(newId, before, payload, ref);
    else if (newId) await state.sb.from("company_events").insert({
      company_id: newId, event_date: ref.doc_date || todayISO(), kind: "manual", source: "manual",
      field: "other", title: "Tạo hồ sơ doanh nghiệp", doc_number: ref.doc_number, doc_date: ref.doc_date, note: ref.note,
    });
    toast(id ? (n ? `Đã lưu · ghi ${n} thay đổi vào lịch sử` : "Đã lưu") : "Đã thêm doanh nghiệp");
    $("#company-dialog").close();
    await loadAll();
  }

  async function deleteCompany() {
    const id = $("#c-id").value;
    if (!id || !confirm("Xóa doanh nghiệp này khỏi danh sách?\n\nToàn bộ lịch sử của hồ sơ (người đại diện, cơ sở đào tạo, xử phạt VPHC, thanh tra/kiểm tra, nhật ký thay đổi) sẽ bị xóa theo và KHÔNG khôi phục được.\nHồ sơ giấy phép và văn bản đã có không bị xóa.")) return;
    const { error } = await state.sb.from("companies").delete().eq("id", id);
    if (error) { toast(error.message, true); return; }
    toast("Đã xóa"); $("#company-dialog").close(); await loadAll();
  }

  function exportCompaniesCSV() {
    const rows = sortCompanies(filteredCompanies());
    const cols = CFIELDS.map((f) => f.key);
    const head = CFIELDS.map((f) => f.label).concat(["Trạng thái"]);
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(",")].concat(rows.map((c) => cols.map((k) => (C_DATE.includes(k) ? fmtDate(c[k]) : c[k])).concat([fmtCompanyStatus(c).label]).map(cell).join(",")));
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `phapche-doanhnghiep-${todayISO()}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ---- Cấu hình cho từng tab có thể nhập từ Excel ----
  // Khớp tên chuyên viên trong file với tài khoản đã có (bỏ dấu, bỏ phần chức danh sau dấu "-")
  const deAccent = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  function personId(v) {
    const raw = deAccent(v).split(" - ")[0];
    if (!raw) return null;
    const hit = state.profiles.find((p) => deAccent(p.full_name) === raw)
      || state.profiles.find((p) => deAccent(p.email).split("@")[0] === raw)
      || state.profiles.find((p) => deAccent(p.full_name).endsWith(" " + raw) || deAccent(p.full_name).startsWith(raw + " "));
    return hit ? hit.id : null;
  }
  const byLabel = (list, v, fallback) => {
    const t = deAccent(v);
    const hit = list.find((x) => deAccent(x.label) === t) || list.find((x) => x.value === String(v || "").trim());
    return hit ? hit.value : fallback;
  };
  const CONV = {
    date: (v) => excelDate(v),
    person: (v) => personId(cellText(v)),
    int: (v) => { const n = parseInt(String(cellText(v)).replace(/[^\d-]/g, ""), 10); return isNaN(n) ? null : Math.max(0, Math.min(100, n)); },
    status: (v) => byLabel(Object.entries(STATUS).map(([value, label]) => ({ value, label })), v, "new"),
    lstatus: (v) => byLabel(LSTAT, v, LSTAT[0]?.value || "received"),
    priority: (v) => (/khan|urgent/i.test(deAccent(v)) ? "urgent" : "normal"),
    category: (v) => cellText(v) || "Văn bản đến",
  };
  const IMP_MODES = {
    companies: {
      title: "Nhập doanh nghiệp từ Excel", table: "companies", fields: () => CFIELDS, view: "companies",
      unit: "doanh nghiệp", required: "name", requiredLabel: "Tên công ty", useStatusSelect: true,
      hint: 'Chọn file .xlsx / .csv (tiêu đề cột ở dòng đầu). Dòng trùng <b>mã số DN</b> (hoặc cùng tên + số GP) sẽ được cập nhật, còn lại thêm mới.',
      keyOf: (o) => (validTax(o.tax_code) ? o.tax_code : "N:" + (o.name || "").toLowerCase()),
      match: (o) => {
        if (validTax(o.tax_code)) { const hit = state.companies.find((c) => c.tax_code === o.tax_code); if (hit) return hit; }
        const n = (o.name || "").toLowerCase().replace(/\s+/g, " ");
        const gp = (x) => String(x || "").replace(/\D/g, "");
        return state.companies.find((c) => (c.name || "").toLowerCase().replace(/\s+/g, " ") === n && gp(c.license_number) === gp(o.license_number)) || null;
      },
    },
    tasks: {
      title: "Nhập văn bản / công việc từ Excel", table: "tasks", fields: () => TFIELDS, view: "tasks",
      unit: "văn bản", required: "content", requiredLabel: "Nội dung / Trích yếu", useStatusSelect: false,
      defaults: { category: "Văn bản đến", status: "new", progress: 0, priority: "normal" },
      hint: 'Chọn file .xlsx / .csv xuất ra từ nút <b>⬇ Xuất Excel (CSV)</b>, hoặc file theo dõi của phòng. Tên chuyên viên ở cột Phụ trách được khớp với tài khoản đã có; không khớp thì để trống, giao lại sau.',
      keyOf: (o) => (o.doc_number || "") + "|" + (o.content || "").slice(0, 60).toLowerCase(),
      match: (o) => (o.doc_number ? state.tasks.find((t) => t.doc_number && t.doc_number === o.doc_number) || null : null),
    },
    licenses: {
      title: "Nhập hồ sơ Giấy phép từ Excel", table: "licenses", fields: () => LFIELDS, view: "licenses",
      unit: "hồ sơ", required: "company_name", requiredLabel: "Tên doanh nghiệp", useStatusSelect: false,
      defaults: { procedure: "Cấp mới", status: LSTAT[0]?.value || "received" },
      hint: 'Chọn file .xlsx / .csv xuất ra từ nút <b>⬇ Xuất Excel (CSV)</b>. Dòng trùng <b>số hồ sơ</b> sẽ được cập nhật.',
      keyOf: (o) => (o.file_number || "") + "|" + (o.company_name || "").toLowerCase(),
      match: (o) => (o.file_number ? state.licenses.find((l) => l.file_number && l.file_number === o.file_number) || null : null),
    },
  };
  const impMode = () => IMP_MODES[imp.mode] || IMP_MODES.companies;
  const impFields = () => impMode().fields();

  // ---- Nhập từ Excel ----
  const imp = { wb: null, rows: [], headers: [], map: [], mode: "companies" };

  function excelDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
    if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) {
      const n = +v; if (n < 20000 || n > 80000) return null;                 // ngoài khoảng ngày Excel hợp lý
      return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
    }
    const m = String(v).trim().match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const iso = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? iso[0] : null;
  }
  const cellText = (v) => (v == null ? "" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v)) : String(v).trim());

  function openImport(mode = "companies") {
    imp.mode = mode;
    imp.wb = null; imp.rows = []; imp.headers = []; imp.map = [];
    const M = impMode();
    $("#import-title").textContent = M.title;
    $("#imp-hint").innerHTML = M.hint;
    $("#imp-file").value = "";
    ["#imp-sheet", "#imp-status", "#imp-map-wrap", "#imp-summary", "#imp-preview-wrap", "#imp-error"].forEach((s) => ($(s).hidden = true));
    $("#imp-progress").textContent = ""; $("#imp-run-btn").disabled = true;
    $("#import-dialog").showModal();
  }

  async function importFileChosen(e) {
    const file = e.target.files[0]; if (!file) return;
    if (!window.XLSX) { showImpError("Thư viện đọc Excel chưa tải xong (cần kết nối Internet). Thử lại sau vài giây."); return; }
    try {
      // File .csv phải đọc thành chuỗi UTF-8 trước; đưa thẳng byte cho thư viện sẽ bị hiểu là latin1 → vỡ tiếng Việt
      if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
        let text = await file.text();
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);          // bo dau BOM o dau file
        // raw: giữ nguyên dạng chữ, không để thư viện tự hiểu "01/09/2026" theo kiểu Mỹ (tháng/ngày)
        imp.wb = XLSX.read(text, { type: "string", raw: true, cellDates: false });
      } else {
        const buf = await file.arrayBuffer();
        imp.wb = XLSX.read(buf, { type: "array", cellDates: false });
      }
    } catch (err) { showImpError("Không đọc được file: " + err.message); return; }
    const sel = $("#imp-sheet");
    sel.innerHTML = imp.wb.SheetNames.map((n) => `<option>${esc(n)}</option>`).join("");
    sel.hidden = imp.wb.SheetNames.length < 2;
    $("#imp-status").hidden = !impMode().useStatusSelect;
    loadSheet();
  }

  function loadSheet() {
    if (!imp.wb) return;
    const name = $("#imp-sheet").value || imp.wb.SheetNames[0];
    if (impMode().useStatusSelect) $("#imp-status").value = /thu h|nộp lại|nop lai|chấm dứt/i.test(name) ? "ended" : "active";
    const aoa = XLSX.utils.sheet_to_json(imp.wb.Sheets[name], { header: 1, raw: true, defval: null });
    const headerRow = aoa.findIndex((r) => r.filter((x) => x != null && String(x).trim()).length >= 3);
    if (headerRow < 0) { showImpError("Không tìm thấy dòng tiêu đề."); return; }
    imp.headers = aoa[headerRow].map((h) => cellText(h).replace(/\s+/g, " "));
    imp.rows = aoa.slice(headerRow + 1).filter((r) => r.some((x) => x != null && String(x).trim()));
    // Tự nhận diện cột theo tiêu đề; mỗi trường chỉ gán cho cột đầu tiên khớp (trừ ended_type có thể nhiều cột)
    const used = new Set();
    const sampleOf = (i) => imp.rows.map((r) => cellText(r[i])).filter(Boolean).slice(0, 80);
    // Cột không có tiêu đề: đoán theo nội dung (người đại diện "…- GĐ", địa chỉ "phường/quận…", văn bản "Cv …/BNV")
    const guessByContent = (i) => {
      if (imp.mode !== "companies") return "";
      const smp = sampleOf(i); if (smp.length < 3) return "";
      const share = (re) => smp.filter((v) => re.test(v)).length / smp.length;
      if (!used.has("legal_rep") && share(/(GĐ|TGĐ|PGĐ|giám đốc|chủ tịch)/i) > 0.3) return "legal_rep";
      if (!used.has("address") && share(/phường|quận|huyện|đường|phố|thành phố|tỉnh/i) > 0.5) return "address";
      if (!used.has("fax") && used.has("phone") && share(/^[\d.,\/\s()+-]+$/) > 0.8) return "fax";
      if (!used.has("ended_ref") && share(/(cv|công văn|quyết định|qđ)|\/[A-ZĐ]{2,}/i) > 0.5) return "ended_ref";
      return "";
    };
    imp.map = imp.headers.map((h, i) => {
      const f = h ? impFields().find((f) => f.match.test(h) && (!used.has(f.key) || f.key === "ended_type")) : null;
      const key = f ? f.key : guessByContent(i);
      if (key) used.add(key);
      return key;
    });
    const opts = `<option value="">— Bỏ qua —</option>` + impFields().map((f) => `<option value="${f.key}">${esc(f.label)}</option>`).join("");
    $("#imp-map tbody").innerHTML = imp.headers.map((h, i) => {
      const sample = sampleOf(i).slice(0, 3).join(" | ");
      if (!h && !sample) return "";
      return `<tr><td>${esc(h) || `<span class="muted">(cột ${XLSX.utils.encode_col(i)} không có tiêu đề)</span>`}</td><td class="sample" title="${esc(sample)}">${esc(sample)}</td><td><select data-col="${i}">${opts}</select></td></tr>`;
    }).join("");
    $$("#imp-map select").forEach((s) => { s.value = imp.map[+s.dataset.col]; s.addEventListener("change", () => { imp.map[+s.dataset.col] = s.value; buildPreview(); }); });
    $("#imp-map-wrap").hidden = false; $("#imp-error").hidden = true;
    buildPreview();
  }

  function importRows() {
    const M = impMode(), F = impFields();
    const base = M.useStatusSelect ? { status: $("#imp-status").value } : {};
    return imp.rows.map((r) => {
      const o = { ...base };
      imp.map.forEach((k, i) => {
        if (!k) return;
        const raw = r[i]; if (raw == null || String(raw).trim() === "") return;
        const f = F.find((f) => f.key === k);
        const conv = f?.conv || (f?.date ? "date" : f?.num ? "vnd" : "");
        if (conv === "vnd") { o[k] = o[k] ?? parseVnd(cellText(raw)); return; }
        if (conv && CONV[conv]) { const v = CONV[conv](raw); if (v != null && v !== "") o[k] = o[k] ?? v; return; }
        let v = cellText(raw);
        if (v === "") return;
        if (!["address", "training_facility", "training_address", "staff_list", "content", "progress_note", "result", "note"].includes(k)) v = v.replace(/\s*\n+\s*/g, " / ");
        o[k] = o[k] ? o[k] + " / " + v : v;                                 // 2 cột cùng trường → ghép
      });
      if (o.tax_code) o.tax_code = normTax(o.tax_code);
      return o;
    }).filter((o) => o[M.required]);
  }

  const matchExisting = (o) => impMode().match(o);

  function buildPreview() {
    const M = impMode(), rows = importRows();
    const cols = impFields().filter((f) => imp.map.includes(f.key));
    if (!imp.map.includes(M.required)) { showImpError(`Cần chọn cột nào là "${M.requiredLabel}".`); $("#imp-run-btn").disabled = true; return; }
    $("#imp-error").hidden = true;
    const upd = rows.filter(matchExisting).length;
    const noPerson = imp.map.includes("handler1") ? rows.filter((o) => !o.handler1).length : 0;
    const badTax = rows.filter((o) => o.tax_code && !validTax(o.tax_code)).length;
    const noTax = M.table === "companies" ? rows.filter((o) => !o.tax_code).length : 0;
    $("#imp-summary").hidden = false;
    $("#imp-summary").innerHTML = `<b>${rows.length}</b> ${esc(M.unit)} sẽ được nhập: <b>${rows.length - upd}</b> thêm mới, <b>${upd}</b> cập nhật (đã có).` +
      (noTax ? ` <span class="due warn">${noTax} dòng không có mã số DN</span>` : "") +
      (badTax ? ` <span class="due warn">${badTax} mã số không đúng định dạng (vẫn nhập, cần sửa sau)</span>` : "") +
      (noPerson ? ` <span class="due warn">${noPerson} dòng chưa khớp được tên Phụ trách mức 1 với tài khoản nào — sẽ để trống, giao lại trong app</span>` : "");
    const show = (f, o) => {
      const v = o[f.key];
      if (v == null || v === "") return "";
      if (f.conv === "date" || f.date) return fmtDate(v);
      if (f.conv === "person") return nameOf(v);
      if (f.conv === "status") return STATUS[v] || v;
      if (f.conv === "lstatus") return LSTAT_MAP[v]?.label || v;
      if (f.conv === "priority") return v === "urgent" ? "Khẩn" : "Bình thường";
      if (f.num) return fmtVnd(v);
      return v;
    };
    $("#imp-preview thead").innerHTML = `<tr><th>#</th>${cols.map((f) => `<th>${esc(f.label)}</th>`).join("")}<th>Kết quả</th></tr>`;
    $("#imp-preview tbody").innerHTML = rows.slice(0, 8).map((o, i) => `<tr class="${o.tax_code && !validTax(o.tax_code) ? "warn" : ""}"><td>${i + 1}</td>${cols.map((f) => `<td title="${esc(show(f, o))}">${esc(show(f, o))}</td>`).join("")}<td>${matchExisting(o) ? "Cập nhật" : "Thêm mới"}</td></tr>`).join("") +
      (rows.length > 8 ? `<tr><td colspan="${cols.length + 2}" class="muted center">… và ${rows.length - 8} dòng nữa</td></tr>` : "");
    $("#imp-preview-wrap").hidden = false;
    $("#imp-run-btn").disabled = rows.length === 0;
  }

  async function runImport() {
    const M = impMode();
    const rows = importRows(); if (!rows.length) return;
    const btn = $("#imp-run-btn"); btn.disabled = true;
    const prog = (t) => ($("#imp-progress").textContent = t);
    const inserts = [], updates = [];
    const seen = new Set();
    rows.forEach((o) => {
      const key = M.keyOf(o);
      if (seen.has(key)) return; seen.add(key);                             // trùng trong cùng file → lấy dòng đầu
      const hit = matchExisting(o);
      if (hit) updates.push({ id: hit.id, data: o });
      else inserts.push({ ...(M.defaults || {}), ...o });                 // mac dinh chi ap cho dong them moi
    });
    let done = 0, failed = 0; const total = inserts.length + updates.length;
    for (let i = 0; i < inserts.length; i += 100) {
      const { error } = await state.sb.from(M.table).insert(inserts.slice(i, i + 100));
      if (error) { failed += Math.min(100, inserts.length - i); showImpError("Lỗi khi thêm: " + error.message); } else done += Math.min(100, inserts.length - i);
      prog(`Đang nhập… ${done}/${total}`);
    }
    for (let i = 0; i < updates.length; i += 20) {
      const res = await Promise.all(updates.slice(i, i + 20).map((u) => state.sb.from(M.table).update(u.data).eq("id", u.id)));
      res.forEach((r) => (r.error ? failed++ : done++));
      prog(`Đang nhập… ${done}/${total}`);
    }
    prog(`Xong: ${done} thành công${failed ? `, ${failed} lỗi` : ""}`);
    toast(`Đã nhập ${done} ${M.unit}${failed ? `, ${failed} lỗi` : ""}`, failed > 0);
    await loadAll();
    btn.disabled = false;
    if (!failed) { $("#import-dialog").close(); switchView(M.view); }
  }

  // ---------- Modal văn bản ----------
  async function openTask(id) {
    const t = id ? state.tasks.find((x) => x.id === id) : null;
    const dlg = $("#task-dialog");
    $("#task-dialog-title").textContent = t ? `Văn bản ${t.doc_number || "#" + t.id}` : "Thêm văn bản / công việc";
    $("#t-id").value = t?.id || "";
    $("#t-doc_number").value = t?.doc_number || "";
    $("#t-doc_date").value = t?.doc_date || "";
    $("#t-received_date").value = t?.received_date || todayISO();
    $("#t-sender").value = t?.sender || "";
    $("#t-category").value = normCat(t?.category) || "Văn bản đến";
    $("#t-biz_type").value = t?.biz_type || BIZ_TASK_TYPES[0] || "";
    $("#t-tax_code").value = t?.tax_code || "";
    syncBizFields();
    taskCompanyLookup(false);
    $("#t-priority").value = t?.priority || "normal";
    $("#t-content").value = t?.content || "";
    $("#t-deadline").value = t?.deadline || "";
    $("#t-handler1").value = t?.handler1 || "";
    $("#t-handler2").value = t?.handler2 || "";
    $("#t-status").value = t?.status || "new";
    $("#t-progress").value = t?.progress ?? 0;
    $("#t-progress-val").textContent = (t?.progress ?? 0) + "%";
    $("#t-progress_note").value = t?.progress_note || "";
    $("#t-result").value = t?.result || "";

    const canEditAll = isLead();
    const canEditProgress = canEditAll || (t && mine(t));
    $$(".lead-field", dlg).forEach((el) => (el.disabled = !canEditAll));
    ["#t-status", "#t-progress", "#t-progress_note", "#t-result"].forEach((s) => ($(s).disabled = !canEditProgress));
    $("#save-task-btn").hidden = !canEditProgress;
    $("#delete-task-btn").hidden = !(canEditAll && t);

    $("#task-history").hidden = !t;
    if (t) {
      $("#history-list").innerHTML = `<li class="muted">Đang tải…</li>`;
      const { data } = await state.sb.from("task_logs").select("*").eq("task_id", t.id).order("created_at", { ascending: false });
      $("#history-list").innerHTML = (data || []).map((l) => `<li><span class="when">${fmtDateTime(l.created_at)}</span><span><span class="who">${esc(nameOf(l.user_id))}</span> · ${ACTION[l.action] || l.action}: ${esc(l.detail)}</span></li>`).join("") || `<li class="muted">Chưa có</li>`;
    }
    dlg.showModal();
  }

  // Loại việc "Doanh nghiệp" → hiện dropdown nội dung hồ sơ + ô Mã số doanh nghiệp
  const CAT_BIZ = "Doanh nghiệp";
  const CAT_UPDATE_BIZ = "Cập nhật thông tin doanh nghiệp"; // loại cũ (đã bỏ khỏi danh sách) → quy về "Doanh nghiệp"
  const normCat = (v) => (v === CAT_UPDATE_BIZ ? CAT_BIZ : v);
  function syncBizFields() {
    const cat = $("#t-category").value;
    $("#t-biz_type-wrap").hidden = cat !== CAT_BIZ;
    $("#t-biz_type").required = cat === CAT_BIZ;
    const show = cat === CAT_BIZ;
    $("#t-tax_code-wrap").hidden = !show;
    $("#t-tax_code").required = show;
    if (!show) { $("#t-company-info").hidden = true; $("#t-company-info").innerHTML = ""; }
  }

  // Gõ mã số DN đã có trên hệ thống → hiện tên doanh nghiệp (đầy đủ / viết tắt / tiếng Anh)
  // và tự điền ô Cơ quan gửi nếu đang trống. commit = true → chuẩn hóa luôn mã số vừa gõ.
  function taskCompanyLookup(commit) {
    const box = $("#t-company-info");
    const code = normTax($("#t-tax_code").value);
    const c = code ? state.companies.find((x) => normTax(x.tax_code) === code) : null;
    const name = c ? c.name : code ? companyDir().get(code) : "";
    if (!c && !name) { box.hidden = true; box.innerHTML = ""; return; }
    if (commit && code) $("#t-tax_code").value = code;
    const rows = [["Tên đầy đủ", name], ["Tên viết tắt", c?.short_name], ["Tên tiếng Anh", c?.en_name]].filter(([, v]) => v);
    box.innerHTML = rows.map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join("")
      + (c ? "" : `<span class="muted">Chưa có trong tab Doanh nghiệp — tên lấy từ hồ sơ đã nhập</span>`);
    box.hidden = false;
    if (name && !$("#t-sender").value.trim()) $("#t-sender").value = name;
  }

  async function saveTask(e) {
    e.preventDefault();
    const id = $("#t-id").value;
    const payload = {
      status: $("#t-status").value,
      progress: +$("#t-progress").value,
      progress_note: $("#t-progress_note").value.trim() || null,
      result: $("#t-result").value.trim() || null,
    };
    if (isLead()) Object.assign(payload, {
      doc_number: $("#t-doc_number").value.trim() || null,
      doc_date: $("#t-doc_date").value || null,
      received_date: $("#t-received_date").value || null,
      sender: $("#t-sender").value.trim() || null,
      category: $("#t-category").value,
      biz_type: $("#t-category").value === CAT_BIZ ? $("#t-biz_type").value || null : null,
      tax_code: $("#t-category").value === CAT_BIZ ? $("#t-tax_code").value.trim() || null : null,
      priority: $("#t-priority").value,
      content: $("#t-content").value.trim(),
      deadline: $("#t-deadline").value || null,
      handler1: $("#t-handler1").value || null,
      handler2: $("#t-handler2").value || null,
    });
    if (payload.handler1 && payload.handler1 === payload.handler2) { toast("Phụ trách mức 1 và mức 2 không được trùng nhau", true); return; }
    $("#save-task-btn").disabled = true;
    const q = id ? state.sb.from("tasks").update(payload).eq("id", id) : state.sb.from("tasks").insert(payload);
    const { error } = await q;
    $("#save-task-btn").disabled = false;
    if (error) { toast(error.message, true); return; }
    toast(id ? "Đã lưu" : "Đã thêm văn bản");
    $("#task-dialog").close();
    await loadAll();
  }

  async function deleteTask() {
    const id = $("#t-id").value;
    if (!id || !confirm("Xóa văn bản này? Không thể hoàn tác.")) return;
    const { error } = await state.sb.from("tasks").delete().eq("id", id);
    if (error) { toast(error.message, true); return; }
    toast("Đã xóa"); $("#task-dialog").close(); await loadAll();
  }

  // ---------- Modal chuyên viên ----------
  function openStaff(id) {
    const p = id ? state.profiles.find((x) => x.id === id) : null;
    $("#staff-dialog-title").textContent = p ? "Sửa chuyên viên" : "Thêm chuyên viên";
    $("#s-id").value = p?.id || "";
    $("#s-name").value = p?.full_name || "";
    $("#s-email").value = p?.email || "";
    $("#s-email").disabled = !!p;
    $("#s-pass-wrap").hidden = !!p;
    $("#s-password").required = !p;
    $("#s-role").value = p?.role || "staff";
    $("#s-active").checked = p ? p.active : true;
    $("#staff-error").hidden = true;
    $("#staff-dialog").showModal();
  }

  async function saveStaff(e) {
    e.preventDefault();
    const id = $("#s-id").value;
    const full_name = $("#s-name").value.trim(), role = $("#s-role").value, active = $("#s-active").checked;
    let error;
    if (id) {
      ({ error } = await state.sb.from("profiles").update({ full_name, role, active }).eq("id", id));
    } else {
      // Tạo tài khoản bằng client phụ để không làm mất phiên đăng nhập của Trưởng phòng
      const tmp = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const res = await tmp.auth.signUp({ email: $("#s-email").value.trim(), password: $("#s-password").value, options: { data: { full_name, role } } });
      error = res.error;
      if (!error && res.data.user && !res.data.session) toast("Đã tạo. Nếu bật xác nhận email, chuyên viên cần bấm link trong email trước khi đăng nhập.");
    }
    if (error) { $("#staff-error").textContent = error.message; $("#staff-error").hidden = false; return; }
    toast("Đã lưu"); $("#staff-dialog").close();
    setTimeout(loadAll, 600); // chờ trigger tạo profile
  }

  // ---------- Xuất CSV ----------
  function exportCSV() {
    const rows = sortTasks(filteredTasks());
    const head = ["Số VB", "Ngày VB", "Ngày đến", "Cơ quan gửi", "Loại việc", "Nội dung hồ sơ DN", "Mã số DN", "Nội dung", "Thời hạn", "Phụ trách 1", "Phụ trách 2", "Trạng thái", "Tiến độ %", "Ghi chú tiến độ", "Kết quả", "Mức độ"];
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(",")].concat(rows.map((t) => [
      t.doc_number, fmtDate(t.doc_date), fmtDate(t.received_date), t.sender, t.category, t.biz_type, t.tax_code, t.content, fmtDate(t.deadline),
      nameOf(t.handler1), t.handler2 ? nameOf(t.handler2) : "", STATUS[t.status], t.progress, t.progress_note, t.result, t.priority === "urgent" ? "Khẩn" : "",
    ].map(cell).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `phapche-congviec-${todayISO()}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- Gắn sự kiện ----------
  function bindUI() {
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      $("#login-btn").disabled = true; $("#login-error").hidden = true;
      const { error } = await state.sb.auth.signInWithPassword({ email: $("#login-email").value.trim(), password: $("#login-password").value });
      $("#login-btn").disabled = false;
      if (error) { $("#login-error").textContent = "Sai email hoặc mật khẩu."; $("#login-error").hidden = false; }
    });
    $("#forgot-btn").addEventListener("click", async () => {
      const email = $("#login-email").value.trim();
      if (!email) { toast("Nhập email trước", true); return; }
      const { error } = await state.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
      toast(error ? error.message : "Đã gửi email đặt lại mật khẩu", !!error);
    });
    $("#logout-btn").addEventListener("click", () => state.sb.auth.signOut());
    $("#change-pass-btn").addEventListener("click", () => $("#pass-dialog").showModal());
    $("#pass-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if ($("#p-new").value !== $("#p-new2").value) { $("#pass-error").textContent = "Mật khẩu nhập lại không khớp"; $("#pass-error").hidden = false; return; }
      const { error } = await state.sb.auth.updateUser({ password: $("#p-new").value });
      if (error) { $("#pass-error").textContent = error.message; $("#pass-error").hidden = false; return; }
      toast("Đã đổi mật khẩu"); $("#pass-dialog").close(); $("#pass-form").reset();
    });

    $$("#tabs button").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
    ["#f-search", "#f-status", "#f-handler", "#f-due"].forEach((s) => $(s).addEventListener("input", renderTasks));
    $$("#tasks-table th[data-sort]").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.sort;
      state.sort = { key: k, dir: state.sort.key === k && state.sort.dir === "asc" ? "desc" : "asc" };
      renderTasks();
    }));
    $("#tasks-body").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) openTask(+tr.dataset.id); });
    document.addEventListener("click", (e) => {
      const li = e.target.closest(".list-item[data-id]");
      if (li) (li.dataset.kind === "license" ? openLicense : openTask)(+li.dataset.id);
    });

    // Hồ sơ giấy phép
    fillLicenseSelects();
    ["#l-search", "#l-status", "#l-procedure", "#l-handler"].forEach((s) => $(s).addEventListener("input", () => { state.lDue = ""; renderLicenses(); }));
    $$("#licenses-table th[data-sort]").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.sort;
      state.lsort = { key: k, dir: state.lsort.key === k && state.lsort.dir === "asc" ? "desc" : "asc" };
      renderLicenses();
    }));
    $("#licenses-body").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) openLicense(+tr.dataset.id); });
    $("#add-license-btn").addEventListener("click", () => openLicense(null));
    $("#export-licenses-btn").addEventListener("click", exportLicensesCSV);
    $("#import-licenses-btn").addEventListener("click", () => openImport("licenses"));
    $("#license-form").addEventListener("submit", saveLicense);
    $("#delete-license-btn").addEventListener("click", deleteLicense);
    $("#l-swap-btn").addEventListener("click", () => { const a = $("#l-handler1"), b = $("#l-handler2"); [a.value, b.value] = [b.value, a.value]; });

    // Doanh nghiệp
    fillCompanyFilters();
    ["#c-search", "#c-status", "#cf-province", "#c-type"].forEach((s) => $(s).addEventListener("input", () => { state.cMissing = false; renderCompanies(); }));
    $$("#companies-table th[data-sort]").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.sort;
      state.csort = { key: k, dir: state.csort.key === k && state.csort.dir === "asc" ? "desc" : "asc" };
      renderCompanies();
    }));
    $("#companies-body").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) openCompany(+tr.dataset.id); });
    $("#add-company-btn").addEventListener("click", () => openCompany(null));
    $("#export-companies-btn").addEventListener("click", exportCompaniesCSV);
    ["#c-charter_capital", "#c-deposit_amount", "#c-staff_list"].forEach((sel) => $(sel).addEventListener("input", syncCompanyHints));
    $("#company-form").addEventListener("submit", saveCompany);
    $("#delete-company-btn").addEventListener("click", deleteCompany);
    wireCompanyProfile();
    $("#import-companies-btn").addEventListener("click", () => openImport("companies"));
    $("#imp-file").addEventListener("change", importFileChosen);
    $("#imp-sheet").addEventListener("change", loadSheet);
    $("#imp-status").addEventListener("change", buildPreview);
    $("#imp-run-btn").addEventListener("click", runImport);
    $("#add-task-btn").addEventListener("click", () => openTask(null));
    $("#import-tasks-btn").addEventListener("click", () => openImport("tasks"));
    $("#quick-add-task").addEventListener("click", () => openTask(null));
    $("#quick-add-license").addEventListener("click", () => openLicense(null));
    $("#export-btn").addEventListener("click", exportCSV);

    $("#task-form").addEventListener("submit", saveTask);
    $("#delete-task-btn").addEventListener("click", deleteTask);
    $("#t-biz_type").innerHTML = BIZ_TASK_TYPES.map((x) => `<option>${esc(x)}</option>`).join("");
    $("#t-category").addEventListener("change", syncBizFields);
    $("#t-tax_code").addEventListener("input", () => taskCompanyLookup(false));
    $("#t-tax_code").addEventListener("change", () => taskCompanyLookup(true));
    $("#t-progress").addEventListener("input", (e) => ($("#t-progress-val").textContent = e.target.value + "%"));
    $("#swap-btn").addEventListener("click", () => {
      const a = $("#t-handler1"), b = $("#t-handler2");
      [a.value, b.value] = [b.value, a.value];
    });

    $("#add-staff-btn").addEventListener("click", () => openStaff(null));
    $("#staff-body").addEventListener("click", (e) => { const b = e.target.closest("[data-edit]"); if (b) openStaff(b.dataset.edit); });
    $("#staff-form").addEventListener("submit", saveStaff);

    $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  }

  // =================================================================
  // HỒ SƠ DOANH NGHIỆP ĐẦY ĐỦ — các tab lịch sử
  // =================================================================
  const VCOMPLY = window.VIOLATION_COMPLY || [];
  const VCOMPLY_MAP = Object.fromEntries(VCOMPLY.map((s) => [s.value, s]));
  const INSPECTION_KINDS = window.INSPECTION_KINDS || [];
  const INSPECTION_RESULTS = window.INSPECTION_RESULTS || [];
  const FACILITY_OWN_TYPES = window.FACILITY_OWN_TYPES || [];
  const REP_TITLES = window.REP_TITLES || [];
  const TRACKED = window.TRACKED_COMPANY_FIELDS || [];
  const TGROUPS = window.TIMELINE_GROUPS || [];
  const CF_MAP = Object.fromEntries(CFIELDS.map((f) => [f.key, f]));

  // Cấu hình 5 bảng con: trường nào là chữ / ngày / số, để đọc và ghi form
  const SUBS = {
    reps: {
      table: "company_reps", dlg: "#rep-dialog", form: "#rep-form", pre: "r-", del: "#delete-rep-btn",
      title: "#rep-dialog-title", head: "Người đại diện theo pháp luật", body: "#reps-body",
      text: ["full_name", "title", "id_number", "id_place", "phone", "email", "doc_number", "note"],
      date: ["id_date", "from_date", "to_date", "doc_date"], num: [],
      order: (a, b) => (b.from_date || "").localeCompare(a.from_date || ""),
    },
    facilities: {
      table: "company_facilities", dlg: "#facility-dialog", form: "#facility-form", pre: "f-", del: "#delete-facility-btn",
      title: "#facility-dialog-title", head: "Cơ sở đào tạo", body: "#facilities-body",
      text: ["name", "address", "province", "own_type", "area", "capacity", "doc_number", "note"],
      date: ["from_date", "to_date", "doc_date"], num: [],
      order: (a, b) => (b.from_date || "").localeCompare(a.from_date || ""),
    },
    violations: {
      table: "company_violations", dlg: "#violation-dialog", form: "#violation-form", pre: "v-", del: "#delete-violation-btn",
      title: "#violation-dialog-title", head: "Xử phạt vi phạm hành chính", body: "#violations-body",
      text: ["decision_number", "issuer", "violation", "legal_basis", "extra_penalty", "remedy", "comply_status", "note"],
      date: ["decision_date", "comply_date"], num: ["fine_amount"],
      order: (a, b) => (b.decision_date || "").localeCompare(a.decision_date || ""),
    },
    inspections: {
      table: "company_inspections", dlg: "#inspection-dialog", form: "#inspection-form", pre: "i-", del: "#delete-inspection-btn",
      title: "#inspection-dialog-title", head: "Thanh tra / kiểm tra", body: "#inspections-body",
      text: ["kind", "decision_number", "agency", "scope", "conclusion_number", "conclusion", "result", "note"],
      date: ["decision_date", "from_date", "to_date", "conclusion_date"], num: [],
      order: (a, b) => (b.from_date || b.decision_date || "").localeCompare(a.from_date || a.decision_date || ""),
    },
    events: {
      table: "company_events", dlg: "#event-dialog", form: "#event-form", pre: "e-", del: "#delete-event-btn",
      title: "#event-dialog-title", head: "Mốc lịch sử", body: null,
      text: ["field", "title", "old_value", "new_value", "doc_number", "note"],
      date: ["event_date", "doc_date"], num: [],
      order: (a, b) => (b.event_date || "").localeCompare(a.event_date || ""),
      extra: { kind: "manual", source: "manual" },
    },
  };

  // Trường hồ sơ DN thuộc nhóm nào trên dòng thời gian
  function groupOfField(k) {
    if (!k) return "other";
    if (/^deposit_/.test(k)) return "deposit";
    if (k === "legal_rep") return "rep";
    if (/^training_/.test(k)) return "facility";
    if (k === "staff_list") return "staff";
    if (k === "charter_capital" || k === "address" || k === "province") return "capital";
    if (/license|nd38|law69|adjust|ds101|ended/.test(k)) return "license";
    return "other";
  }

  const subFields = (s) => s.text.concat(s.date, s.num);
  const valOf = (c, k) => { const el = $("#" + c.pre + k); return el ? el.value : ""; };

  // ---------- Mở / đóng tab trong hồ sơ DN ----------
  function showCompanyTab(name) {
    $$("#company-tabs .ctab").forEach((b) => b.classList.toggle("on", b.dataset.ctab === name));
    $$("#company-dialog .cpane").forEach((p) => (p.hidden = p.dataset.pane !== name));
  }

  // ---------- Nạp dữ liệu 5 bảng con của 1 doanh nghiệp ----------
  async function loadCompanySubs(companyId) {
    const names = Object.keys(SUBS);
    const res = await Promise.all(names.map((n) => state.sb.from(SUBS[n].table).select("*").eq("company_id", companyId)));
    names.forEach((n, i) => {
      if (res[i].error) { toast(res[i].error.message, true); return; }
      state.sub[n] = (res[i].data || []).sort(SUBS[n].order);
    });
    if (state.cur && state.cur.id === companyId) renderCompanyPanes();
  }

  // ---------- Vẽ lại toàn bộ các tab lịch sử ----------
  function renderCompanyPanes() {
    renderReps(); renderFacilities(); renderViolations(); renderInspections(); renderTimeline();
    const canEdit = isLead();
    $$("#company-dialog [data-add]").forEach((b) => (b.hidden = !canEdit || !state.cur));
  }

  const badgeActive = (to) => (to ? `<span class="tag cancelled">Đã kết thúc</span>` : `<span class="tag done">Đang hiệu lực</span>`);
  const period = (a, b) => `${fmtDate(a)} → ${b ? fmtDate(b) : "nay"}`;
  const docCell = (n, d) => (n || d ? esc(n || "") + (d ? `<div class="sender">${fmtDate(d)}</div>` : "") : "—");
  const rowBtns = (kind, id) => `<td class="right"><button type="button" class="btn ghost small" data-sub="${kind}" data-sub-id="${id}">Sửa</button></td>`;
  const emptyRow = (cols, msg) => `<tr><td colspan="${cols}" class="muted center">${msg}</td></tr>`;

  function setCount(name, n) {
    const el = $(`#company-tabs [data-cnt="${name}"]`);
    if (el) el.textContent = n ? n : "";
  }

  function renderReps() {
    const rows = state.sub.reps;
    setCount("reps", rows.length);
    $("#reps-body").innerHTML = rows.length ? rows.map((r) => `<tr>
      <td><b>${esc(r.full_name)}</b> ${badgeActive(r.to_date)}${r.phone || r.email ? `<div class="sender">${esc([r.phone, r.email].filter(Boolean).join(" · "))}</div>` : ""}</td>
      <td>${esc(r.title || "—")}</td>
      <td>${esc(r.id_number || "—")}${r.id_date ? `<div class="sender">${fmtDate(r.id_date)}${r.id_place ? " · " + esc(r.id_place) : ""}</div>` : ""}</td>
      <td>${period(r.from_date, r.to_date)}</td>
      <td>${docCell(r.doc_number, r.doc_date)}</td>
      ${rowBtns("reps", r.id)}</tr>`).join("")
      : emptyRow(6, "Chưa có người đại diện nào được ghi nhận");
  }

  function renderFacilities() {
    const rows = state.sub.facilities;
    setCount("facilities", rows.length);
    $("#facilities-body").innerHTML = rows.length ? rows.map((f) => `<tr>
      <td><b>${esc(f.name)}</b> ${badgeActive(f.to_date)}</td>
      <td>${esc(f.address || "—")}${f.province ? `<div class="sender">${esc(f.province)}</div>` : ""}</td>
      <td>${esc(f.own_type || "—")}</td>
      <td>${esc([f.area, f.capacity].filter(Boolean).join(" · ") || "—")}</td>
      <td>${period(f.from_date, f.to_date)}</td>
      <td>${docCell(f.doc_number, f.doc_date)}</td>
      ${rowBtns("facilities", f.id)}</tr>`).join("")
      : emptyRow(7, "Chưa có cơ sở đào tạo nào được ghi nhận");
  }

  function renderViolations() {
    const rows = state.sub.violations;
    setCount("violations", rows.length);
    const total = rows.reduce((s, v) => s + (v.fine_amount || 0), 0);
    const open = rows.filter((v) => !VCOMPLY_MAP[v.comply_status]?.final).length;
    $("#violations-sum").innerHTML = rows.length
      ? `${rows.length} quyết định · tổng phạt tiền <b>${esc(fmtVnd(total))}</b>${open ? ` · <b class="crit">${open} chưa chấp hành xong</b>` : " · đã chấp hành xong"}`
      : "Chưa ghi nhận vi phạm hành chính nào.";
    $("#violations-body").innerHTML = rows.length ? rows.map((v) => {
      const st = VCOMPLY_MAP[v.comply_status] || VCOMPLY[0];
      return `<tr>
      <td><b>${esc(v.decision_number || "—")}</b><div class="sender">${fmtDate(v.decision_date)}</div></td>
      <td>${esc(v.issuer || "—")}</td>
      <td class="content-cell">${esc(v.violation)}${v.legal_basis ? `<div class="sender">${esc(v.legal_basis)}</div>` : ""}${v.extra_penalty ? `<div class="sender">Bổ sung: ${esc(v.extra_penalty)}</div>` : ""}${v.remedy ? `<div class="sender">Khắc phục: ${esc(v.remedy)}</div>` : ""}</td>
      <td>${v.fine_amount ? esc(fmtVnd(v.fine_amount)) : "—"}</td>
      <td><span class="tag ${st?.cls || "new"}">${esc(st?.label || v.comply_status)}</span>${v.comply_date ? `<div class="sender">${fmtDate(v.comply_date)}</div>` : ""}</td>
      ${rowBtns("violations", v.id)}</tr>`;
    }).join("") : emptyRow(6, "Chưa có quyết định xử phạt nào");
  }

  function renderInspections() {
    const rows = state.sub.inspections;
    setCount("inspections", rows.length);
    $("#inspections-body").innerHTML = rows.length ? rows.map((i) => `<tr>
      <td><b>${esc(i.kind || "—")}</b>${i.decision_number ? `<div class="sender">${esc(i.decision_number)}</div>` : ""}</td>
      <td>${esc(i.agency || "—")}</td>
      <td>${i.from_date || i.to_date ? period(i.from_date, i.to_date) : fmtDate(i.decision_date)}</td>
      <td class="content-cell">${esc(i.scope || "—")}</td>
      <td class="content-cell">${esc(i.result || "—")}${i.conclusion_number ? `<div class="sender">KL ${esc(i.conclusion_number)} ngày ${fmtDate(i.conclusion_date)}</div>` : ""}${i.conclusion ? `<div class="sender">${esc(i.conclusion)}</div>` : ""}</td>
      ${rowBtns("inspections", i.id)}</tr>`).join("")
      : emptyRow(6, "Chưa có cuộc thanh tra / kiểm tra nào");
  }

  // ---------- Dòng thời gian tổng hợp ----------
  function timelineItems() {
    const c = state.cur;
    if (!c) return [];
    const out = [];
    state.sub.events.forEach((e) => {
      const g = e.kind === "manual" ? (e.field || "other") : groupOfField(e.field);
      const what = e.kind === "manual" ? esc(e.title || "") : `<b>${esc(e.field_label || e.field || "")}</b>`;
      const diff = e.old_value || e.new_value
        ? `<div class="diff"><span class="old">${esc(e.old_value || "(trống)")}</span> → <span class="new">${esc(e.new_value || "(trống)")}</span></div>` : "";
      out.push({ d: e.event_date, g, tag: e.kind === "manual" ? "Mốc lịch sử" : "Thay đổi",
        cls: "update", html: what + diff, doc: e.doc_number, docd: e.doc_date, note: e.note,
        who: e.created_by, at: e.created_at, edit: e.kind === "manual" ? { kind: "events", id: e.id } : null });
    });
    state.sub.violations.forEach((v) => out.push({ d: v.decision_date, g: "violation", tag: "Xử phạt VPHC", cls: "cancelled",
      html: `${esc(v.violation)}${v.fine_amount ? ` — phạt <b>${esc(fmtVnd(v.fine_amount))}</b>` : ""}`,
      doc: v.decision_number, docd: v.decision_date, note: v.issuer, edit: { kind: "violations", id: v.id } }));
    state.sub.inspections.forEach((i) => out.push({ d: i.from_date || i.decision_date, g: "inspection", tag: i.kind || "Kiểm tra", cls: "supplement",
      html: `${esc(i.scope || i.kind || "")}${i.result ? ` — ${esc(i.result)}` : ""}`,
      doc: i.decision_number, docd: i.decision_date, note: i.agency, edit: { kind: "inspections", id: i.id } }));
    state.sub.reps.forEach((r) => {
      out.push({ d: r.from_date, g: "rep", tag: "Người đại diện", cls: "done",
        html: `Bắt đầu: <b>${esc(r.full_name)}</b>${r.title ? " - " + esc(r.title) : ""}`,
        doc: r.doc_number, docd: r.doc_date, edit: { kind: "reps", id: r.id } });
      if (r.to_date) out.push({ d: r.to_date, g: "rep", tag: "Người đại diện", cls: "cancelled",
        html: `Kết thúc: <b>${esc(r.full_name)}</b>`, doc: r.doc_number, docd: r.doc_date, edit: { kind: "reps", id: r.id } });
    });
    state.sub.facilities.forEach((f) => {
      out.push({ d: f.from_date, g: "facility", tag: "Cơ sở đào tạo", cls: "done",
        html: `Đưa vào sử dụng: <b>${esc(f.name)}</b>`, doc: f.doc_number, docd: f.doc_date, edit: { kind: "facilities", id: f.id } });
      if (f.to_date) out.push({ d: f.to_date, g: "facility", tag: "Cơ sở đào tạo", cls: "cancelled",
        html: `Ngừng sử dụng: <b>${esc(f.name)}</b>`, doc: f.doc_number, docd: f.doc_date, edit: { kind: "facilities", id: f.id } });
    });
    if (c.tax_code) {
      state.tasks.filter((t) => t.tax_code === c.tax_code).forEach((t) => out.push({
        d: t.received_date || t.doc_date, g: "doc", tag: t.biz_type || t.category || "Văn bản đến", cls: "new",
        html: esc(t.content), doc: t.doc_number, docd: t.doc_date, note: t.sender,
        extra: `<span class="tag ${t.status}">${esc(statusLabel(t))}</span>${t.result ? " · " + esc(t.result) : ""}`,
        open: { kind: "task", id: t.id },
      }));
      state.licenses.filter((l) => l.tax_code === c.tax_code).forEach((l) => out.push({
        d: l.received_date, g: "license", tag: "Hồ sơ giấy phép", cls: "license",
        html: `${esc(l.procedure)}${l.license_number ? ` — GP số <b>${esc(l.license_number)}</b>` : ""}`,
        doc: l.file_number, docd: l.issued_date,
        extra: `<span class="tag ${LSTAT_MAP[l.status]?.cls || "new"}">${esc(statusLabel(l))}</span>`,
        open: { kind: "license", id: l.id },
      }));
    }
    return out.filter((x) => x.d || x.html).sort((a, b) => (b.d || "").localeCompare(a.d || ""));
  }

  function renderTimeline() {
    const items = timelineItems();
    setCount("history", items.length);
    const f = state.tfilter || "all";
    const has = new Set(items.map((x) => x.g));
    $("#timeline-filter").innerHTML = TGROUPS.filter((g) => g.key === "all" || has.has(g.key))
      .map((g) => `<button type="button" class="chip-btn${g.key === f ? " on" : ""}" data-tg="${g.key}">${esc(g.label)}</button>`).join("");
    const shown = f === "all" ? items : items.filter((x) => x.g === f);
    $("#company-timeline").innerHTML = shown.length ? shown.map((x) => `<li class="tl-item">
      <div class="tl-date">${fmtDate(x.d)}</div>
      <div class="tl-body">
        <div class="tl-top"><span class="tag ${x.cls}">${esc(x.tag)}</span>${x.extra || ""}</div>
        <div class="tl-main">${x.html}</div>
        ${x.doc || x.docd ? `<div class="sender">Văn bản: ${esc(x.doc || "")}${x.docd ? " ngày " + fmtDate(x.docd) : ""}</div>` : ""}
        ${x.note ? `<div class="sender">${esc(x.note)}</div>` : ""}
        ${x.at ? `<div class="sender">${esc(nameOf(x.who))} · ${fmtDateTime(x.at)}</div>` : ""}
      </div>
      <div class="tl-act">${x.open ? `<button type="button" class="btn ghost small" data-open="${x.open.kind}" data-open-id="${x.open.id}">Mở</button>`
        : x.edit && isLead() ? `<button type="button" class="btn ghost small" data-sub="${x.edit.kind}" data-sub-id="${x.edit.id}">Sửa</button>` : ""}</div>
    </li>`).join("") : `<li class="muted center">Chưa có dữ liệu trong nhóm này</li>`;
  }

  // ---------- Ghi nhật ký thay đổi khi lưu hồ sơ DN ----------
  const normVal = (v) => (v === null || v === undefined || v === "" ? "" : String(v));
  function labelOf(k) {
    if (k === "status") return "Trạng thái";
    return CF_MAP[k]?.label || k;
  }
  function docRef() {
    return { doc_number: $("#c-ev-doc_number").value.trim() || null, doc_date: $("#c-ev-doc_date").value || null, note: $("#c-ev-note").value.trim() || null };
  }
  async function logCompanyChanges(companyId, before, after, ref) {
    const rows = [];
    TRACKED.forEach((k) => {
      const o = normVal(before ? before[k] : ""), n = normVal(after[k]);
      if (o === n) return;
      rows.push({
        company_id: companyId, event_date: ref.doc_date || todayISO(), kind: "change",
        field: k, field_label: labelOf(k), old_value: o || null, new_value: n || null,
        doc_number: ref.doc_number, doc_date: ref.doc_date, note: ref.note, source: "auto",
      });
    });
    if (!rows.length) return 0;
    const { error } = await state.sb.from("company_events").insert(rows);
    if (error) { toast("Không ghi được lịch sử: " + error.message, true); return 0; }
    return rows.length;
  }

  // Gợi ý số văn bản đã có của chính doanh nghiệp này
  function fillEventDocList(c) {
    const list = c && c.tax_code ? state.tasks.filter((t) => t.tax_code === c.tax_code && t.doc_number) : [];
    $("#c-ev-doc-list").innerHTML = list.map((t) => `<option value="${esc(t.doc_number)}">${esc(t.content || "")}</option>`).join("");
  }

  // ---------- CRUD dùng chung cho 5 bảng con ----------
  function openSub(kind, id) {
    const s = SUBS[kind];
    if (!state.cur) { toast("Hãy lưu hồ sơ doanh nghiệp trước", true); return; }
    const rec = id ? state.sub[kind].find((x) => x.id === id) : null;
    $("#" + s.pre + "id").value = rec?.id || "";
    $("#" + s.pre + "company_id").value = state.cur.id;
    subFields(s).forEach((k) => {
      const el = $("#" + s.pre + k); if (!el) return;
      let v = rec ? rec[k] : "";
      if (v === null || v === undefined) v = "";
      if (s.date.includes(k) && v) v = String(v).slice(0, 10);
      el.value = v;
    });
    if (!rec) {
      if (kind === "events") $("#e-event_date").value = todayISO();
      if (kind === "violations") $("#v-comply_status").value = "pending";
      if (kind === "inspections") $("#i-kind").value = INSPECTION_KINDS[0] || "";
    }
    if (kind === "violations") syncFineHint();
    $(s.title).textContent = (rec ? "Sửa " : "Thêm ") + s.head.toLowerCase() + " — " + state.cur.name;
    const canEdit = isLead();
    $$(".lead-field", $(s.dlg)).forEach((el) => (el.disabled = !canEdit));
    $$(".btn.primary", $(s.dlg)).forEach((b) => (b.hidden = !canEdit));
    $(s.del).hidden = !(canEdit && rec);
    $(s.dlg).showModal();
  }

  async function saveSub(kind, e) {
    e.preventDefault();
    const s = SUBS[kind];
    const id = $("#" + s.pre + "id").value;
    const p = { company_id: +$("#" + s.pre + "company_id").value };
    s.text.forEach((k) => (p[k] = valOf(s, k).trim() || null));
    s.date.forEach((k) => (p[k] = valOf(s, k) || null));
    s.num.forEach((k) => (p[k] = parseVnd(valOf(s, k))));
    Object.assign(p, s.extra || {});
    const q = id ? state.sb.from(s.table).update(p).eq("id", id) : state.sb.from(s.table).insert(p);
    const { error } = await q;
    if (error) { toast(error.message, true); return; }
    toast(id ? "Đã lưu" : "Đã thêm");
    $(s.dlg).close();
    await loadCompanySubs(p.company_id);
  }

  async function deleteSub(kind) {
    const s = SUBS[kind];
    const id = $("#" + s.pre + "id").value;
    const cid = +$("#" + s.pre + "company_id").value;
    if (!id || !confirm("Xóa mục này khỏi hồ sơ doanh nghiệp?")) return;
    const { error } = await state.sb.from(s.table).delete().eq("id", id);
    if (error) { toast(error.message, true); return; }
    toast("Đã xóa"); $(s.dlg).close(); await loadCompanySubs(cid);
  }

  function syncFineHint() {
    const n = parseVnd($("#v-fine_amount").value);
    const h = $("#v-fine-hint");
    h.textContent = n ? "= " + fmtVnd(n) : ""; h.hidden = !n;
  }

  // ---------- Nối sự kiện ----------
  function wireCompanyProfile() {
    // danh mục cho các hộp thoại con
    $("#v-comply_status").innerHTML = VCOMPLY.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join("");
    $("#i-kind").innerHTML = INSPECTION_KINDS.map((k) => `<option>${esc(k)}</option>`).join("");
    $("#i-result-list").innerHTML = INSPECTION_RESULTS.map((k) => `<option value="${esc(k)}"></option>`).join("");
    $("#f-own_type").innerHTML = `<option value=""></option>` + FACILITY_OWN_TYPES.map((k) => `<option>${esc(k)}</option>`).join("");
    $("#r-title-list").innerHTML = REP_TITLES.map((k) => `<option value="${esc(k)}"></option>`).join("");
    $("#e-field").innerHTML = TGROUPS.filter((g) => g.key !== "all").map((g) => `<option value="${g.key}">${esc(g.label)}</option>`).join("");

    $("#company-tabs").addEventListener("click", (e) => {
      const b = e.target.closest(".ctab"); if (b) showCompanyTab(b.dataset.ctab);
    });
    $$("#company-dialog [data-add]").forEach((b) => b.addEventListener("click", () => openSub(b.dataset.add, null)));
    $("#company-dialog").addEventListener("click", (e) => {
      const s = e.target.closest("[data-sub]");
      if (s) { openSub(s.dataset.sub, +s.dataset.subId); return; }
      const g = e.target.closest("[data-tg]");
      if (g) { state.tfilter = g.dataset.tg; renderTimeline(); return; }
      const o = e.target.closest("[data-open]");
      if (o) {
        $("#company-dialog").close();
        if (o.dataset.open === "license") openLicense(+o.dataset.openId);
        else if (o.dataset.open === "task") openTask(+o.dataset.openId);
      }
    });
    Object.keys(SUBS).forEach((kind) => {
      const s = SUBS[kind];
      $(s.form).addEventListener("submit", (e) => saveSub(kind, e));
      $(s.del).addEventListener("click", () => deleteSub(kind));
    });
    $("#v-fine_amount").addEventListener("input", syncFineHint);
  }
  init().catch((e) => fatal("Lỗi khởi động: " + (e && e.message ? e.message : e)));
})();
