// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Master from "./pages/Master";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Pricing from "./pages/Pricing";
import InviteGate from "./pages/InviteGate";
import AdminInvites from "./pages/AdminInvites";

import { supabase, getOrCreateMyProfile } from "./lib/supabaseClient";

type MyProfile = {
  is_invited?: boolean;
};

export default function App() {
  const nav = useNavigate();
  const location = useLocation();

  const [session, setSession] = useState<Session | null>(null);
  const [bootLoading, setBootLoading] = useState(true);

  // 초대 여부 확인용
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // 관리자 여부(InviteGate 우회용)
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);

  // ✅ 공개 페이지(약관/개인정보/가격) 여부
  const isPublicLegalPage = useMemo(() => {
    const p = location.pathname;
    return p === "/terms" || p === "/privacy" || p === "/pricing";
  }, [location.pathname]);

  const hideHeaderOnPublicPages = true;
  const showHeader = !!session && !(hideHeaderOnPublicPages && isPublicLegalPage);

  // ✅ 0) 세션 부트스트랩 + Auth 상태 변화 구독
  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setBootLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      // 세션이 바뀌면 관련 상태 초기화
      setProfile(null);
      setIsAdmin(false);
      setAdminChecked(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ✅ 1) 로그인 상태에서만 프로필 로드 (초대 여부)
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!session) return;

      try {
        setProfileLoading(true);
        const p = await getOrCreateMyProfile();
        if (!alive) return;
        setProfile(p as MyProfile);
      } catch (e) {
        console.error("[App] profile load failed", e);
        if (!alive) return;
        // 초대 흐름에서는 실패 시 막는게 안전
        setProfile({ is_invited: false });
      } finally {
        if (alive) setProfileLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [session]);

  // ✅ 2) 로그인 상태에서만 관리자 여부 체크 (InviteGate 우회)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 세션 없으면 체크 불필요
      if (!session) {
        if (!cancelled) {
          setIsAdmin(false);
          setAdminChecked(true);
        }
        return;
      }

      const { data, error } = await supabase.rpc("is_admin");
      if (cancelled) return;

      setIsAdmin(!error && !!data);
      setAdminChecked(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  // ✅ 부팅 로딩
  if (bootLoading) {
    return <div style={{ padding: 16 }}>로딩 중...</div>;
  }

  // ✅ 1) 공개 페이지는 무조건 통과 (Paddle 심사용)
  if (isPublicLegalPage) {
    return (
      <Routes>
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="*" element={<Navigate to="/terms" replace />} />
      </Routes>
    );
  }

  // ✅ 2) 로그인 안 했으면 로그인으로
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // ✅ 3) 로그인 했으면 프로필/관리자 확인이 끝날 때까지 대기
  if (profileLoading || !profile || !adminChecked) {
    return (
      <div>
        {showHeader && (
          <Header
            sessionEmail={session.user.email ?? ""}
            onHome={() => nav("/")}
          />
        )}
        <div style={{ padding: 16 }}>초대 여부 확인 중…</div>
      </div>
    );
  }

  // ✅ 4) 관리자면 초대 없이 통과, 일반 유저는 초대 필요
  if (!isAdmin && profile.is_invited !== true) {
    return <InviteGate />;
  }

  // ✅ 5) 초대(또는 관리자) 통과 → 앱 화면
  return (
    <div style={{ color: "#111827" }}>
      {showHeader && (
        <Header
          sessionEmail={session.user.email ?? ""}
          onHome={() => nav("/")}
          onLogout={async () => {
            await supabase.auth.signOut();
            nav("/");
          }}
        />
      )}

      {showHeader && (
        <div style={{ paddingBottom: 12, maxWidth: 860, margin: "0 auto" }}>
          <div style={{ padding: "0 16px" }}>
            <TopTabs isAdmin={isAdmin} />
          </div>
        </div>
      )}

      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={<Dashboard />} />
        <Route path="/master" element={<Master />} />

        {/* 관리자만 탭이 보이지만, 라우트 접근은 AdminInvites 내부에서도 한 번 더 막는게 안전 */}
        <Route path="/admin/invites" element={<AdminInvites />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function Header({
  sessionEmail,
  onHome,
  onLogout,
}: {
  sessionEmail: string;
  onHome: () => void;
  onLogout?: () => Promise<void>;
}) {
  return (
    <div style={{ background: "white", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 0",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18, cursor: "pointer" }} onClick={onHome}>
            스톡앤메이크
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                fontSize: 13,
                padding: "6px 10px",
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 10,
              }}
            >
              {sessionEmail}
            </div>

            {onLogout && (
              <button
                onClick={async () => {
                  await onLogout();
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                로그아웃
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TopTabs({ isAdmin }: { isAdmin: boolean }) {
  const nav = useNavigate();
  const location = useLocation();

  const isDash = location.pathname === "/";
  const isMaster = location.pathname.startsWith("/master");
  const isAdminInvites = location.pathname.startsWith("/admin/invites");

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <TabButton active={isDash} onClick={() => nav("/")}>
        대시보드
      </TabButton>

      <TabButton active={isMaster} onClick={() => nav("/master")}>
        마스터
      </TabButton>

      {/* ✅ 관리자만 탭 노출 */}
      {isAdmin && (
        <TabButton active={isAdminInvites} onClick={() => nav("/admin/invites")}>
          관리자
        </TabButton>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.12)",
        background: active ? "#111827" : "white",
        color: active ? "white" : "#111827",
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
