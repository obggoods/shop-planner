import * as React from "react"

import { cn } from "@/lib/utils"

export type AppSectionProps = React.ComponentProps<"section"> & {
  density?: "default" | "tight"
}

/**
 * AppSection
 * - Standardizes vertical spacing between blocks.
 */
export function AppSection({ className, density = "default", ...props }: AppSectionProps) {
  return (
    <section
      className={cn(density === "tight" ? "space-y-4" : "space-y-6", className)}
      {...props}
    />
  )
}
