// src/components/ui/ConfirmDialog.tsx
//
// Replaces native window.confirm() for destructive actions. Native confirm is
// unstyleable browser chrome, breaks the visual language, and is suppressible.
//
// Usage:
//   const { confirm, confirmDialog } = useConfirm();
//   ...
//   if (!(await confirm({ title: 'Delete X?', tone: 'danger' }))) return;
//   ...
//   return (<>{confirmDialog}...</>);

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { btn, btnSize, cn } from './styles';

export type ConfirmOptions = {
  title: string;
  /** One sentence on what happens. Say the consequence, not "are you sure". */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
};

export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    // A second call while one is open resolves the first as cancelled.
    resolverRef.current?.(false);
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (!options) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [options, settle]);

  // Never leave a caller awaiting forever if the page unmounts.
  useEffect(() => () => resolverRef.current?.(false), []);

  const isDanger = options?.tone === 'danger';

  const confirmDialog = options ? (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 backdrop-blur-[2px] sm:items-center"
      onClick={() => settle(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={options.body ? 'confirm-body' : undefined}
        className="w-full max-w-md rounded-panel border border-border bg-surface p-6 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-4">
          {isDanger && (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-50 text-danger-600"
            >
              <AlertTriangle size={20} strokeWidth={2.25} />
            </span>
          )}
          <div className="min-w-0">
            <h2 id="confirm-title" className="font-display text-lg font-bold text-ink">
              {options.title}
            </h2>
            {options.body && (
              <p id="confirm-body" className="mt-1.5 text-sm text-ink-muted">
                {options.body}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => settle(false)}
            className={cn(btn.secondary, btnSize.md)}
          >
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => settle(true)}
            className={cn(isDanger ? btn.danger : btn.primary, btnSize.md)}
          >
            {options.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, confirmDialog };
}
