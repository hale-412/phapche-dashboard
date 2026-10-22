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
        lines.get(k).push({ x: it.transform[4], w: it.width || 0, s: it.str });
      });
      text += [...lines.entries()].sort((a, b) => b[0] - a[0])
        .map(([, parts]) => {
          parts.sort((a, b) => a.x - b.x);
          let s = "", end = null;
          parts.forEach((p) => {
            // Khoảng trắng rộng giữa hai mẩu chữ = ranh giới cột → đánh dấu bằng TAB
            if (end !== null) s += p.x - end > 24 ? "\t" : (/\s$/.test(s) ? "" : " ");
            s += p.s;
            end = p.x + p.w;
          });
          return s.replace(/ {2,}/g, " ").trim();
        })
        .filter(Boolean).join("\n") + "\n";
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
        if (validDate(m[1], m[2], m[3])) out.push({ idx: m.index, value: iso(m[1], m[2], m[3]), raw: m[0] });
      }
    }
    return out.sort((a, b) => a.idx - b.idx);
  }

  // Số văn bản: "Số: 1234/UBND-NC", "Số:1234/SLĐTBXH-PC", "Số 1234/QĐ-UBND"
  function findDocNumber(text) {
    // Ký hiệu có thể lẫn chữ thường: TTr, NĐ, QĐ, BC… nên cho cả a-z vào
    const m = text.match(/S[ốôo]\s*:?\s*([0-9]{1,5}\s*[\/\-]\s*[A-ZĐÀ-Ỹ0-9][A-Za-zĐđÀ-ỹ0-9\-\.\/]{1,30})/);
    if (!m) return "";
    return m[1].replace(/\s+/g, "").replace(/[.,;]+$/, "");
  }

  // Cơ quan gửi: khối chữ IN HOA ở góc trên bên trái, trước dòng "Số:"
  function findSender(text) {
    const head = text.split("\n").slice(0, 14);
    const SKIP = /CỘNG\s*HÒA|ĐỘC\s*LẬP|TỰ\s*DO|HẠNH\s*PHÚC|^S[ốôo]\s*:|^[-–—_=\s]+$|^\s*$/i;
    const isUpper = (s) => {
      const letters = s.replace(/[^A-Za-zÀ-ỹĐđ]/g, "");
      return letters.length >= 4 && letters === letters.toUpperCase();
    };
    const lines = [];
    for (const raw of head) {
      const s = leftCol(raw);                            // chỉ lấy cột bên trái
      if (SKIP.test(s)) { if (lines.length) break; continue; }
      if (!isUpper(s)) { if (lines.length) break; continue; }
      lines.push(s);
      if (lines.length >= 3) break;
    }
    // "UBND TỈNH X / SỞ NỘI VỤ" → lấy dòng cuối (đơn vị trực tiếp ban hành)
    return lines.length ? lines[lines.length - 1].replace(/[-–—_\s]+$/, "").trim() : "";
  }

  // Trích yếu: dòng "V/v ..." (có thể tràn sang dòng sau)
  function findSubject(text) {
    const lines = text.split("\n");
    const i = lines.findIndex((s) => /^\s*\(?\s*V\s*\/\s*v\b/i.test(s));
    if (i >= 0) {
      let s = lines[i].replace(/^\s*\(?\s*V\s*\/\s*v\b[:.\s]*/i, "");
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nx = lines[j].trim();
        if (!nx || /^S[ốôo]\s*:|^Kính\s*gửi|^CỘNG|^\(?\s*V\s*\/\s*v/i.test(nx)) break;
        if (/^(HỎA\s*TỐC|THƯỢNG\s*KHẨN|KHẨN|MẬT|TỐI\s*MẬT)\b/i.test(nx)) break;   // dấu độ khẩn / độ mật
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

  // Thời hạn: "trước ngày 20/3/2026" | "trong thời hạn 10 ngày" | "chậm nhất ngày ..."
  function findDeadline(text, docDate) {
    // Giữ lại chữ "ngày" trong phần bắt được, vì findDates() cần nó cho dạng
    // "ngày 30 tháng 10 năm 2026"; dạng 30/10/2026 thì không cần.
    const m = text.match(/(?:trước|chậm\s+nhất(?:\s+là)?(?:\s+vào)?|hạn\s+(?:cuối|chót)\s*:?|trước\s+khi)\s*(ngày\s*[^\n.;]{4,45}|\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{4})/i);
    if (m) {
      const d = findDates(m[1]);
      if (d.length) return d[0].value;
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
    const doc_number = findDocNumber(p);
    // Ngày văn bản: ngày đầu tiên xuất hiện ở phần đầu (khối "…, ngày … tháng … năm …")
    const dates = findDates(p.split("\n").slice(0, 20).join("\n"));
    const doc_date = dates[0]?.value || findDates(p)[0]?.value || "";
    return {
      doc_number, doc_date,
      sender: findSender(t),
      content: findSubject(p),
      deadline: findDeadline(p, doc_date),
      priority: findPriority(p),
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

  window.DocRead = { read, parse, clean };
})();
