import { Component, type ReactNode } from 'react';

interface State { hasError: boolean; message: string }

// ─── Top-level boundary ───────────────────────────────────────────────────────
// Wraps the entire app. When a render error escapes every other boundary,
// this catches it and shows a recoverable "Refresh page" screen instead of
// a silent dark void.

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: unknown, info: { componentStack: string }) {
    console.error('[Iron Booking] render error:', err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen bg-iron-bg flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="w-10 h-10 rounded-lg bg-red-900/30 border border-red-500/30 flex items-center justify-center mx-auto">
              <span className="text-red-400 text-lg font-bold">!</span>
            </div>
            <p className="text-iron-text font-semibold text-sm">Something went wrong</p>
            <p className="text-iron-muted text-xs font-mono break-all leading-relaxed">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-lg bg-iron-green hover:bg-iron-green-light text-white text-sm font-semibold transition-colors"
            >
              Refresh page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Drawer-level boundary ────────────────────────────────────────────────────
// Wraps individual overlay panels (GuestDrawer, CreateDrawer).
// When a modal crashes, this renders a minimal error overlay so:
//   a) the floor view behind it stays intact
//   b) the backdrop is still present and dismissible
//   c) the host gets a clear message + close button

interface DrawerBoundaryProps {
  children: ReactNode;
  onClose: () => void;
}

interface DrawerState { hasError: boolean; message: string }

export class DrawerErrorBoundary extends Component<DrawerBoundaryProps, DrawerState> {
  state: DrawerState = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): DrawerState {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: unknown, info: { componentStack: string }) {
    console.error('[Iron Booking] drawer render error:', err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const { onClose } = this.props;
      return (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
          <aside className="fixed right-0 top-0 h-full w-96 bg-iron-card border-l border-iron-border z-50 flex flex-col shadow-2xl">
            <div className="p-4 border-b border-iron-border shrink-0 flex items-center justify-between">
              <span className="text-red-400 text-sm font-semibold">Panel error</span>
              <button
                onClick={onClose}
                className="text-iron-muted hover:text-iron-text text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4 text-center">
              <p className="text-iron-muted text-xs">This panel encountered an error and could not render.</p>
              <p className="text-iron-muted text-[10px] font-mono break-all">{this.state.message}</p>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-iron-green hover:bg-iron-green-light text-white text-sm font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </aside>
        </>
      );
    }
    return this.props.children;
  }
}

// ─── Board-level boundary ─────────────────────────────────────────────────────
// Wraps the FloorBoard + ReservationPanel area. A render crash shows an inline
// error state (not full-screen) with a Retry button so the rest of the UI
// (TopBar, drawers) stays usable.

interface BoardState { hasError: boolean; message: string }

export class BoardErrorBoundary extends Component<{ children: ReactNode }, BoardState> {
  state: BoardState = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown): BoardState {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: unknown, info: { componentStack: string }) {
    console.error('[Iron Booking] board render error:', err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="w-10 h-10 rounded-lg bg-red-900/30 border border-red-500/30 flex items-center justify-center mx-auto">
              <span className="text-red-400 text-lg font-bold">!</span>
            </div>
            <p className="text-iron-text font-semibold text-sm">Floor board error</p>
            <p className="text-iron-muted text-xs font-mono break-all leading-relaxed">
              {this.state.message}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-5 py-2.5 rounded-lg bg-iron-green hover:bg-iron-green-light text-white text-sm font-semibold transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
