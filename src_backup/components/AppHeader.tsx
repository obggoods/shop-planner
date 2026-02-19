import { Link, NavLink } from "react-router-dom"
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

type Tab = { to: string; label: string; end?: boolean }

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

export function AppHeader(props: {
  brandName?: string
  tabs: Tab[]
  userEmail?: string | null
  onLogout: () => void
}) {
  const { brandName = "Shop Planner", tabs, userEmail, onLogout } = props
  const initial = (userEmail?.trim()?.[0] ?? "?").toUpperCase()

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-4 px-4">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="text-sm">{brandName}</span>
        </Link>

        {/* Tabs */}
        <nav className="hidden md:flex items-center gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cx(
                  "rounded-md px-3 py-2 text-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent text-accent-foreground"
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Separator orientation="vertical" className="hidden h-6 md:block" />

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs">{initial}</AvatarFallback>
                </Avatar>
                <span className="hidden md:inline text-sm text-muted-foreground">
                  {userEmail ?? "Account"}
                </span>
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout}>로그아웃</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="md:hidden border-t">
        <div className="flex gap-1 overflow-x-auto px-2 py-2">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cx(
                  "shrink-0 rounded-md px-3 py-2 text-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent text-accent-foreground"
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>
    </header>
  )
}
