"use client";

import { Toaster as SonnerToaster, toast } from "sonner";

/**
 * Platform notifications.
 *
 * One toast surface for the whole platform, mounted once in the dashboard shell, so an action's
 * outcome is announced consistently instead of every screen inventing its own banner. The
 * messages are short, plain-language and never carry a raw status code or an internal error.
 *
 * Toasts are *additive* feedback: the inline status next to the control always remains, so a
 * customer who missed the toast (or uses a screen reader) still sees the result.
 */
export function Toaster() {
  return (
    <SonnerToaster
      className="jata-toaster"
      position="bottom-right"
      closeButton
      richColors={false}
      toastOptions={{
        style: {
          background: "var(--jata-card)",
          color: "var(--jata-ink)",
          border: "1px solid var(--jata-line)",
        },
      }}
    />
  );
}

/** Shared, tone-correct notification helpers. */
export const notify = {
  success: (message: string, description?: string) => toast.success(message, { description }),
  error: (message: string, description?: string) => toast.error(message, { description }),
  info: (message: string, description?: string) => toast(message, { description }),
  loading: (message: string) => toast.loading(message),
  dismiss: (id?: string | number) => toast.dismiss(id),
};

export { toast };
export default Toaster;
