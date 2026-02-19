import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type InviteRow = {
  code: string;
  is_used: boolean;
  created_at: string;
  used_at: string | null;
  used_by: string | null;
};

export default function AdminInvites() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issueCount, setIssueCount] = useState<number>(20);
  const [issuedCodes, setIssuedCodes] = useState<string[]>([]);
  const [err, setErr] = useState<string>("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showUsed, setShowUsed] = useState<boolean>(true); // 사용된 코드도 보여줄지
  const [filterMode, setFilterMode] = useState<"all" | "unused">("all"); // 필터 모드
  const [betaInvitedCount, setBetaInvitedCount] = useState<number>(0);
  const [betaLimit, setBetaLimit] = useState<number>(30);
  const [betaRemaining, setBetaRemaining] = useState<number>(30);

  const unusedCount = useMemo(
    () => rows.filter((r) => !r.is_used).length,
    [rows]
  );

  const visibleRows = useMemo(() => {
    let list = rows;
  
    // 1) 필터 모드가 미사용만이면 미사용만
    if (filterMode === "unused") {
      list = list.filter((r) => !r.is_used);
    }
  
    // 2) showUsed가 false면 사용된 것 숨김
    if (!showUsed) {
      list = list.filter((r) => !r.is_used);
    }
  
    return list;
  }, [rows, filterMode, showUsed]);  

  async function checkAdmin() {
    setErr("");
    const { data, error } = await supabase.rpc("is_admin");
    if (error) {
      setIsAdmin(false);
      setErr(error.message);
      return;
    }
    setIsAdmin(!!data);
  }

  async function loadInvites() {
    setLoading(true);
    setErr("");
    setIssuedCodes([]);
    const { data, error } = await supabase.rpc("admin_list_invites");
    setLoading(false);

    if (error) {
      setErr(error.message);
      return;
    }
    setRows((data ?? []) as InviteRow[]);
  }

  async function issueInvites() {
    setLoading(true);
    setErr("");
    const count = Math.max(1, Math.min(500, Number(issueCount) || 20));

    const { data, error } = await supabase.rpc("admin_issue_invites", {
      p_count: count,
    });

    setLoading(false);

    if (error) {
      setErr(error.message);
      return;
    }

    const codes = (data ?? []).map((x: any) => x.out_code).filter(Boolean);
    setIssuedCodes(codes);
    await loadInvites();
  }

  async function revoke(code: string) {
    if (!confirm(`미사용 코드만 회수(삭제)돼요.\n회수할까요?\n\n${code}`)) return;

    setLoading(true);
    setErr("");

    const { data, error } = await supabase.rpc("admin_revoke_invite", {
      p_code: code,
    });

    setLoading(false);

    if (error) {
      setErr(error.message);
      return;
    }

    if (!data?.ok) {
      setErr(data?.error ?? "revoke_failed");
      return;
    }

    await loadInvites();
  }

  async function copyIssued() {
    const text = issuedCodes.join("\n");
    await navigator.clipboard.writeText(text);
    alert("발급된 코드 목록을 복사했어!");
  }

  async function copySingle(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
  
      setTimeout(() => {
        setCopiedCode(null);
      }, 1000); // 1초 후 원래대로
    } catch (e) {
      console.error(e);
    }
  }  

  async function loadBetaStats() {
    const { data, error } = await supabase.rpc("beta_stats");
    if (error) return;
  
    // data는 table return이라 보통 배열로 옴
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
  
    setBetaInvitedCount(row.invited_count ?? 0);
    setBetaLimit(row.beta_limit ?? 30);
    setBetaRemaining(row.remaining ?? 0);
  }

  useEffect(() => {
    (async () => {
      await checkAdmin();
    })();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadInvites();
      loadBetaStats();
    }
  }, [isAdmin]);

  if (isAdmin === null) return <div style={{ padding: 16 }}>관리자 권한 확인 중…</div>;

  if (!isAdmin) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Admin Invites</h2>
        <p>이 페이지는 운영자만 접근할 수 있어요.</p>
        {err && <pre style={{ whiteSpace: "pre-wrap", color: "crimson" }}>{err}</pre>}
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 8 }}>초대코드 관리자</h2>

      {err && (
        <div style={{ background: "#ffe7e7", padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <b>에러:</b> {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={loadInvites} disabled={loading}>
          목록 새로고침
        </button>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
  <span style={{ fontSize: 13, opacity: 0.8 }}>보기</span>

  <button
    type="button"
    onClick={() => setFilterMode("all")}
    disabled={loading}
    style={{
      padding: "6px 10px",
      borderRadius: 10,
      border: "1px solid rgba(0,0,0,0.12)",
      background: filterMode === "all" ? "#111827" : "white",
      color: filterMode === "all" ? "white" : "#111827",
      fontWeight: 800,
      cursor: "pointer",
    }}
  >
    전체
  </button>

  <button
    type="button"
    onClick={() => setFilterMode("unused")}
    disabled={loading}
    style={{
      padding: "6px 10px",
      borderRadius: 10,
      border: "1px solid rgba(0,0,0,0.12)",
      background: filterMode === "unused" ? "#111827" : "white",
      color: filterMode === "unused" ? "white" : "#111827",
      fontWeight: 800,
      cursor: "pointer",
    }}
  >
    미사용만
  </button>

  <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, fontSize: 13 }}>
    <input
      type="checkbox"
      checked={showUsed}
      onChange={(e) => setShowUsed(e.target.checked)}
    />
    사용된 코드 보기
  </label>
</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>발급 개수</span>
          <input
            type="number"
            value={issueCount}
            min={1}
            max={500}
            onChange={(e) => setIssueCount(Number(e.target.value))}
            style={{ width: 90 }}
          />
          <button onClick={issueInvites} disabled={loading}>
            코드 발급
          </button>
        </div>

        <div style={{ marginLeft: "auto" }}>
  <b>베타:</b> {betaInvitedCount}/{betaLimit} (남은 {betaRemaining}){" "}
  · <b>미사용:</b> {unusedCount} / <b>전체:</b> {rows.length} / <b>표시중:</b> {visibleRows.length}
</div>

    </div>

      {issuedCodes.length > 0 && (
        <div style={{ marginBottom: 12, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <b>방금 발급된 코드</b>
            <button onClick={copyIssued}>복사</button>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
            {issuedCodes.join("\n")}
          </pre>
        </div>
      )}

      <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "260px 90px 200px 200px 1fr", padding: 10, background: "#f7f7f7", fontWeight: 700 }}>
          <div>code</div>
          <div>used</div>
          <div>created_at</div>
          <div>used_at</div>
          <div>actions</div>
        </div>

        {visibleRows.map((r) => (
          <div
            key={r.code}
            style={{
              display: "grid",
              gridTemplateColumns: "260px 90px 200px 200px 1fr",
              padding: 10,
              borderTop: "1px solid #eee",
              alignItems: "center",
              opacity: r.is_used ? 0.55 : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
  <div style={{ fontFamily: "monospace" }}>{r.code}</div>

  {!r.is_used && (
    <button
      onClick={() => copySingle(r.code)}
      style={{
        fontSize: 12,
        padding: "4px 8px",
        borderRadius: 6,
        border: "1px solid rgba(0,0,0,0.15)",
        background: copiedCode === r.code ? "#16a34a" : "white",
        color: copiedCode === r.code ? "white" : "black",
        cursor: "pointer",
      }}
    >
      {copiedCode === r.code ? "복사됨!" : "복사"}
    </button>
  )}
</div>

            <div>{r.is_used ? "YES" : "NO"}</div>
            <div>{new Date(r.created_at).toLocaleString()}</div>
            <div>{r.used_at ? new Date(r.used_at).toLocaleString() : "-"}</div>
            <div>
              {!r.is_used ? (
                <button onClick={() => revoke(r.code)} disabled={loading}>
                  회수(삭제)
                </button>
              ) : (
                <span style={{ color: "#666" }}>사용됨(회수불가)</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
