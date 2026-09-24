// Edge Function: gửi email nhắc việc hàng ngày
// Deploy:  supabase functions deploy daily-reminder --no-verify-jwt
// Secrets: supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="Phap che <onboarding@resend.dev>" APP_URL=https://<user>.github.io/phapche-dashboard/
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "Phòng Pháp chế <onboarding@resend.dev>";
const APP_URL = Deno.env.get("APP_URL") ?? "";

type Row = {
  kind: "task" | "license" | "update"; id: number; ref: string | null; title: string; deadline: string;
  status: string; progress: string; days_left: number;
  handler1_name: string | null; handler1_email: string | null;
  handler2_name: string | null; handler2_email: string | null;
};

const LICENSE_STATUS: Record<string, string> = {
  received: "Tiếp nhận", reviewing: "Đang thẩm định", supplement: "Yêu cầu bổ sung",
  submitted: "Trình lãnh đạo", issued: "Đã cấp phép", rejected: "Từ chối", withdrawn: "Rút hồ sơ",
};
const UPDATE_STATUS: Record<string, string> = {
  received: "Tiếp nhận", processing: "Đang xử lý", supplement: "Yêu cầu bổ sung", done: "Đã cập nhật", rejected: "Không chấp thuận",
};

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

function label(days: number) {
  if (days < 0) return `QUÁ HẠN ${-days} ngày`;
  if (days === 0) return "ĐẾN HẠN HÔM NAY";
  return `còn ${days} ngày`;
}

function buildHtml(name: string, rows: Row[]) {
  const overdue = rows.filter(r => r.days_left < 0);
  const soon = rows.filter(r => r.days_left >= 0);
  const table = (list: Row[]) => `
    <table style="border-collapse:collapse;width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:14px">
      <tr style="background:#f0efec">
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #c3c2b7">Loại</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #c3c2b7">Số</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #c3c2b7">Nội dung</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #c3c2b7">Hạn</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #c3c2b7">Tiến độ / Trạng thái</th>
      </tr>
      ${list.map(r => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e1e0d9">${r.kind === "license" ? "Hồ sơ GP" : r.kind === "update" ? "Cập nhật TTDN" : "Văn bản"}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e1e0d9">${r.ref ?? "—"}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e1e0d9">${r.title}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e1e0d9;white-space:nowrap">
          ${fmtDate(r.deadline)}<br><b style="color:${r.days_left < 0 ? "#d03b3b" : "#b45309"}">${label(r.days_left)}</b></td>
        <td style="padding:6px 8px;border-bottom:1px solid #e1e0d9">${r.kind === "license" ? (LICENSE_STATUS[r.progress] ?? r.progress) : r.kind === "update" ? (UPDATE_STATUS[r.progress] ?? r.progress) : r.progress + "%"}</td>
      </tr>`).join("")}
    </table>`;
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#0b0b0b;max-width:720px">
      <p>Chào ${name},</p>
      <p>Dưới đây là các công việc bạn phụ trách cần chú ý:</p>
      ${overdue.length ? `<h3 style="color:#d03b3b;margin:16px 0 8px">Quá hạn (${overdue.length})</h3>${table(overdue)}` : ""}
      ${soon.length ? `<h3 style="color:#b45309;margin:16px 0 8px">Sắp đến hạn (${soon.length})</h3>${table(soon)}` : ""}
      ${APP_URL ? `<p style="margin-top:20px"><a href="${APP_URL}" style="background:#2a78d6;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Mở Dashboard</a></p>` : ""}
      <p style="color:#898781;font-size:12px;margin-top:24px">Email tự động từ Dashboard Phòng Pháp chế - Kiểm tra.</p>
    </div>`;
}

async function sendMail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await sb.from("v_reminders").select("*").order("deadline");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const rows = (data ?? []) as Row[];
  // Gom theo email người phụ trách (cả mức 1 và mức 2)
  const byEmail = new Map<string, { name: string; rows: Row[] }>();
  for (const r of rows) {
    for (const [email, name] of [[r.handler1_email, r.handler1_name], [r.handler2_email, r.handler2_name]] as const) {
      if (!email) continue;
      if (!byEmail.has(email)) byEmail.set(email, { name: name ?? email, rows: [] });
      byEmail.get(email)!.rows.push(r);
    }
  }

  // Trưởng phòng nhận bản tổng hợp toàn phòng
  const { data: leads } = await sb.from("profiles").select("email,full_name").eq("role", "lead").eq("active", true);

  const sent: string[] = [];
  const errors: string[] = [];
  for (const [email, { name, rows: list }] of byEmail) {
    const overdue = list.filter(r => r.days_left < 0).length;
    const subject = `[Pháp chế] Nhắc việc: ${overdue ? `${overdue} quá hạn, ` : ""}${list.length - overdue} sắp đến hạn`;
    try { await sendMail(email, subject, buildHtml(name, list)); sent.push(email); }
    catch (e) { errors.push(`${email}: ${e}`); }
  }
  if (rows.length && leads?.length) {
    for (const l of leads) {
      if (byEmail.has(l.email)) continue; // đã nhận email cá nhân
      try { await sendMail(l.email, `[Pháp chế] Tổng hợp việc cần chú ý toàn phòng (${rows.length})`, buildHtml(l.full_name, rows)); sent.push(l.email); }
      catch (e) { errors.push(`${l.email}: ${e}`); }
    }
  }
  return new Response(JSON.stringify({ tasks: rows.length, sent, errors }), {
    headers: { "Content-Type": "application/json" },
  });
});
