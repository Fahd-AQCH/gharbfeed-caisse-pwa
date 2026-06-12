import React, { useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  subscribeNotify,
  getToasts,
  getConfirm,
  dismissToast,
  resolveConfirm,
  ToastItem,
} from '../../lib/notify';

const TOAST_STYLE: Record<ToastItem['type'], { bg: string; border: string; text: string; Icon: React.ElementType; iconColor: string }> = {
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', Icon: CheckCircle2, iconColor: 'text-emerald-500' },
  error:   { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-800',    Icon: XCircle,      iconColor: 'text-rose-500' },
  warning: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-800',   Icon: AlertTriangle, iconColor: 'text-amber-500' },
  info:    { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-800',    Icon: Info,          iconColor: 'text-blue-500' },
};

/**
 * Notifier — monté UNE fois dans App. Rend la pile de toasts (haut-droite)
 * et la modale de confirmation pilotée par askConfirm() (lib/notify).
 */
export default function Notifier() {
  const toasts = useSyncExternalStore(subscribeNotify, getToasts);
  const confirm = useSyncExternalStore(subscribeNotify, getConfirm);

  return (
    <>
      {/* ── Pile de toasts ── */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,380px)] pointer-events-none">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const s = TOAST_STYLE[t.type];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 40, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.95 }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                className={cn(
                  'pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-lg backdrop-blur-sm',
                  s.bg, s.border
                )}
              >
                <s.Icon className={cn('h-5 w-5 shrink-0 mt-0.5', s.iconColor)} />
                <p className={cn('flex-1 text-sm font-bold whitespace-pre-line leading-snug', s.text)}>
                  {t.message}
                </p>
                <button
                  onClick={() => dismissToast(t.id)}
                  className={cn('shrink-0 p-1 rounded-lg hover:bg-white/60 transition-colors', s.text)}
                  aria-label="Fermer"
                >
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── Modale de confirmation ── */}
      <AnimatePresence>
        {confirm && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
              onClick={() => resolveConfirm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="relative w-full max-w-md bg-white rounded-[28px] shadow-2xl overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className={cn(
                    'h-11 w-11 rounded-2xl flex items-center justify-center shrink-0',
                    confirm.danger ? 'bg-rose-100' : 'bg-amber-100'
                  )}>
                    <AlertTriangle className={cn('h-5 w-5', confirm.danger ? 'text-rose-600' : 'text-amber-600')} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-slate-900">{confirm.title}</h3>
                    <p className="text-sm text-slate-500 font-medium mt-1 whitespace-pre-line leading-snug">
                      {confirm.message}
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-6 pb-6 flex justify-end gap-3">
                <button
                  onClick={() => resolveConfirm(false)}
                  className="px-5 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all text-sm"
                  autoFocus
                >
                  {confirm.cancelLabel || 'Annuler'}
                </button>
                <button
                  onClick={() => resolveConfirm(true)}
                  className={cn(
                    'px-6 py-2.5 text-white font-black rounded-2xl transition-all text-sm shadow-lg',
                    confirm.danger
                      ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20'
                      : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20'
                  )}
                >
                  {confirm.confirmLabel || 'Confirmer'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
