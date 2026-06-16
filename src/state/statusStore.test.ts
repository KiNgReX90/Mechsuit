import { beforeEach, describe, expect, it } from "vitest";

import { useStatusStore } from "./statusStore";

const initialState = useStatusStore.getState();

describe("statusStore", () => {
  beforeEach(() => {
    useStatusStore.setState(initialState, true);
  });

  it("starts with an empty statusBySession map", () => {
    expect(useStatusStore.getState().statusBySession).toEqual({});
  });

  describe("setStatus", () => {
    it("upserts a new session entry with the given status", () => {
      useStatusStore.getState().setStatus("session-1", "working");
      const entry = useStatusStore.getState().statusBySession["session-1"];
      expect(entry).toBeDefined();
      expect(entry.status).toBe("working");
    });

    it("updates an existing session's status", () => {
      useStatusStore.getState().setStatus("session-1", "working");
      useStatusStore.getState().setStatus("session-1", "error");
      expect(useStatusStore.getState().statusBySession["session-1"].status).toBe("error");
    });

    it("sets acknowledged to false when transitioning to ready", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(false);
    });

    it("resets acknowledged to false on each new ready, even after acknowledge was called", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      useStatusStore.getState().acknowledge("session-1");
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(true);

      // A fresh ready must re-alert
      useStatusStore.getState().setStatus("session-1", "ready");
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(false);
    });

    it("does not reset acknowledged when transitioning to non-ready statuses", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      useStatusStore.getState().acknowledge("session-1");
      useStatusStore.getState().setStatus("session-1", "working");
      // acknowledged stays as-is for non-ready transitions
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(true);
    });
  });

  describe("acknowledge", () => {
    it("sets acknowledged to true without changing status", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      useStatusStore.getState().acknowledge("session-1");
      const entry = useStatusStore.getState().statusBySession["session-1"];
      expect(entry.acknowledged).toBe(true);
      expect(entry.status).toBe("ready");
    });

    it("is a no-op for unknown session ids", () => {
      useStatusStore.getState().acknowledge("nonexistent");
      expect(useStatusStore.getState().statusBySession["nonexistent"]).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("removes a session entry entirely", () => {
      useStatusStore.getState().setStatus("session-1", "working");
      useStatusStore.getState().clear("session-1");
      expect(useStatusStore.getState().statusBySession["session-1"]).toBeUndefined();
    });

    it("does not affect other sessions when clearing one", () => {
      useStatusStore.getState().setStatus("session-1", "working");
      useStatusStore.getState().setStatus("session-2", "ready");
      useStatusStore.getState().clear("session-1");
      expect(useStatusStore.getState().statusBySession["session-2"]).toBeDefined();
    });

    it("is a no-op for unknown session ids", () => {
      useStatusStore.getState().clear("nonexistent");
      expect(useStatusStore.getState().statusBySession).toEqual({});
    });
  });
});
