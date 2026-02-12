// supabase/functions/tally-submit/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len: number) =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `BETA-${part(4)}-${part(4)}`;
}

async function sendEmail(to: string, code: string) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
  const FROM_EMAIL = Deno.env.get("RESEND_FROM") ?? "";
  const SITE_URL = Deno.env.get("SITE_URL") ?? "";

  // 키가 없으면 메일 발송 스킵(개발 중에도 DB는 쌓이게)
  if (!RESEND_API_KEY || !FROM_EMAIL || !SITE_URL) return { ok: false, skipped: true };

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;">
      <h2>스톡앤메이크 베타 초대코드</h2>
      <p>아래 코드를 로그인 후 초대코드 입력창에 넣어주세요.</p>
      <div style="font-size: 20px; font-weight: 800; padding: 12px; border: 1px solid #ddd; border-radius: 10px; width: fit-content;">
        ${code}
      </div>
      <p style="margin-top: 16px;">
        접속 링크: <a href="${SITE_URL}">${SITE_URL}</a>
      </p>
      <p style="color:#666; font-size:12px;">본 코드는 1회용입니다.</p>
    </div>
  `;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: "[스톡앤메이크] 베타 초대코드 안내",
      html,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, error: text };
  }
  return { ok: true };
}

async function sendInviteEmail(params: {
  to: string;
  name?: string | null;
  inviteCode: string;
  appBaseUrl: string;
}) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const RESEND_FROM = Deno.env.get("RESEND_FROM");

  if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY secret");
  if (!RESEND_FROM) throw new Error("Missing RESEND_FROM secret");

  const { to, name, inviteCode, appBaseUrl } = params;

  const loginUrl = `${appBaseUrl}/login`; // 너희 라우팅에 맞게 필요시 조정
  const subject = "[Stock&Make 베타] 초대코드가 발급되었습니다";
  const html = `
  <div style="font-family: Arial, sans-serif; line-height: 1.6;">
    <h2>베타 신청이 접수되었습니다 👋</h2>
    <p>${name ? `${name}님,` : ""} 아래 초대코드를 사용해 가입을 완료해 주세요.</p>
    <p style="font-size: 18px;"><b>초대코드: ${inviteCode}</b></p>
    <p>
      1) 로그인: <a href="${loginUrl}">${loginUrl}</a><br/>
      2) 로그인 후 초대코드 입력 화면에서 위 코드를 입력
    </p>
    <p style="color:#666; font-size: 12px;">
      본 메일은 발신전용입니다.
    </p>
  </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Resend send failed: ${resp.status} ${resp.statusText} ${text}`);
  }

  return await resp.json().catch(() => ({}));
}


serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // ✅ Webhook 시크릿 검증
  const secret = Deno.env.get("TALLY_WEBHOOK_SECRET") ?? "";
  const got = req.headers.get("x-webhook-secret") ?? "";
  if (!secret || got !== secret) return json({ ok: false, error: "unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

// 🔥 테스트 모드 (curl 등으로 호출할 때) - payload/sb 사용
if (payload?.test === true && typeof payload?.email === "string") {
  const email = payload.email.trim();
  const name = (payload?.name ?? null) as string | null;

  console.log("[tally-submit] TEST MODE email =", email);

  // 기존 로직과 동일하게: 베타 제한 체크 → 코드 발급 → beta_applications upsert → 이메일 발송

  // ✅ 베타 30명 제한 체크 (profiles.is_invited 기반)
  const { data: stats, error: statsErr } = await sb.rpc("beta_stats");
  if (statsErr) return json({ ok: false, error: "stats_failed", detail: statsErr.message }, 500);
  const s = Array.isArray(stats) ? stats[0] : stats;
  if (!s || (s.remaining ?? 0) <= 0) return json({ ok: false, error: "beta_limit_reached" }, 400);

  // ✅ 코드 생성 + invite_codes insert (충돌 대비 재시도)
  let code = makeCode();
  for (let i = 0; i < 5; i++) {
    const { error: insErr } = await sb.from("invite_codes").insert({ code, is_used: false });
    if (!insErr) break;
    code = makeCode();
    if (i === 4) return json({ ok: false, error: "code_insert_failed", detail: insErr.message }, 500);
  }

  // ✅ 신청 저장(approved로 바로 저장)
  const { error: upErr } = await sb.from("beta_applications").upsert(
    {
      email,
      name: name || null,
      status: "approved",
      approved_at: new Date().toISOString(),
      invite_code: code,
    },
    { onConflict: "email" },
  );
  if (upErr) return json({ ok: false, error: "db_error", detail: upErr.message }, 500);

  // ✅ 메일 발송 (기존 sendEmail 사용)
  const mail = await sendEmail(email, code);

  // 발송 성공이면 기록
  if ((mail as any).ok) {
    await sb
      .from("beta_applications")
      .update({ invited_email_at: new Date().toISOString() })
      .eq("email", email);
  }

  return json({ ok: true, test: true, sent: (mail as any).ok ?? false, skipped: (mail as any).skipped ?? false });
}

  // ✅ 이메일/이름 추출(안전망)
  const directEmail = (payload?.email ?? payload?.data?.email ?? "").toString().trim();
  const directName = (payload?.name ?? payload?.data?.name ?? "").toString().trim();

  let email = directEmail;
  let name = directName;

  const fields = payload?.data?.fields ?? payload?.fields ?? [];
  if (!email && Array.isArray(fields)) {
    const e = fields.find((f: any) => (f?.key ?? f?.name ?? "").toString().toLowerCase().includes("email"));
    if (e?.value) email = e.value.toString().trim();

    const n = fields.find((f: any) => (f?.key ?? f?.name ?? "").toString().toLowerCase().includes("name"));
    if (n?.value) name = n.value.toString().trim();
  }

  if (!email) return json({ ok: false, error: "missing_email" }, 400);

  // ✅ 중복 신청 방지: 이미 승인된 적 있으면 재발송(또는 거절)
  const { data: existing } = await sb
    .from("beta_applications")
    .select("id,status,invite_code")
    .eq("email", email)
    .maybeSingle();

  if (existing?.status === "approved" && existing.invite_code) {
    // 이미 발급된 코드가 있으면 그대로 재발송(운영 친화)
    await sendEmail(email, existing.invite_code);
    return json({ ok: true, reused: true });
  }

  // ✅ 베타 30명 제한 체크 (profiles.is_invited 기반)
  const { data: stats, error: statsErr } = await sb.rpc("beta_stats");
  if (statsErr) return json({ ok: false, error: "stats_failed", detail: statsErr.message }, 500);
  const s = Array.isArray(stats) ? stats[0] : stats;
  if (!s || (s.remaining ?? 0) <= 0) return json({ ok: false, error: "beta_limit_reached" }, 400);

  // ✅ 코드 생성 + invite_codes insert (충돌 대비 재시도)
  let code = makeCode();
  for (let i = 0; i < 5; i++) {
    const { error: insErr } = await sb.from("invite_codes").insert({ code, is_used: false });
    if (!insErr) break;
    code = makeCode();
    if (i === 4) return json({ ok: false, error: "code_insert_failed", detail: insErr.message }, 500);
  }

  // ✅ 신청 저장(approved로 바로 저장)
  const { error: upErr } = await sb.from("beta_applications").upsert(
    {
      email,
      name: name || null,
      status: "approved",
      approved_at: new Date().toISOString(),
      invite_code: code,
    },
    { onConflict: "email" },
  );
  if (upErr) return json({ ok: false, error: "db_error", detail: upErr.message }, 500);

  // ✅ 메일 발송
  const mail = await sendEmail(email, code);

  // 발송 성공이면 기록
  if (mail.ok) {
    await sb
      .from("beta_applications")
      .update({ invited_email_at: new Date().toISOString() })
      .eq("email", email);
  }

  return json({ ok: true, sent: mail.ok, skipped: (mail as any).skipped ?? false });
});
