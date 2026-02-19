import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function EmptyState(props: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  const { title, description, action, className } = props
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border bg-background p-8 text-center", className)}>
      <div className="text-base font-medium">{title}</div>
      {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
