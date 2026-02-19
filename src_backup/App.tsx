// src/App.tsx
import { Suspense, lazy, useEffect, useMemo, useState } from "react"
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom"
import type { Session } from "@supabase/supabase-js"

import "./App.css"

import Login from "./pages/Login"
import Terms from "./pages/Terms"
import Privacy from "./pages/Privacy"
import Pricing from "./pages/Pricing"
import InviteGate from "./pages/InviteGate"
import ResetPassword from "./pages/ResetPassword"
const Dashboard = lazy(() => import("./pages/Dashboard"))
const Master = lazy(() => import("./pages/Master"))
const AdminInvites = lazy(() => import("./pages/AdminInvites"))

import { supabase, getOrCreateMyProfile } from "./lib/supabaseClient"

// shadcn/ui
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"

type MyProfile = {
  is_invited?: boolean
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

export default function App() {
  const nav = useNavigate()
  const location = useLocation()

  const [session, setSession] = useState<Session | null>(null)
  const [bootLoading, setBootLoading] = useState(true)

  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  const [isAdmin, setIsAdmin] = useState(false)
  const [adminChecked, setAdminChecked] = useState(false)

  // ✅ 공개 페이지(약관/개인정보/가격)
  const isPublicLegalPage = useMemo(() => {
    const p = location.pathname
    return p === "/terms" || p === "/privacy" || p === "/pricing"
  }, [location.pathname])

  // ✅ 인증 페이지(헤더/탭 없이)
  const isAuthPage = useMemo(() => {
    const p = location.pathname
    return p === "/login" || p === "/reset-password"
  }, [location.pathname])

  // ✅ 0) 세션 부트스트랩 + Auth 상태 변화 구독
  useEffect(() => {
    let alive = true

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setBootLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setProfile(null)
      setIsAdmin(false)
      setAdminChecked(false)
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // ✅ 1) 로그인 상태에서만 프로필 로드 (초대 여부)
  useEffect(() => {
    let alive = true

    ;(async () => {
      if (!session) return

      try {
        setProfileLoading(true)
        const p = await getOrCreateMyProfile()
        if (!alive) return
        setProfile(p as MyProfile)
      } catch (e) {
        console.error("[App] profile load failed", e)
        if (!alive) return
        setProfile({ is_invited: false })
      } finally {
        if (alive) setProfileLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [session])

  // ✅ 2) 로그인 상태에서만 관리자 여부 체크
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (!session) {
        if (!cancelled) {
          setIsAdmin(false)
          setAdminChecked(true)
        }
        return
      }

      const { data, error } = await supabase.rpc("is_admin")
      if (cancelled) return

      setIsAdmin(!error && !!data)
      setAdminChecked(true)
    })()

    return () => {
      cancelled = true
    }
  }, [session])

  if (bootLoading) return <div className="app-loading">로딩 중...</div>

  // ✅ 1) 공개 페이지는 무조건 통과 (Paddle 심사용)
  if (isPublicLegalPage) {
    return (
      <Routes>
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="*" element={<Navigate to="/terms" replace />} />
      </Routes>
    )
  }

  // ✅ 2) Auth 페이지(/login, /reset-password)는 헤더/탭 없이
  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to={session ? "/" : "/login"} replace />} />
      </Routes>
    )
  }

  // ✅ 3) 로그인 안 했으면 로그인으로
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // ✅ 4) 로그인 했으면 프로필/관리자 확인이 끝날 때까지 대기
  if (profileLoading || !profile || !adminChecked) {
    return (
      <div className="app-container">
        <AppTopBar
          sessionEmail={session.user.email ?? ""}
          isAdmin={false}
          onHome={() => nav("/")}
        />
        <div className="app-loading">초대 여부 확인 중…</div>
      </div>
    )
  }

  // ✅ 5) 관리자면 초대 없이 통과, 일반 유저는 초대 필요
  if (!isAdmin && profile.is_invited !== true) {
    return <InviteGate />
  }

  // ✅ 6) 초대(또는 관리자) 통과 → 앱 화면
  return (
    <div className="app-container">
      <AppTopBar
        sessionEmail={session.user.email ?? ""}
        isAdmin={isAdmin}
        onHome={() => nav("/")}
        onLogout={async () => {
          await supabase.auth.signOut()
          nav("/login")
        }}
      />

<div className="app-content">
  <Suspense fallback={<div className="app-loading">로딩 중...</div>}>
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/master" element={<Master />} />
      <Route
        path="/admin/invites"
        element={isAdmin ? <AdminInvites /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
</div>
    </div>
  )
}

/**
 * Header + TopTabs를 하나로 합쳐서 상단바로 구성 (Tailwind + shadcn)
 * - 기존 App.css 기반 헤더/탭을 대체
 */
function AppTopBar(props: {
  sessionEmail: string
  isAdmin: boolean
  onHome: () => void
  onLogout?: () => Promise<void>
}) {
  const { sessionEmail, isAdmin, onHome, onLogout } = props
  const nav = useNavigate()
  const location = useLocation()

  const initial = (sessionEmail?.trim()?.[0] ?? "?").toUpperCase()

  const tabs = [
    { to: "/", label: "대시보드", active: location.pathname === "/" },
    { to: "/master", label: "마스터", active: location.pathname.startsWith("/master") },
    ...(isAdmin
      ? [
          {
            to: "/admin/invites",
            label: "관리자",
            active: location.pathname.startsWith("/admin/invites"),
          },
        ]
      : []),
  ] as const

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-3 px-4">
        {/* Brand */}
        <button
          type="button"
          onClick={onHome}
          className="font-semibold text-sm hover:opacity-80"
        >
          스톡앤메이크
        </button>

        {/* Tabs (desktop) */}
        <nav className="hidden md:flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.to}
              type="button"
              onClick={() => nav(t.to)}
              className={cx(
                "rounded-md px-3 py-2 text-sm transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                t.active && "bg-accent text-accent-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Separator orientation="vertical" className="hidden h-6 md:block" />

          {/* Account */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs">{initial}</AvatarFallback>
                </Avatar>
                <span className="hidden md:inline text-sm text-muted-foreground">
                  {sessionEmail}
                </span>
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {onLogout ? (
                <DropdownMenuItem
                  onClick={async () => {
                    await onLogout()
                  }}
                >
                  로그아웃
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled>로그아웃</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs (mobile) */}
      <div className="md:hidden border-t">
        <div className="flex gap-1 overflow-x-auto px-2 py-2">
          {tabs.map((t) => (
            <button
              key={t.to}
              type="button"
              onClick={() => nav(t.to)}
              className={cx(
                "shrink-0 rounded-md px-3 py-2 text-sm transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                t.active && "bg-accent text-accent-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}
