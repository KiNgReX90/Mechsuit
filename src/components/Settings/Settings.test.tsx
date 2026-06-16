/**
 * Settings panel tests (RTL + Vitest, settings store seeded/stubbed).
 *
 * Covers: closed renders nothing, open shows the current workspace root,
 * close fires onClose, and editing then saving calls setWorkspaceRoot with the
 * new value. Asserts on roles/labels/values, not pixels or CSS classes.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../state/settingsStore";

import { Settings } from "./Settings";

const initialState = useSettingsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  // Seed a known root and stub the async store actions so no ipc is hit.
  useSettingsStore.setState({
    ...initialState,
    settings: { workspaceRoot: "/home/ruben/dev" },
    load: vi.fn().mockResolvedValue(undefined),
    setWorkspaceRoot: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  cleanup();
});

describe("<Settings />", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<Settings open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the current workspace root when open", () => {
    render(<Settings open onClose={() => {}} />);
    expect(screen.getByLabelText("Workspace root")).toHaveValue(
      "/home/ruben/dev",
    );
  });

  it("loads settings from the store when opened", () => {
    render(<Settings open onClose={() => {}} />);
    expect(useSettingsStore.getState().load).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when the close control is activated", () => {
    const onClose = vi.fn();
    render(<Settings open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close Settings" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves an edited workspace root via the store", async () => {
    render(<Settings open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Workspace root"), {
      target: { value: "/home/ruben/projects" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(useSettingsStore.getState().setWorkspaceRoot).toHaveBeenCalledWith(
        "/home/ruben/projects",
      ),
    );
  });
});
