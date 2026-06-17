/**
 * A render-error firewall around one region of the app.
 *
 * If a wrapped panel throws during render, React unmounts the whole tree up to
 * the nearest boundary — without one, a single bad render (e.g. an unexpected
 * payload while the network is flaky) blanks the entire window. Wrapping each
 * major region in its own boundary contains the failure: the broken panel shows
 * a small inline notice while the rest of the app keeps running.
 *
 * Class component because error boundaries have no hooks equivalent — only
 * `getDerivedStateFromError` / `componentDidCatch` can catch render errors.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

import "./ErrorBoundary.css";

interface Props {
  /** Human label for the region, shown in the fallback (e.g. "Commander"). */
  label?: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log for diagnosis; deliberately swallow so the error never propagates and
    // takes down the rest of the app.
    console.error(
      `[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const label = this.props.label ?? "This panel";
      return (
        <div className="error-boundary" role="alert">
          {label} hit an error — the rest of the app is still running.
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
