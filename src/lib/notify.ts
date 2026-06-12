/**
 * notify.ts — Notifications unifiées (Sprint 2 / U3).
 *
 * Remplace les alert() / window.confirm() natifs par :
 *   toast.success / toast.error / toast.info / toast.warning  → pile de toasts
 *   askConfirm({...}) → Promise<boolean> résolue par la modale de confirmation
 *
 * Store module-level (pub/sub) : appelable depuis n'importe quel code (pages,
 * services, handlers async) sans Context React. Le composant <Notifier />
 * (monté une fois dans App) s'abonne et rend l'UI.
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // bouton de confirmation rouge (action destructive)
}

interface ConfirmState extends ConfirmRequest {
  resolve: (answer: boolean) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────
let _toasts: ToastItem[] = [];
let _confirm: ConfirmState | null = null;
let _seq = 1;

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

export function subscribeNotify(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getToasts = (): ToastItem[] => _toasts;
export const getConfirm = (): ConfirmState | null => _confirm;

// ── Toasts ────────────────────────────────────────────────────────────────────
function pushToast(type: ToastType, message: string, durationMs: number) {
  const id = _seq++;
  _toasts = [..._toasts, { id, type, message }];
  emit();
  window.setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: number): void {
  if (!_toasts.some((t) => t.id === id)) return;
  _toasts = _toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (m: string) => pushToast('success', m, 4200),
  info:    (m: string) => pushToast('info', m, 4200),
  warning: (m: string) => pushToast('warning', m, 5500),
  error:   (m: string) => pushToast('error', m, 7000),
};

// ── Confirmation (Promise) ────────────────────────────────────────────────────
export function askConfirm(req: ConfirmRequest): Promise<boolean> {
  // Une seule confirmation à la fois — la précédente est refusée proprement
  if (_confirm) _confirm.resolve(false);
  return new Promise<boolean>((resolve) => {
    _confirm = { ...req, resolve };
    emit();
  });
}

export function resolveConfirm(answer: boolean): void {
  if (!_confirm) return;
  const c = _confirm;
  _confirm = null;
  emit();
  c.resolve(answer);
}
