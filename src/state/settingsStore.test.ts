/**
 * settingsStore unit tests (Vitest, ipc layer mocked).
 *
 * Covers load: calls getSettings and populates state.
 * Covers setWorkspaceRoot: calls setSettings with the updated settings object
 * and updates local state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as commands from "../ipc/commands";
import { useSettingsStore } from "./settingsStore";
import type { AppSettings } from "../types";

vi.mock("../ipc/commands");

const mockedCommands = vi.mocked(commands);

const defaultSettings: AppSettings = { workspaceRoot: "" };
const customSettings: AppSettings = { workspaceRoot: "/home/ruben/dev" };

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settings: defaultSettings });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("settingsStore.load", () => {
  it("calls getSettings and populates state", async () => {
    mockedCommands.getSettings.mockResolvedValue(customSettings);

    await useSettingsStore.getState().load();

    expect(mockedCommands.getSettings).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().settings).toEqual(customSettings);
  });
});

describe("settingsStore.setWorkspaceRoot", () => {
  it("calls setSettings with updated settings and updates local state", async () => {
    mockedCommands.getSettings.mockResolvedValue(defaultSettings);
    mockedCommands.setSettings.mockResolvedValue(undefined);
    await useSettingsStore.getState().load();

    await useSettingsStore.getState().setWorkspaceRoot("/home/ruben/projects");

    const expected: AppSettings = { workspaceRoot: "/home/ruben/projects" };
    expect(mockedCommands.setSettings).toHaveBeenCalledWith(expected);
    expect(useSettingsStore.getState().settings).toEqual(expected);
  });

  it("updates only workspaceRoot in the settings object", async () => {
    useSettingsStore.setState({ settings: { workspaceRoot: "/old/path" } });
    mockedCommands.setSettings.mockResolvedValue(undefined);

    await useSettingsStore.getState().setWorkspaceRoot("/new/path");

    expect(useSettingsStore.getState().settings.workspaceRoot).toBe("/new/path");
  });
});
