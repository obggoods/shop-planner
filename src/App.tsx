// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";

import "./App.css";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Master from "./pages/Master";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Pricing from "./pages/Pricing";
import InviteGate from "./pages/InviteGate";
import AdminInvites from "./pages/AdminInvites";
import ResetPassword from "./pages/ResetPassword";

import { supabase, getOrCreateMyProfile } from "./lib/supabaseClient";

type MyProfile = {
  is_invited?: boolean;
};

export default function App() {
  const nav = useNavigate();
  const location = useLocation();

  const [session, setSession] = useState<Session | null>(null);
  const [bootLoading, setBootLoading] = useState(true);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);

  // ✅ 공개 페이지(약관/개인정보/가격)
  const isPublicLegalPage = useMemo(() => {
    const p = location.pathname;
    return p === "/terms" || p === "/privacy" || p === "/pricing";
  }, [location.pathname]);

  // ✅ 인증 페이지(헤더/탭 없이)
  const isAuthPage = useMemo(() => {
    const p = location.pathname;
    return p === "/login" || p === "/reset-password";
  }, [location.pathname]);

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
        setProfile({ is_invited: false });
      } finally {
        if (alive) setProfileLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [session]);

  // ✅ 2) 로그인 상태에서만 관리자 여부 체크
  useEffect(() => {
    let cancelled = false;

    (async () => {
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

  if (bootLoading) return <div className="app-loading">로딩 중...</div>;

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

  // ✅ 2) Auth 페이지(/login, /reset-password)는 헤더/탭 없이
  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to={session ? "/" : "/login"} replace />} />
      </Routes>
    );
  }

  // ✅ 3) 로그인 안 했으면 로그인으로
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // ✅ 4) 로그인 했으면 프로필/관리자 확인이 끝날 때까지 대기
  if (profileLoading || !profile || !adminChecked) {
    return (
      <div className="app-container">
        <Header sessionEmail={session.user.email ?? ""} onHome={() => nav("/")} />
        <div className="app-loading">초대 여부 확인 중…</div>
      </div>
    );
  }

  // ✅ 5) 관리자면 초대 없이 통과, 일반 유저는 초대 필요
  if (!isAdmin && profile.is_invited !== true) {
    return <InviteGate />;
  }

  // ✅ 6) 초대(또는 관리자) 통과 → 앱 화면
  return (
    <div className="app-container">
      <Header
        sessionEmail={session.user.email ?? ""}
        onHome={() => nav("/")}
        onLogout={async () => {
          await supabase.auth.signOut();
          nav("/login");
        }}
      />

      <div className="app-tabs-wrapper">
        <TopTabs isAdmin={isAdmin} />
      </div>

      <div className="app-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/master" element={<Master />} />
          <Route
            path="/admin/invites"
            element={isAdmin ? <AdminInvites /> : <Navigate to="/" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
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
    <div className="app-header">
      <div className="app-header-inner">
        <div className="app-header-row">
          <div className="app-brand" onClick={onHome}>
            스톡앤메이크
          </div>

          <div className="app-header-right">
            <div className="app-userpill">{sessionEmail}</div>

            {onLogout && (
              <button
                onClick={async () => {
                  await onLogout();
                }}
                type="button"
                className="btn-ghost"
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
    <div className="top-tabs">
      <TabButton active={isDash} onClick={() => nav("/")}>
        대시보드
      </TabButton>

      <TabButton active={isMaster} onClick={() => nav("/master")}>
        마스터
      </TabButton>

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
    <button onClick={onClick} type="button" className={`tab-btn ${active ? "is-active" : ""}`}>
      {children}
    </button>
  );
}
