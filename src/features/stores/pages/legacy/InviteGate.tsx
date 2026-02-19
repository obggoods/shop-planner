import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function InviteGate() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const trimmed = useMemo(() => code.trim(), [code]);

  const submit = async () => {
    if (!trimmed) return;
    setBusy(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.rpc("redeem_invite", { p_code: trimmed });
      if (error) throw error;

      if (!data?.ok) {
        const e = data?.error ?? "unknown";
        if (e === "invalid_code") setMsg("초대코드가 올바르지 않아요.");
        else if (e === "already_used") setMsg("이미 사용된 초대코드예요.");
        else if (e === "not_authenticated") setMsg("로그인이 필요해요.");
        else setMsg("처리 중 오류가 발생했어요.");
        return;
      }

      // 성공: 새로고침으로 App의 프로필 재조회 유도(간단)
      window.location.href = "/";
    } catch (e: any) {
      setMsg(e?.message ?? "처리 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pageWrap">
      <div className="pageContainer">
        <h2 style={{ marginTop: 0 }}>초대코드 입력</h2>
        <p style={{ color: "#6b7280", marginTop: 6 }}>
          베타 테스트는 초대된 사용자만 이용할 수 있어요.
        </p>

        <div className="panel" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ flex: "1 1 260px", padding: 10, height: 40, boxSizing: "border-box" }}
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || !trimmed}
              style={{ padding: "10px 14px", height: 40 }}
            >
              {busy ? "확인 중..." : "확인"}
            </button>
          </div>

          {msg && <div style={{ marginTop: 10, color: "crimson", fontSize: 13 }}>{msg}</div>}
        </div>
      </div>
    </div>
  );
}
