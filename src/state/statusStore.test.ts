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

    it("leaves the first-ever ready ACKNOWLEDGED (no blink) when no prompt was submitted", () => {
      // A freshly-opened session prints its startup banner and settles to ready
      // without the user ever prompting it. That MUST NOT blink — blinking is an
      // alert reserved for a completion the user asked for (see markPrompted).
      useStatusStore.getState().setStatus("session-1", "working");
      useStatusStore.getState().setStatus("session-1", "ready");
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(true);
    });

    it("blinks (acknowledged=false) on the first ready that follows a submitted prompt", () => {
      // Startup settles quietly (acknowledged, no blink)...
      useStatusStore.getState().setStatus("session-1", "working");
      useStatusStore.getState().setStatus("session-1", "ready");
      // ...then the user submits a prompt; the next ready is a real completion.
      useStatusStore.getState().markPrompted("session-1");
      useStatusStore.getState().setStatus("session-1", "working");
      useStatusStore.getState().setStatus("session-1", "ready");
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(false);
    });

    it("KEEPS acknowledged across a new ready when no prompt was submitted since", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      useStatusStore.getState().acknowledge("session-1");
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(true);

      // Incidental background output (a focus-escape redraw, etc.) cycles the
      // session working→ready WITHOUT any new prompt. It must NOT re-alert: an
      // already-seen session stays steady.
      useStatusStore.getState().setStatus("session-1", "working");
      useStatusStore.getState().setStatus("session-1", "ready");
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(true);
    });

    it("re-alerts (acknowledged=false) on the next ready after a prompt was submitted", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      useStatusStore.getState().acknowledge("session-1");

      // The user sends the session a new prompt, then it works and finishes.
      useStatusStore.getState().markPrompted("session-1");
      useStatusStore.getState().setStatus("session-1", "working");
      useStatusStore.getState().setStatus("session-1", "ready");
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(false);
    });

    it("consumes the prompt so a SECOND incidental ready does not re-alert again", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      useStatusStore.getState().acknowledge("session-1");
      useStatusStore.getState().markPrompted("session-1");
      useStatusStore.getState().setStatus("session-1", "ready"); // re-alert (acknowledged=false)
      useStatusStore.getState().acknowledge("session-1"); // user clicks it again

      // A later incidental cycle with no fresh prompt must stay steady.
      useStatusStore.getState().setStatus("session-1", "working");
      useStatusStore.getState().setStatus("session-1", "ready");
      expect(useStatusStore.getState().statusBySession["session-1"].acknowledged).toBe(true);
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

    it("clears a pending prompt so it cannot re-arm a future ready", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      useStatusStore.getState().markPrompted("session-1");
      useStatusStore.getState().acknowledge("session-1");
      expect(useStatusStore.getState().statusBySession["session-1"].promptedSinceAck).toBe(false);
    });
  });

  describe("markPrompted", () => {
    it("arms a re-alert by setting promptedSinceAck", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      useStatusStore.getState().markPrompted("session-1");
      expect(useStatusStore.getState().statusBySession["session-1"].promptedSinceAck).toBe(true);
    });

    it("does not change the session's status", () => {
      useStatusStore.getState().setStatus("session-1", "ready");
      useStatusStore.getState().markPrompted("session-1");
      expect(useStatusStore.getState().statusBySession["session-1"].status).toBe("ready");
    });

    it("is a no-op for unknown session ids", () => {
      useStatusStore.getState().markPrompted("nonexistent");
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
