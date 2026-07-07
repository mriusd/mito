import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { onBackendReconnect } from '../lib/backendReconnect';

type Props = {
  children: ReactNode;
  /** Human label for logs (e.g. panel type or "root"). */
  name?: string;
  /**
   * Fallback UI while errored. `retry` force-remounts children.
   * Defaults to a compact auto-retrying notice.
   */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  /** Base auto-retry delay; grows with backoff up to 30s. Default 3000ms. */
  autoRetryMs?: number;
};

type State = {
  error: Error | null;
  /** Bumped to remount the subtree on reset. */
  childKey: number;
  attempt: number;
};

/**
 * Catches render/lifecycle throws so one bad subtree (a rejected lazy import or a
 * component hitting missing data while the backend is down) can't unmount the whole
 * React root and leave a permanently frozen tab. Self-heals: auto-retries with backoff
 * and resets immediately when the backend reconnects.
 */
export class ErrorBoundary extends Component<Props, State> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private offReconnect: (() => void) | null = null;

  state: State = { error: null, childKey: 0, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidMount(): void {
    this.offReconnect = onBackendReconnect(() => {
      if (this.state.error) this.reset();
    });
  }

  componentDidUpdate(_prev: Props, prevState: State): void {
    if (this.state.error && !prevState.error) this.scheduleAutoRetry();
  }

  componentWillUnmount(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.offReconnect?.();
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, error, info.componentStack);
  }

  private scheduleAutoRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const base = this.props.autoRetryMs ?? 3000;
    const delay = Math.min(30_000, base * 2 ** Math.min(this.state.attempt, 4));
    this.retryTimer = setTimeout(() => this.reset(), delay);
  }

  private reset = (): void => {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setState((s) => ({ error: null, childKey: s.childKey + 1, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    const { error, childKey } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
          <p className="text-xs font-semibold text-red-300">Something went wrong here</p>
          <p className="text-[11px] text-gray-400">Retrying automatically…</p>
          <button
            onClick={this.reset}
            className="mt-1 rounded bg-gray-700 px-2 py-1 text-[11px] text-gray-200 hover:bg-gray-600"
          >
            Retry now
          </button>
        </div>
      );
    }
    return <Fragment key={childKey}>{this.props.children}</Fragment>;
  }
}
