/**
 * ErrorBoundary tests (RTL + Vitest).
 *
 * The boundary's job: a render error in one panel must be caught and shown as a
 * contained fallback, never propagate up and blank the whole app. A throwing
 * child makes React log to console.error (expected); we silence that spy so the
 * test output stays pristine.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("boom");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ErrorBoundary />", () => {
  it("renders its children when they do not throw", () => {
    render(
      <ErrorBoundary label="Workspace">
        <p>healthy</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("renders a contained fallback alert when a child throws", () => {
    // React logs caught render errors via console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary label="Commander">
        <Boom />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Commander/);
    expect(alert).toHaveTextContent(/still running/i);
  });
});
