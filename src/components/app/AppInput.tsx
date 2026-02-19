import * as React from "react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * AppInput
 * - Standardizes input height/spacing across the app.
 */
export type AppInputProps = React.ComponentProps<"input">

export const AppInput = React.forwardRef<HTMLInputElement, AppInputProps>(
  ({ className, ...props }, ref) => {
    return <Input ref={ref} className={cn("h-8", className)} {...props} />
  }
)

AppInput.displayName = "AppInput"
