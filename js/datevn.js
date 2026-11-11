// ---------------------------------------------------------------
// Ô chọn ngày kiểu Việt Nam: dd/mm/yyyy
// ---------------------------------------------------------------
// Chrome vẽ <input type="date"> theo ngôn ngữ của trình duyệt (en-US → mm/dd/yyyy),
// không theo lang="vi" của trang. Nên ở đây đổi mọi ô ngày thành ô text dd/mm/yyyy,
// nhưng vẫn giữ nguyên quy ước el.value = "YYYY-MM-DD" (ghi/đọc đều là ISO)
// để toàn bộ phần còn lại của app không phải sửa gì.
// Nút 📅 bên phải vẫn mở đúng bộ lịch của trình duyệt.
// File này phải nạp TRƯỚC js/app.js và sau khi phần HTML form đã có trong trang.
// ---------------------------------------------------------------
(function () {
  "use strict";

  // Bộ get/set gốc của input, dùng để đọc/ghi phần chữ đang hiện trong ô
  const RAW = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const pad = (n) => String(n).padStart(2, "0");

  // "25/12/2026" → "2026-12-25"; nhập sai hoặc chưa đủ → "" (app hiểu là bỏ trống)
  function toISO(text) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || "").trim());
    if (!m) return "";
    const d = +m[1], mo = +m[2], y = +m[3];
    const dt = new Date(y, mo - 1, d);
    if (dt.getDate() !== d || dt.getMonth() !== mo - 1 || dt.getFullYear() !== y) return "";
    return `${y}-${pad(mo)}-${pad(d)}`;
  }

  // "2026-12-25" (hoặc cả chuỗi thời gian ISO) → "25/12/2026"
  function toVN(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? "" : iso).trim());
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  }

  // Tự chèn dấu "/" khi đang gõ: 2 số ngày / 2 số tháng / 4 số năm
  function autoSlash(s) {
    const d = s.replace(/\D/g, "").slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  }

  // Rời ô thì chuẩn hoá lại: "5/6/26" → "05/06/2026"
  function normalize(s) {
    const t = s.trim();
    const m = /^(\d{1,2})\D+(\d{1,2})\D+(\d{2}|\d{4})$/.exec(t);
    if (!m) return t;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const iso = toISO(`${+m[1]}/${+m[2]}/${y}`);
    return iso ? toVN(iso) : t;
  }

  // Gõ xong mà không ra ngày thật (31/02, năm thiếu số…) thì chặn lưu, không im lặng bỏ trống
  function check(el) {
    const txt = RAW.get.call(el).trim();
    const bad = !!txt && !toISO(txt);
    el.setCustomValidity(bad ? "Ngày không hợp lệ, nhập dạng dd/mm/yyyy" : "");
    el.classList.toggle("vn-bad", bad && txt.length >= 10);
  }

  function enhance(el) {
    if (el.dataset.vnDate) return;
    const iso = RAW.get.call(el);           // giá trị ISO đang có (ô còn là type="date")
    el.dataset.vnDate = "1";
    el.classList.add("vn-date-txt");
    el.type = "text";
    el.inputMode = "numeric";
    el.autocomplete = "off";
    el.maxLength = 10;
    el.placeholder = "dd/mm/yyyy";
    el.pattern = "\\d{2}/\\d{2}/\\d{4}";
    if (!el.title) el.title = "Nhập ngày dạng dd/mm/yyyy";

    // Giữ giao kèo cũ: code ngoài vẫn đọc/ghi ISO, người dùng thấy dd/mm/yyyy
    Object.defineProperty(el, "value", {
      configurable: true,
      get: () => toISO(RAW.get.call(el)),
      set: (v) => { RAW.set.call(el, toVN(v)); check(el); },
    });
    RAW.set.call(el, toVN(iso));

    el.addEventListener("input", () => {
      const cur = RAW.get.call(el);
      const atEnd = el.selectionStart === cur.length;
      const txt = autoSlash(cur);
      if (txt !== cur) {
        RAW.set.call(el, txt);
        if (atEnd) el.setSelectionRange(txt.length, txt.length);
      }
      check(el);
    });

    el.addEventListener("blur", () => {
      const cur = RAW.get.call(el);
      const txt = normalize(cur);
      if (txt !== cur) RAW.set.call(el, txt);
      check(el);
    });

    // Bọc ô lại để gắn nút lịch vào góc phải
    const wrap = document.createElement("span");
    wrap.className = "vn-date";
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);

    const icon = document.createElement("span");
    icon.className = "vn-date-btn";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "📅";
    wrap.appendChild(icon);

    // Ô type="date" trong suốt nằm chồng lên nút: bấm vào là mở lịch của trình duyệt
    const nat = document.createElement("input");
    nat.type = "date";
    nat.className = "vn-date-native";
    nat.tabIndex = -1;
    nat.setAttribute("aria-hidden", "true");
    wrap.appendChild(nat);

    // Mở lịch thì cho nó nhớ ngày đang có trong ô
    ["mousedown", "focus"].forEach((ev) => nat.addEventListener(ev, () => (nat.value = el.value || "")));
    nat.addEventListener("change", () => {
      if (!nat.value) return;
      el.value = nat.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function enhanceAll(root) {
    (root || document).querySelectorAll('input[type="date"]').forEach(enhance);
  }

  enhanceAll();

  // Hiện tại mọi ô ngày đều nằm sẵn trong HTML. Nếu sau này có form sinh ô ngày
  // bằng JS thì gọi DateVN.enhanceAll(phầnVừaThêm) sau khi chèn vào trang.
  window.DateVN = { toISO, toVN, enhanceAll };
})();
