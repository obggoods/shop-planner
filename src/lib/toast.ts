// src/lib/toast.ts
// Lightweight in-app toast (no external dependency).
// Provides a similar API surface to sonner: toast.success/error/message.

export type ToastKind = "success" | "error" | "info";

export type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
};

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(items);
}

function add(kind: ToastKind, message: string) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const next: ToastItem = { id, kind, message, createdAt: Date.now() };
  items = [next, ...items].slice(0, 4);
  emit();

  // Auto dismiss
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 3500);
}

export const toast = {
  success: (message: string) => add("success", message),
  error: (message: string) => add("error", message),
  message: (message: string) => add("info", message),
};

export function subscribeToToasts(listener: Listener) {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}
