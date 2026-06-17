import { afterEach, describe, expect, it } from "vitest";

import { usePausedStore } from "./pausedStore";

afterEach(() => usePausedStore.setState({ pausedIds: new Set() }));

describe("pausedStore", () => {
  it("adds and removes ids as sessions pause and resume", () => {
    usePausedStore.getState().setPaused("s1", true);
    expect(usePausedStore.getState().pausedIds.has("s1")).toBe(true);

    usePausedStore.getState().setPaused("s1", false);
    expect(usePausedStore.getState().pausedIds.has("s1")).toBe(false);
  });
});
