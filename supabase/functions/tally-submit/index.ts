// supabase/functions/tally-submit/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TallyField = {
  key?: string;
  label?: string;
  type?: string;
  value?: unknown;
};

type TallyPayload = {
  eventId?: string;
  eventType?: string;
  createdAt?: string;
  data?: {
    responseId?: string;
    submissionId?: string;
    respondentId?: string;
    formId?: string;
    formName?: string;
    createdAt?: string;
    fields?: TallyField[];
    email?: unknown;
    name?: unknown;
  };
  email?: unknown;
  name?: unknown;
};

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

function requireEnv(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing ${name} env`);
  return v;
}

function extractEmailAndName(payload: TallyPayload) {
  // 1) direct (혹시 다른 소스에서 호출될 때 대비)
  let email = String(payload?.email ?? payload?.data?.email ?? "").trim();
  let name = String(payload?.name ?? payload?.data?.name ?? "").trim();

  const fields = payload?.data?.fields ?? [];

  // 2) Tally 표준: INPUT_EMAIL 타입 우선
  if (!email && Array.isArray(fields)) {
    const emailField = fields.find((f) => f?.type === "INPUT_EMAIL");
    if (emailField?.value) email = String(emailField.value).trim();
  }

  // 3) 이름(브랜드명) - label 기반 (원하면 더 정교하게)
  if (!name && Array.isArray(fields)) {
    const nameField = fields.find((f) => String(f?.label ?? "").includes("브랜드"));
    if (nameField?.value) name = String(nameField.value).trim();
  }

  return { email, name: name || null };
}

async function sendInviteEmail(to: string, inviteCode: string) {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
  const FROM_EMAIL = Deno.env.get("RESEND_FROM") ?? "";
  const SITE_URL = Deno.env.get("SITE_URL") ?? "";

  // 키가 없으면 메일 발송 스킵(개발 중에도 DB는 쌓이게)
  if (!RESEND_API_KEY || !FROM_EMAIL || !SITE_URL) {
    return { ok: false, skipped: true as const };
  }

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;">
      <h2>스톡앤메이크 베타 초대코드</h2>
      <p>아래 코드를 로그인 후 초대코드 입력창에 넣어주세요.</p>
      <div style="font-size: 20px; font-weight: 800; padding: 12px; border: 1px solid #ddd; border-radius: 10px; width: fit-content;">
        ${inviteCode}
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
    const text = await resp.text().catch(() => "");
    return { ok: false, error: text };
  }

  return { ok: true as const };
}

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // ✅ Webhook 시크릿 검증
  const expected = Deno.env.get("TALLY_WEBHOOK_SECRET") ?? "";
  const got = req.headers.get("x-webhook-secret") ?? "";
  if (!expected || got !== expected) return json({ ok: false, error: "unauthorized" }, 401);

  let payload: TallyPayload;
  try {
    payload = (await req.json()) as TallyPayload;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  // (운영시엔 verbose 로그는 줄여도 됨)
  console.log("[tally-submit] eventType =", payload?.eventType);
  console.log("[tally-submit] payload =", JSON.stringify(payload));

  // ✅ Supabase Admin client
  const SUPABASE_URL = requireEnv("SUPABASE_URL");
  const SERVICE_ROLE = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ✅ 이메일/이름 추출
  const { email, name } = extractEmailAndName(payload);
  if (!email) return json({ ok: false, error: "missing_email" }, 400);

  console.log("[tally-submit] extracted email =", email);

  // ✅ 중복 신청 처리: 이미 승인된 적 있으면 기존 코드로 재발송
  const { data: existing, error: exErr } = await sb
    .from("beta_applications")
    .select("email,status,invite_code")
    .eq("email", email)
    .maybeSingle();

  if (exErr) {
    return json({ ok: false, error: "db_error_existing", detail: exErr.message }, 500);
  }

  if (existing?.status === "approved" && existing.invite_code) {
    console.log("[tally-submit] reused invite_code for email =", email);
    const mail = await sendInviteEmail(email, existing.invite_code);

    // 발송 성공이면 기록
    if ((mail as any).ok) {
      await sb.from("beta_applications").update({ invited_email_at: new Date().toISOString() }).eq("email", email);
    }

    return json({ ok: true, reused: true, sent: (mail as any).ok ?? false, skipped: (mail as any).skipped ?? false });
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
      name,
      status: "approved",
      approved_at: new Date().toISOString(),
      invite_code: code,
    },
    { onConflict: "email" },
  );
  if (upErr) return json({ ok: false, error: "db_error_upsert", detail: upErr.message }, 500);

  // ✅ 메일 발송
  console.log("[tally-submit] sending invite email to:", email);
  const mail = await sendInviteEmail(email, code);

  console.log("[tally-submit] env check", {
    hasKey: !!Deno.env.get("RESEND_API_KEY"),
    hasFrom: !!Deno.env.get("RESEND_FROM"),
    hasSite: !!Deno.env.get("SITE_URL"),
  });
  console.log("[tally-submit] mail result =", JSON.stringify(mail));
  

  // 발송 성공이면 기록
  if ((mail as any).ok) {
    await sb.from("beta_applications").update({ invited_email_at: new Date().toISOString() }).eq("email", email);
  }

  return json({ ok: true, sent: (mail as any).ok ?? false, skipped: (mail as any).skipped ?? false });
});
