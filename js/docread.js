// =====================================================================
//  Đọc văn bản hành chính (PDF / ảnh) → trích xuất sẵn các ô nhập liệu
//  ---------------------------------------------------------------------
//  - PDF có lớp text (xuất từ Word, bản ký số)  → pdf.js, nhanh & chính xác.
//  - PDF scan hoặc ảnh chụp                      → Tesseract.js (tải khi cần).
//  - Thư viện CHỈ tải lúc người dùng chọn file, nên trang vẫn nhẹ như cũ.
//  - File chỉ được đọc trong trình duyệt, không gửi đi đâu, không lưu lại.
//
//  Dùng:  const r = await window.DocRead.read(file, onProgress)
//         r = { text, source: "pdf" | "ocr", fields: {...} }
//         window.DocRead.parse(text) → { doc_number, doc_date, sender, content, deadline, priority }
// =====================================================================
(() => {
  const PDF_JS = "vendor/pdf-3.11.174.min.js";
  const PDF_WORKER = "vendor/pdf.worker-3.11.174.min.js";
  // Tesseract chỉ tải khi gặp bản scan — ~15 MB lần đầu, sau đó trình duyệt nhớ lại
  const TESS_JS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { delete loaded[src]; reject(new Error("Không tải được " + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  // ---------- Chuẩn hóa text OCR / PDF ----------
  // Giữ lại ký tự TAB: công văn có 2 cột (cơ quan ban hành bên trái, Quốc hiệu bên phải)
  // nằm cùng một dòng — TAB là ranh giới giữa hai cột.
  const clean = (s) => String(s || "")
    .replace(/ /g, " ")
    .replace(/[^\S\n\t]+/g, " ")
    .replace(/ ?\t ?/g, "\t")
    .replace(/\t{2,}/g, "\t")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Bỏ cột bên phải (Quốc hiệu, ngày tháng) để lấy riêng khối cơ quan ban hành
  const leftCol = (line) => String(line).split("\t")[0].trim();
  const flat = (s) => String(s || "").replace(/\t/g, " ").replace(/ {2,}/g, " ");

  // ---------- Đọc PDF bằng pdf.js ----------
  // Nạp luôn cả file worker như một script thường: pdf.js thấy window.pdfjsWorker
  // thì chạy thẳng trên luồng chính, không cần Web Worker. Công văn chỉ vài trang
  // nên không đáng kể, đổi lại chạy được cả khi mở index.html trực tiếp (file://),
  // nơi trình duyệt chặn Worker cùng nguồn.
  async function readPdf(file, onProgress) {
    await loadScript(PDF_JS);
    await loadScript(PDF_WORKER);
    const pdfjs = window.pdfjsLib;
    if (!pdfjs) throw new Error("Không tải được thư viện đọc PDF");
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const pages = Math.min(pdf.numPages, 5);   // công văn: thông tin cần lấy nằm ở trang đầu
    let text = "";
    for (let i = 1; i <= pages; i++) {
      onProgress?.(`Đang đọc trang ${i}/${pages}…`);
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      // Gom theo dòng: pdf.js trả từng mẩu chữ kèm tọa độ, gộp lại theo tọa độ Y
      const lines = new Map();
      tc.items.forEach((it) => {
        if (!it.str.trim()) return;
        const y = Math.round(it.transform[5]);
        const key = [...lines.keys()].find((k) => Math.abs(k - y) <= 3);
        const k = key === undefined ? y : key;
        if (!lines.has(k)) lines.set(k, []);
        // h ≈ cỡ chữ, dùng để biết khoảng trắng nào là dấu cách thật
        lines.get(k).push({ x: it.transform[4], w: it.width || 0, s: it.str, h: Math.abs(it.transform[0]) || it.height || 10 });
      });
      const lineText = (parts) => {
        parts.sort((a, b) => a.x - b.x);
        let s = "", end = null;
        parts.forEach((p) => {
          if (end !== null) {
            const gap = p.x - end;
            // Khoảng trắng rộng = ranh giới hai cột của công văn → đánh dấu TAB.
            if (gap > Math.max(18, p.h * 1.6)) s += "\t";
            // Hẹp hơn một dấu cách thì KHÔNG chèn gì: pdf.js cắt chữ thành
            // nhiều mẩu (in đậm, đổi font, kerning), chèn bừa sẽ ra "phá p chế".
            else if (gap > p.h * 0.18 && !/[\s\t]$/.test(s) && !/^\s/.test(p.s)) s += " ";
          }
          s += p.s;
          end = p.x + p.w;
        });
        return s.replace(/ {2,}/g, " ").trim();
      };
      // Cách dòng thưa hơn bình thường = sang đoạn mới → chèn dòng trống, để
      // trích yếu không bị nối liền với đoạn nội dung bên dưới.
      const rows = [...lines.entries()].sort((a, b) => b[0] - a[0]).filter(([, p]) => lineText(p));
      const steps = rows.slice(1).map(([y], n) => rows[n][0] - y).sort((a, b) => a - b);
      const lineGap = steps.length ? steps[Math.floor(steps.length / 2)] : 14;
      rows.forEach(([y, parts], n) => {
        if (n) text += rows[n - 1][0] - y > lineGap * 1.6 ? "\n\n" : "\n";
        text += lineText(parts);
      });
      text += "\n";
    }
    return { text: clean(text), pages: pdf.numPages, doc: pdf };
  }

  // ---------- Dựng ảnh từng trang PDF để đưa qua OCR ----------
  async function pdfPageToImage(pdf, pageNo, scale = 2) {
    const page = await pdf.getPage(pageNo);
    const vp = page.getViewport({ scale });
    const cv = document.createElement("canvas");
    cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    return cv;
  }

  // ---------- OCR tiếng Việt ----------
  async function runOcr(images, onProgress) {
    onProgress?.("Đang tải bộ nhận dạng chữ (lần đầu ~15 MB)…");
    await loadScript(TESS_JS);
    if (!window.Tesseract) throw new Error("Không tải được bộ nhận dạng chữ (mạng có thể đang chặn)");
    const worker = await window.Tesseract.createWorker("vie", 1, {
      logger: (m) => { if (m.status === "recognizing text") onProgress?.(`Đang nhận dạng chữ… ${Math.round(m.progress * 100)}%`); },
    });
    let text = "";
    try {
      for (let i = 0; i < images.length; i++) {
        onProgress?.(`Đang nhận dạng trang ${i + 1}/${images.length}…`);
        const { data } = await worker.recognize(images[i]);
        text += data.text + "\n";
      }
    } finally { await worker.terminate(); }
    return clean(fixVnOcr(text));
  }

  // Sửa các lỗi OCR tiếng Việt hay gặp trên văn bản hành chính
  const VN_OCR_FIXES = [
    [/\bUY BAN\b/gi, "ỦY BAN"], [/\bNHAN DAN\b/gi, "NHÂN DÂN"],
    [/\bCONG HOA\b/gi, "CỘNG HÒA"], [/\bXA HOI\b/gi, "XÃ HỘI"], [/\bCHU NGHIA\b/gi, "CHỦ NGHĨA"],
    [/\bVIET NAM\b/gi, "VIỆT NAM"], [/\bDOC LAP\b/gi, "ĐỘC LẬP"], [/\bTU DO\b/gi, "TỰ DO"],
    [/\bHANH PHUC\b/gi, "HẠNH PHÚC"], [/\bQUOC\b/g, "QUỐC"], [/\bSO GIAO DUC\b/gi, "SỞ GIÁO DỤC"],
    [/\bV\/v\b/gi, "V/v"], [/\bKinh gui\b/gi, "Kính gửi"],
    [/\bthang\b/gi, "tháng"], [/\bnam\b(?=\s*\d{4})/gi, "năm"], [/\bngay\b/gi, "ngày"],
    [/(\d)\s*\/\s*(\d)/g, "$1/$2"],
  ];
  const fixVnOcr = (s) => VN_OCR_FIXES.reduce((t, [re, to]) => t.replace(re, to), String(s || ""));

  // =====================================================================
  //  Bóc tách thông tin từ text công văn
  // =====================================================================
  const MONTH_D = "(\\d{1,2})";
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d, m, y) => `${y}-${pad(m)}-${pad(d)}`;
  const validDate = (d, m, y) => +d >= 1 && +d <= 31 && +m >= 1 && +m <= 12 && +y >= 2000 && +y <= 2099;

  // "ngày 05 tháng 3 năm 2026" | "05/3/2026" | "ngày 05-3-2026"
  function findDates(text) {
    const out = [];
    const re1 = new RegExp(`ngày\\s*${MONTH_D}\\s*tháng\\s*${MONTH_D}\\s*năm\\s*(\\d{4})`, "gi");
    const re2 = new RegExp(`\\b${MONTH_D}\\s*[/\\-.]\\s*${MONTH_D}\\s*[/\\-.]\\s*(\\d{4})\\b`, "g");
    for (const re of [re1, re2]) {
      let m;
      while ((m = re.exec(text))) {
        if (validDate(m[1], m[2], m[3])) out.push({ idx: m.index, value: iso(m[1], m[2], m[3]), raw: m[0].trim() });
      }
    }
    return out.sort((a, b) => a.idx - b.idx);
  }

  // Ngày của văn bản ĐƯỢC VIỆN DẪN ("…Kế hoạch số 45/KH-UBND ngày 02/10/2026…")
  // chứ không phải ngày ban hành của văn bản đang đọc.
  const isCited = (text, idx) => /s[ốôo]\s*:?\s*\d[^\s]{0,30}\s*$/i.test(text.slice(Math.max(0, idx - 60), idx));

  // ---------- Ngày ban hành văn bản ----------
  // Luôn nằm ở khối đầu trang, CỘT BÊN PHẢI, dạng "<Địa danh>, ngày … tháng … năm …".
  // Xét theo thứ tự chắc chắn giảm dần để tránh vớ phải ngày của văn bản viện dẫn.
  function findDocDate(textTabs) {
    const head = textTabs.split("\n").slice(0, 25);
    const grab = (s) => {
      const m = s.match(new RegExp(`,\\s*ngày\\s*${MONTH_D}\\s*tháng\\s*${MONTH_D}\\s*năm\\s*(\\d{4})`, "i"))
        || s.match(new RegExp(`,\\s*ngày\\s*${MONTH_D}\\s*[/\\-.]\\s*${MONTH_D}\\s*[/\\-.]\\s*(\\d{4})`, "i"));
      return m && validDate(m[1], m[2], m[3]) ? iso(m[1], m[2], m[3]) : "";
    };
    // 1) "Địa danh, ngày …" ở cột bên phải khối đầu trang — chắc chắn nhất
    for (const line of head) {
      if (!line.includes("\t")) continue;
      const hit = grab(line.split("\t").slice(1).join(" "));
      if (hit) return hit;
    }
    // 2) "Địa danh, ngày …" ở bất kỳ đâu trong khối đầu trang
    for (const line of head) {
      const hit = grab(line);
      if (hit) return hit;
    }
    // 3) Ngày đầu tiên trong khối đầu trang, bỏ qua ngày của văn bản viện dẫn
    const p = flat(head.join("\n"));
    const d = findDates(p).find((x) => !isCited(p, x.idx));
    return d?.value || findDates(flat(textTabs))[0]?.value || "";
  }

  // ---------- Số văn bản ----------
  // Nằm ở khối đầu trang, CỘT BÊN TRÁI, ngang hàng với dòng "…, ngày … tháng … năm …"
  // ở cột bên phải. Phải lấy đúng chỗ đó, không thì vớ phải "Công văn số …/…"
  // được viện dẫn trong nội dung.
  // Ký hiệu có thể lẫn chữ thường (TTr, NĐ, QĐ, BC…) và có dấu cách quanh dấu nối
  // ("1234/UBND - NC"); bắt xong sẽ bỏ hết dấu cách.
  const SO = "S[ốôoơ0]";                       // OCR đọc "Số" thành Sô / So / Sơ / S0
  const KYHIEU = "[A-Za-zĐđÀ-ỹ0-9]+(?:\\s*[-.\\/]\\s*[A-Za-zĐđÀ-ỹ0-9]+)*";
  const RE_DOCNO = `([0-9]{1,7}\\s*[\\/\\-]\\s*${KYHIEU})`;
  const RE_NO_STRICT = new RegExp(`${SO}\\s*:\\s*${RE_DOCNO}`, "i");   // có dấu hai chấm
  const RE_NO_HEAD = new RegExp(`^${SO}\\s*:?\\s*${RE_DOCNO}`, "i");   // OCR mất dấu hai chấm
  // Giấy mời, thông báo nội bộ… đôi khi chỉ có số, không có ký hiệu: "Số: 07"
  const RE_NO_PLAIN = new RegExp(`^${SO}\\s*:?\\s*([0-9]{1,7})\\s*$`, "i");
  const HEAD_LINES = 20;
  const normDocNo = (s) => s.replace(/\s+/g, "").replace(/[.,;]+$/, "");

  function findDocNumber(textTabs) {
    // CHỈ xét khối đầu trang, cột bên trái. Tuyệt đối không quét phần nội dung:
    // trong nội dung luôn có số của văn bản khác được viện dẫn ("Công văn số …
    // của Văn phòng Chính phủ"), lấy vào là sai.
    const raw = textTabs.split("\n").slice(0, HEAD_LINES);
    // Ký hiệu có thể bị xuống dòng ("Số: 1234" / "/SNV-PC") → ghép thử với dòng sau
    const head = raw.map((l, k) => leftCol(l) + (raw[k + 1] && /^\s*[\/\-]/.test(leftCol(raw[k + 1])) ? leftCol(raw[k + 1]) : ""));
    // 1) Ngang hàng với dòng "<Địa danh>, ngày … tháng … năm …" ở cột bên phải
    const i = raw.findIndex((l) => l.includes("\t") && /,\s*ngày\s*\d{1,2}\s*(tháng|[\/\-.])/i.test(l));
    if (i >= 0) {
      const m = head[i].match(RE_NO_STRICT) || head[i].match(RE_NO_HEAD) || head[i].match(RE_NO_PLAIN);
      if (m) return normDocNo(m[1]);
    }
    // 2) Dòng "Số: …" ở cột bên trái khối đầu trang
    for (const l of head) {
      const m = l.match(RE_NO_STRICT);
      if (m) return normDocNo(m[1]);
    }
    // 3) Dòng bắt đầu bằng "Số …" (OCR mất dấu hai chấm)
    for (const l of head) {
      const m = l.match(RE_NO_HEAD);
      if (m) return normDocNo(m[1]);
    }
    // 4) Chỉ có số, không có ký hiệu
    for (const l of head) {
      const m = l.match(RE_NO_PLAIN);
      if (m) return normDocNo(m[1]);
    }
    return "";                 // không có ở đầu trang thì để trống, mời nhập tay
  }

  // Cơ quan gửi: khối chữ IN HOA ở góc trên bên trái, trước dòng "Số:"
  function findSender(text) {
    const head = text.split("\n").slice(0, 14);
    // Dòng kẻ ngang / dòng trống ở cột trái: bỏ qua, KHÔNG coi là hết khối tên cơ quan
    const SEP = /^[-–—_=─-╿.\s]*$/;
    // Hết khối tên cơ quan: Quốc hiệu, dòng "Số:", hoặc đã sang tên loại văn bản
    const DOC_TITLE = /^(GIẤY|QUYẾT\s*ĐỊNH|THÔNG\s*BÁO|THÔNG\s*TƯ|BÁO\s*CÁO|KẾ\s*HOẠCH|CÔNG\s*VĂN|TỜ\s*TRÌNH|BIÊN\s*BẢN|CHỈ\s*THỊ|NGHỊ\s*QUYẾT|NGHỊ\s*ĐỊNH|QUY\s*ĐỊNH|QUY\s*CHẾ|HƯỚNG\s*DẪN|ĐỀ\s*ÁN|PHƯƠNG\s*ÁN|KẾT\s*LUẬN|LỆNH|V\/v)(\s|$)/i;
    const STOP = /CỘNG\s*HÒA|ĐỘC\s*LẬP|TỰ\s*DO|HẠNH\s*PHÚC|^S[ốôo]\s*:/i;
    // Chỉ cần 2 chữ cái: tên cơ quan dài bị xuống dòng để lại mảnh rất ngắn ("HÓA", "NƯỚC")
    const isUpper = (s) => {
      const letters = s.replace(/[^A-Za-zÀ-ỹĐđ]/g, "");
      return letters.length >= 2 && letters === letters.toUpperCase();
    };
    const lines = [];
    for (const raw of head) {
      const s = leftCol(raw);                            // chỉ lấy cột bên trái
      if (SEP.test(s)) continue;
      if (STOP.test(s) || DOC_TITLE.test(s)) { if (lines.length) break; continue; }
      if (!isUpper(s)) { if (lines.length) break; continue; }
      lines.push(s);
      if (lines.length >= 4) break;
    }
    if (!lines.length) return "";
    // "UBND TỈNH X / SỞ NỘI VỤ" → lấy đơn vị trực tiếp ban hành, tức khối cuối cùng
    // có từ chỉ loại cơ quan. Tên dài bị xuống dòng ("CỤC QUẢN LÝ LAO ĐỘNG NGOÀI" /
    // "NƯỚC") thì nối các mảnh phía sau lại cho đủ.
    let i = -1;
    lines.forEach((s, k) => { if (ORG_KEY.test(s)) i = k; });
    const take = i < 0 ? lines.slice(-1) : [lines[i], ...lines.slice(i + 1).filter((s) => !ORG_KEY.test(s))];
    return orgCase(take.join(" ").replace(/\s{2,}/g, " ").replace(/[-–—_\s]+$/, "").trim());
  }
  // Từ chỉ loại cơ quan ban hành, dùng để nhận ra đâu là dòng MỞ ĐẦU tên cơ quan.
  // Phải neo ^ và dùng (\s|$) thay cho \b: \b của JS chỉ hiểu chữ ASCII nên
  // "SỞ\b" không bao giờ khớp (Ở không phải ký tự \w).
  const ORG_KEY = /^(TỔNG\s*CỤC|CHI\s*CỤC|TỔNG\s*CÔNG\s*TY|ỦY\s*BAN|UỶ\s*BAN|HỘI\s*ĐỒNG|THANH\s*TRA|VĂN\s*PHÒNG|TRUNG\s*TÂM|CHI\s*NHÁNH|CÔNG\s*AN|TÒA\s*ÁN|CÔNG\s*TY|NGÂN\s*HÀNG|HỌC\s*VIỆN|BỘ|SỞ|CỤC|VỤ|VIỆN|PHÒNG|BAN|TRƯỜNG|ĐOÀN|UBND|HĐND)(\s|$)/i;

  // ---------------------------------------------------------------
  //  Viết hoa tên cơ quan theo thể thức hành chính (Nghị định 30/2020):
  //  viết hoa chữ cái đầu của từ chỉ loại hình cơ quan và của cụm từ chỉ
  //  chức năng / lĩnh vực, phần còn lại viết thường.
  //    VỤ PHÁP CHẾ                      → Vụ Pháp chế
  //    VĂN PHÒNG BỘ                     → Văn phòng Bộ
  //    SỞ NỘI VỤ                        → Sở Nội vụ
  //    CỤC QUẢN LÝ LAO ĐỘNG NGOÀI NƯỚC  → Cục Quản lý lao động ngoài nước
  //    BỘ NỘI VỤ - THANH TRA BỘ         → Bộ Nội vụ - Thanh tra Bộ
  //    ỦY BAN NHÂN DÂN TỈNH THANH HÓA   → Ủy ban nhân dân tỉnh Thanh Hóa
  //  Muốn thêm / bớt loại hình cơ quan thì sửa ORG_TYPES bên dưới.
  // ---------------------------------------------------------------
  const ORG_TYPES = [
    "ủy ban nhân dân", "uỷ ban nhân dân", "hội đồng nhân dân",
    "viện kiểm sát nhân dân", "tòa án nhân dân", "toà án nhân dân",
    "bảo hiểm xã hội", "kho bạc nhà nước", "tổng công ty", "tổng cục", "chi cục",
    "văn phòng", "thanh tra", "trung tâm", "chi nhánh", "học viện", "ngân hàng",
    "ủy ban", "uỷ ban", "công an", "công ty", "trường", "viện", "phòng", "ban",
    "cục", "vụ", "sở", "bộ", "đoàn",
  ].sort((a, b) => b.length - a.length);
  const ORG_UNITS = ["thành phố", "thị trấn", "thị xã", "tỉnh", "huyện", "quận", "phường", "xã"]
    .sort((a, b) => b.length - a.length);
  const ORG_LOWER = new Set(["và", "của", "thuộc", "trực", "về", "các", "cho", "với", "theo", "trong", "ngoài"]);
  // Chỉ những chữ viết tắt thật sự mới giữ nguyên — không thể dựa vào "viết hoa hết"
  // vì cả tên cơ quan cũng viết hoa hết (THANH TRA, TRUNG TÂM, CHI CỤC…).
  // Không đưa "TƯ" (Trung ương) vào đây: trùng với từ thường "tư" trong "Tư pháp"
  const ORG_ACRONYM = /^(UBND|HĐND|BHXH|TAND|VKSND|BQL|BCĐ|CSGT|PCCC|VP|VPUB|TW|KH&ĐT|NN&PTNT|LĐTBXH)$/;
  // Giữ nguyên số La Mã / số thứ tự / chữ cái đơn: "khu vực I", "Vùng 3", "Phòng A"
  const keepAsIs = (w) => ORG_ACRONYM.test(w) || /^[IVX]+$/.test(w) || /^\d+[A-ZĐ]?$/.test(w) || /^[A-ZĐ]$/.test(w);
  // "xã hội", "xã viên" không phải đơn vị hành chính cấp xã
  const NOT_UNIT = /^(xã\s+hội|xã\s+viên)\b/;

  const capWord = (w) => (w ? w[0].toLocaleUpperCase("vi") + w.slice(1) : w);
  const capSegment = (seg) => {
    const s = seg.trim();
    if (!s) return s;
    const unit = NOT_UNIT.test(s) ? null : ORG_UNITS.find((u) => s === u || s.startsWith(u + " "));
    if (unit) {                                   // "tỉnh Thanh Hóa": tên địa danh viết hoa từng chữ
      const after = s.slice(unit.length).trim();
      return unit + (after ? " " + after.split(/\s+/).map((w) => (ORG_LOWER.has(w) ? w : capWord(w))).join(" ") : "");
    }
    const w = s.split(/\s+/);
    return [capWord(w[0]), ...w.slice(1)].join(" ");
  };
  // Mỗi vế ngăn bởi dấu gạch nối hoặc chữ "và" là một lĩnh vực riêng → viết hoa chữ đầu
  const capPhrase = (s) => s.split(/(\s*[-–—]\s*|\s+và\s+)/)
    .map((p, i) => (i % 2 ? p : capSegment(p))).join("");

  function orgCase(raw) {
    let s = String(raw || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    let prefix = "";
    let tok = s.split(" ");
    if (tok.length > 1 && ORG_ACRONYM.test(tok[0])) { prefix = tok[0] + " "; tok = tok.slice(1); }
    // Hạ chữ thường trước, trừ các từ cần giữ nguyên
    const low = tok.map((w) => (keepAsIs(w) ? w : w.toLocaleLowerCase("vi"))).join(" ");
    const type = ORG_TYPES.find((t) => low === t || low.startsWith(t + " "));
    const head = type ? capWord(type) : "";
    const rest = type ? low.slice(type.length).trim() : low;
    return (prefix + [head, rest ? capPhrase(rest) : ""].filter(Boolean).join(" ")).trim();
  }

  // Các cách mở đầu đoạn nội dung — gặp là biết đã hết phần trích yếu
  const BODY_OPEN = /^(Thực\s+hiện|Căn\s+cứ|Theo|Trên\s+cơ\s+sở|Để|Nhằm|Qua|Xét|Hiện\s+nay|Vừa\s+qua|Ngày|Thời\s+gian|Kính\s+gửi|Trả\s+lời|Sau\s+khi|Tiếp)\b/i;

  // Trích yếu: dòng "V/v ..." (có thể tràn sang dòng sau)
  function findSubject(text) {
    const lines = text.split("\n");
    const i = lines.findIndex((s) => /^\s*\(?\s*V\s*\/\s*v\b/i.test(s));
    if (i >= 0) {
      let s = lines[i].replace(/^\s*\(?\s*V\s*\/\s*v\b[:.\s]*/i, "");
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nx = lines[j].trim();
        if (!nx || /^S[ốôo]\s*:|^Kính\s*gửi|^CỘNG|^\(?\s*V\s*\/\s*v/i.test(nx)) break;
        if (/^(HỎA\s*TỐC|THƯỢNG\s*KHẨN|KHẨN|MẬT|TỐI\s*MẬT)(\s|$)/i.test(nx)) break;   // dấu độ khẩn / độ mật
        if (BODY_OPEN.test(nx)) break;                                              // đã sang đoạn nội dung
        if (/^[A-ZĐÀ-Ỹ\s,.\-\/]+$/.test(nx)) break;                                 // dòng IN HOA = tiêu đề khác
        s += " " + nx;
      }
      return s.replace(/\s+/g, " ").replace(/[.;,\s)]+$/, "").trim();
    }
    // Không có V/v → lấy đoạn ngay sau "Kính gửi: ..."
    const k = lines.findIndex((s) => /Kính\s*gửi/i.test(s));
    if (k >= 0) {
      const after = lines.slice(k + 1).map((s) => s.trim())
        .filter((s) => s && !/^[A-ZĐÀ-Ỹ\s,.\-]+$/.test(s));
      if (after[0]) return after.slice(0, 2).join(" ").replace(/\s+/g, " ").slice(0, 300).trim();
    }
    return "";
  }

  // Thời hạn: "trước ngày 20/3/2026" | "trước 17 giờ ngày 20/3/2026" |
  // "chậm nhất là ngày …" | "hạn cuối: …" | "hoàn thành trước …" | "trong thời hạn 10 ngày"
  const DEADLINE_KEYS = /(?:trước\s+ngày|trước\s+\d{1,2}\s*(?:giờ|g\b|h\b)|chậm\s+nhất|hạn\s+(?:cuối|chót)|thời\s+hạn\s*:|hoàn\s+thành\s+trước|xong\s+trước|gửi\s+(?:về|đến|cho)[^\n]{0,60}?trước|báo\s+cáo[^\n]{0,60}?trước|trả\s+lời[^\n]{0,60}?trước|trước)/gi;

  function findDeadline(text, docDate) {
    // Từ mỗi từ khóa chỉ hạn, quét tiếp ~90 ký tự để bắt ngày — không bắt buộc
    // ngày phải nằm sát từ khóa ("trước 17 giờ 00 ngày 30/10/2026").
    DEADLINE_KEYS.lastIndex = 0;
    let k;
    while ((k = DEADLINE_KEYS.exec(text))) {
      const d = findDates(text.slice(k.index, k.index + k[0].length + 90))[0];
      // Hạn xử lý không thể trước ngày ban hành → loại ngày của văn bản viện dẫn
      if (d && (!docDate || d.value >= docDate)) return d.value;
    }
    // "trong thời hạn N ngày": mốc tính là ngày nhận nếu văn bản ghi "kể từ ngày nhận",
    // còn lại tính từ ngày ban hành văn bản.
    const n = text.match(/trong\s+(?:thời\s+hạn\s+)?(\d{1,3})\s*ngày(?:\s+làm\s+việc)?/i);
    if (n) {
      const fromReceipt = /kể\s+từ\s+ngày\s+(?:nhận|ký\s+nhận)/i.test(text);
      const start = fromReceipt || !docDate ? new Date() : new Date(docDate + "T00:00:00");
      start.setDate(start.getDate() + +n[1]);
      // Dùng ngày theo giờ địa phương, không qua toISOString() (lệch 1 ngày vì múi giờ)
      return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    }
    return "";
  }

  const findPriority = (text) => /\b(HỎA\s*TỐC|KHẨN|THƯỢNG\s*KHẨN)\b/i.test(text) ? "urgent" : "normal";

  function parse(text) {
    const t = clean(text);                    // còn TAB: dùng để tách cột khi tìm cơ quan gửi
    const p = flat(t);                        // bản phẳng: dùng cho số VB, ngày, trích yếu, thời hạn
    const doc_number = findDocNumber(t);          // cần TAB để biết đâu là cột bên trái
    const doc_date = findDocDate(t);
    const deadline = findDeadline(p, doc_date);
    // Mọi ngày tìm thấy trong văn bản, để người dùng bấm chọn lại nếu máy đoán sai
    const seen = new Set();
    const dates = findDates(p).map((d) => d.value).filter((v) => !seen.has(v) && seen.add(v)).sort();
    return {
      doc_number, doc_date, deadline,
      sender: findSender(t),
      content: findSubject(p),
      priority: findPriority(p),
      dates,
    };
  }

  // =====================================================================
  //  Đọc 1 file: tự chọn PDF-text hay OCR
  // =====================================================================
  const MIN_TEXT = 120;   // ít hơn chừng này ký tự → coi như bản scan

  async function read(file, onProgress, opts = {}) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    if (!isPdf) {
      const text = await runOcr([file], onProgress);
      return { text, source: "ocr", fields: parse(text) };
    }
    const { text, doc, pages } = await readPdf(file, onProgress);
    if (!opts.forceOcr && text.replace(/\s/g, "").length >= MIN_TEXT) {
      return { text, source: "pdf", fields: parse(text) };
    }
    // PDF scan → dựng ảnh rồi OCR (tối đa 2 trang đầu cho nhanh)
    onProgress?.("Văn bản là bản scan — chuyển sang nhận dạng chữ…");
    const imgs = [];
    for (let i = 1; i <= Math.min(pages, 2); i++) imgs.push(await pdfPageToImage(doc, i));
    const ocr = await runOcr(imgs, onProgress);
    return { text: ocr, source: "ocr", fields: parse(ocr) };
  }

  window.DocRead = { read, parse, clean, orgCase };
})();
