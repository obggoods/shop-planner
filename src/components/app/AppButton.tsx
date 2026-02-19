import * as React from "react"

import type { VariantProps } from "class-variance-authority"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * AppButton
 * - App-wide default size/height is unified here.
 * - Prefer importing this component instead of shadcn's Button directly.
 */
export type AppButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

export function AppButton({
  className,
  variant = "default",
  // shadcn default is h-9; for this app we standardize to h-10.
  size = "lg",
  ...props
}: AppButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(size === "lg" ? "h-10" : null, className)}
      {...props}
    />
  )
}
