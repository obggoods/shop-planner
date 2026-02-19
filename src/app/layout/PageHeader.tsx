import type { ReactNode } from "react"

export default function PageHeader(props: {
  title: string
  description?: string
  action?: ReactNode
}) {
  const { title, description, action } = props

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight m-0">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground mt-1">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
