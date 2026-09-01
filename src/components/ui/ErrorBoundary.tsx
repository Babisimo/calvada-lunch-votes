// src/components/ui/ErrorBoundary.tsx
//
// Without this, one thrown render — a malformed Firestore document, a network
// blip mid-snapshot — unmounts the tree and leaves a blank white page with no
// indication anything went wrong.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { btn, btnSize, cn, panel } from './styles';

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-canvas p-5 text-ink">
        <section className={cn(panel, 'max-w-md p-6 text-center')}>
          <span aria-hidden="true" className="text-3xl">
            🍽️
          </span>
          <h1 className="mt-3 font-display text-xl font-bold tracking-tight">
            Something broke on our end
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            The lunch vote hit an error it couldn&apos;t recover from. Reloading usually clears it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className={cn(btn.primary, btnSize.md, 'mt-5')}
          >
            <RefreshCw size={16} strokeWidth={2.25} aria-hidden="true" />
            Reload
          </button>
          <details className="mt-5 text-left">
            <summary className="cursor-pointer text-sm text-ink-subtle">Technical details</summary>
            <pre className="mt-2 overflow-x-auto rounded-field bg-surface-muted p-3 text-xs text-ink-muted">
              {error.message}
            </pre>
          </details>
        </section>
      </div>
    );
  }
}
