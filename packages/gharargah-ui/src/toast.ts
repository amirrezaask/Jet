import { toast } from "sonner"

export type GharargahVariant = "default" | "info" | "warning" | "destructive" | "success"

export type JetToastOptions = {
  variant?: GharargahVariant
  description?: string
}

export function showGharargahToast(message: string, options: JetToastOptions = {}): void {
  const { variant = "default", description } = options
  switch (variant) {
    case "destructive":
      toast.error(message, { description })
      return
    case "warning":
      toast.warning(message, { description })
      return
    case "info":
      toast.info(message, { description })
      return
    case "success":
      toast.success(message, { description })
      return
    default:
      toast(message, { description })
  }
}
