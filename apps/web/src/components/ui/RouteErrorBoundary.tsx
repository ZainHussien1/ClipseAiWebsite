import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface RouteErrorBoundaryProps {
  routeName: string;
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  override state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Error captured in state for user-visible fallback UI.
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <div className="flex items-center gap-2 text-[var(--danger)]">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          <span className="text-[13px] font-semibold">
            {this.props.routeName} failed to render
          </span>
        </div>
        <p className="text-[12px] text-[var(--text-secondary)]">
          {this.state.error.message || 'An unexpected rendering error occurred.'}
        </p>
        <button
          type="button"
          onClick={this.handleReset}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--input-border)]"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          Retry route
        </button>
      </div>
    );
  }
}
