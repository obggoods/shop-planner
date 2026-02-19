import { NavLink } from "react-router-dom"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

const navItems = [
  { to: "/dashboard", label: "대시보드" },
  { to: "/products", label: "제품" },
  { to: "/stores", label: "입점처" },
  { to: "/margin", label: "마진 계산기" },
  { to: "/settlements", label: "정산" },
  { to: "/settings", label: "설정" },
  
] as const

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

export default function Sidebar(props: {
  isAdmin: boolean
  mobileOpen: boolean
  onMobileClose: () => void
}) {
  const { isAdmin, mobileOpen, onMobileClose } = props

  const items = [
    ...navItems,
    ...(isAdmin ? [{ to: "/admin/invites", label: "관리자" } as const] : []),
  ]

  const linkClass = (isActive: boolean) =>
    cx(
      "block rounded-lg px-3 py-2 text-sm transition-colors no-underline",
      // ✅ /70 제거, opacity로 처리
      "text-sidebar-foreground opacity-70 hover:opacity-100",
      "hover:bg-sidebar-accent/60",
      isActive && "bg-sidebar-accent text-sidebar-accent-foreground opacity-100"
    )  

  return (
    <>
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:bg-sidebar md:text-sidebar-foreground md:border-sidebar-border">
        <div className="h-14 px-4 flex items-center border-b border-sidebar-border">
          <NavLink to="/dashboard" className="font-semibold text-sm text-sidebar-foreground">
            스톡앤메이크
          </NavLink>
        </div>

        <nav className="flex-1 p-2 space-y-1 text-sidebar-foreground">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) => linkClass(isActive)}
            >
              {it.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* 모바일 오버레이 사이드바 */}
      {mobileOpen ? (
        <div className="md:hidden fixed inset-0 z-50">
          {/* 배경(눌러서 닫기) */}
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={onMobileClose}
            aria-label="메뉴 닫기"
          />

          {/* 패널 */}
          <div className="absolute left-0 top-0 h-full w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-lg p-2">
            <div className="h-14 px-4 flex items-center justify-between border-b border-sidebar-border">
              <NavLink
                to="/dashboard"
                className="font-semibold text-sm text-sidebar-foreground"
                onClick={onMobileClose}
              >
                스톡앤메이크
              </NavLink>

              <Button
                variant="ghost"
                size="icon"
                onClick={onMobileClose}
                aria-label="닫기"
                className="text-sidebar-foreground/80 hover:text-sidebar-foreground"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <nav className="p-2 space-y-1 text-sidebar-foreground">
              {items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  onClick={onMobileClose}
                  className={({ isActive }) => linkClass(isActive)}
                >
                  {it.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  )
}
