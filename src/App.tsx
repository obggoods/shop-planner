import { useEffect, useState } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Master from "./pages/Master";
import { supabase } from "./lib/supabaseClient";

import type { Session } from "@supabase/supabase-js";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ 추가: 페이지 탭 상태
  const [page, setPage] = useState<"dashboard" | "master">("dashboard");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      // 로그인/로그아웃 후 기본 화면은 대시보드로
      setPage("dashboard");
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const onLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return <div style={{ padding: 16 }}>로딩 중...</div>;
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div>
      {/* 상단바 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 12,
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ fontWeight: 700 }}>Shop Planner</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ opacity: 0.7, fontSize: 13 }}>{session.user.email}</div>
          <button onClick={onLogout}>로그아웃</button>
        </div>
      </div>

      {/* ✅ 추가: 네비 탭 */}
      <div style={{ display: "flex", gap: 8, padding: 12 }}>
        <button
          type="button"
          onClick={() => setPage("dashboard")}
          style={{
            fontWeight: page === "dashboard" ? 800 : 400,
            borderBottom: page === "dashboard" ? "2px solid #111827" : "2px solid transparent",
            paddingBottom: 6,
          }}
        >
          대시보드
        </button>

        <button
          type="button"
          onClick={() => setPage("master")}
          style={{
            fontWeight: page === "master" ? 800 : 400,
            borderBottom: page === "master" ? "2px solid #111827" : "2px solid transparent",
            paddingBottom: 6,
          }}
        >
          마스터
        </button>
      </div>

      {/* ✅ 화면 전환 */}
      {page === "dashboard" ? <Dashboard /> : <Master />}
    </div>
  );
}
