import { useNavigate } from "react-router-dom"
import { Menu } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export default function Topbar(props: {
  sessionEmail: string
  onLogout: () => Promise<void>
  onOpenSidebar: () => void
}) {
  const { sessionEmail, onLogout, onOpenSidebar } = props
  const nav = useNavigate()

  const initial = (sessionEmail?.trim()?.[0] ?? "?").toUpperCase()

  return (
    <header className="sticky top-0 z-40 w-full h-14 border-b border-sidebar-border bg-background/80 backdrop-blur">
  <div className="mx-auto flex h-14 max-w-full-2xl items-center gap-3 px-4">
        {/* 모바일: 햄버거 + 브랜드 */}
        <div className="flex items-center gap-2 md:hidden">
          <Button variant="ghost" size="icon" onClick={onOpenSidebar} aria-label="메뉴 열기">
            <Menu className="h-5 w-5" />
          </Button>

          <button
            type="button"
            onClick={() => nav("/dashboard")}
            className="font-semibold text-sm hover:opacity-80"
          >
            스톡앤메이크
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
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
              <DropdownMenuItem
                onClick={async () => {
                  await onLogout()
                }}
              >
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
