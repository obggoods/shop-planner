// supabase/functions/approve-application/index.ts
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

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const applicationId = (body?.application_id ?? "").toString().trim();
  if (!applicationId) return json({ ok: false, error: "missing_application_id" }, 400);

  // ✅ 관리자 인증: 프론트가 Authorization Bearer <access_token>로 호출해야 함
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return json({ ok: false, error: "not_authenticated" }, 401);

  // 사용자 확인용 클라이언트(anon + user jwt)
  const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: userData, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "not_authenticated" }, 401);

  const adminUserId = userData.user.id;

  // ✅ admin_users에 있는지 확인
  const { data: adminRow, error: adminErr } = await sb
    .from("admin_users")
    .select("user_id")
    .eq("user_id", adminUserId)
    .maybeSingle();

  if (adminErr) return json({ ok: false, error: "admin_check_failed" }, 500);
  if (!adminRow) return json({ ok: false, error: "not_admin" }, 403);

  // ✅ 베타 30명 제한 체크 (beta_stats 함수 사용)
  const { data: stats, error: statsErr } = await sb.rpc("beta_stats");
  if (statsErr) return json({ ok: false, error: "stats_failed" }, 500);
  const s = Array.isArray(stats) ? stats[0] : stats;
  if (!s) return json({ ok: false, error: "stats_failed" }, 500);
  if ((s.remaining ?? 0) <= 0) return json({ ok: false, error: "beta_limit_reached" }, 400);

  // ✅ 신청 정보 조회
  const { data: app, error: appErr } = await sb
    .from("beta_applications")
    .select("id,email,name,status")
    .eq("id", applicationId)
    .single();

  if (appErr) return json({ ok: false, error: "application_not_found" }, 404);
  if (app.status === "approved") return json({ ok: true, already: true });

  // ✅ 코드 생성 + invite_codes 저장(미사용)
  let code = makeCode();
  for (let i = 0; i < 5; i++) {
    const { error: insErr } = await sb.from("invite_codes").insert({ code, is_used: false });
    if (!insErr) break;
    code = makeCode();
    if (i === 4) return json({ ok: false, error: "code_insert_failed", detail: insErr.message }, 500);
  }

  // ✅ 신청 상태 업데이트
  await sb
    .from("beta_applications")
    .update({ status: "approved", approved_at: new Date().toISOString(), invite_code: code })
    .eq("id", applicationId);

  // ✅ 이메일 발송(Resend) - 키가 없으면 이메일 발송만 스킵하고 승인만 처리
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
  const FROM_EMAIL = Deno.env.get("RESEND_FROM") ?? "";
  const SITE_URL = Deno.env.get("SITE_URL") ?? "";

  if (RESEND_API_KEY && FROM_EMAIL && SITE_URL) {
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
        to: app.email,
        subject: "[스톡앤메이크] 베타 초대코드 안내",
        html,
      }),
    });

    if (resp.ok) {
      await sb
        .from("beta_applications")
        .update({ invited_email_at: new Date().toISOString() })
        .eq("id", applicationId);
    }
  }

  return json({ ok: true, email: app.email });
});
