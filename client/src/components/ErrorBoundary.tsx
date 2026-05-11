/**
 * ErrorBoundary — catches render errors anywhere in the wrapped subtree
 * and surfaces them as a readable UI instead of unmounting to a blank screen.
 *
 * SAFE-TO-ADD: this component is purely additive. If no error is thrown,
 * children render exactly as before. It only takes over when something
 * downstream throws during render or in a lifecycle method.
 *
 * Stack trace + error message are shown on-screen so a user can screenshot
 * and send them to support. Also logged to console for Capacitor / web logs.
 */
import { Component, ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to console for Safari Web Inspector / Capacitor logs / Chrome devtools
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Caught render error:", error, info);
    this.setState({ info });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleSignOut = () => {
    try {
      // Best-effort: clear local auth state and reload to /auth.
      // If localStorage is unavailable, we just reload.
      localStorage.removeItem("spliiit_pending_invite");
    } catch {}
    window.location.hash = "#/";
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, info } = this.state;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-semibold text-foreground">
              Something went wrong
            </h1>
            <p className="text-sm text-muted-foreground">
              The app ran into an unexpected error. You can try reloading.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card/50 p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Error
            </p>
            <p className="text-sm text-foreground break-words">
              {error?.message || "Unknown error"}
            </p>
            {error?.stack && (
              <pre className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">
                {error.stack}
              </pre>
            )}
            {info?.componentStack && (
              <pre className="text-[10px] text-muted-foreground bg-muted/40 p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">
                {info.componentStack}
              </pre>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={this.handleReload}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Reload
            </button>
            <button
              onClick={this.handleSignOut}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border text-foreground text-sm font-medium hover:bg-muted/40 transition-colors"
            >
              Reset & reload
            </button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            Screenshot this and send to support if it keeps happening.
          </p>
        </div>
      </div>
    );
  }
}
