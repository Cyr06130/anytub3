import { toast } from "sonner";

// The app's one toast seam (Sonner behind it). State modules and screens call
// these instead of the library so the notification stack can change in one
// place — this file replaced the tr-ui toasts during the design-system move.

type ToastInput = { title: string; description?: string };

export function toastSuccess({ title, description }: ToastInput): void {
  toast.success(title, { description });
}

export function toastError({ title, description }: ToastInput): void {
  toast.error(title, { description });
}

export function toastInfo({ title, description }: ToastInput): void {
  toast.info(title, { description });
}

const UNDO_GRACE_MS = 8_000;

/** Undoable-action toast (design system §10: act first, offer Undo — never a
 *  confirmation dialog). The action already happened; Undo reverses it. */
export function toastUndo({ title, description, onUndo }: ToastInput & { onUndo: () => void }): void {
  toast(title, {
    description,
    duration: UNDO_GRACE_MS,
    action: { label: "Undo", onClick: onUndo },
  });
}
