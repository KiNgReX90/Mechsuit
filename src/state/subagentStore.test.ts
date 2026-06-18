import { beforeEach, describe, expect, it } from "vitest";

import type { SubagentNode } from "../types";
import { useSubagentStore } from "./subagentStore";

const initialState = useSubagentStore.getState();

const node = (id: string, label = "subagent", status: SubagentNode["status"] = "working"): SubagentNode => ({
  id,
  label,
  status,
});

describe("subagentStore", () => {
  beforeEach(() => {
    useSubagentStore.setState(initialState, true);
  });

  it("starts with an empty subagentsBySession map", () => {
    expect(useSubagentStore.getState().subagentsBySession).toEqual({});
  });

  describe("set", () => {
    it("stores a session's subagent list keyed by sessionId", () => {
      const nodes = [node("session-1:sub-0", "Explore", "working")];
      useSubagentStore.getState().set("session-1", nodes);
      expect(useSubagentStore.getState().subagentsBySession["session-1"]).toEqual(nodes);
    });

    it("replaces a session's list authoritatively rather than appending", () => {
      useSubagentStore.getState().set("session-1", [node("session-1:sub-0", "A", "working")]);
      useSubagentStore.getState().set("session-1", [node("session-1:sub-0", "A", "ready")]);
      const list = useSubagentStore.getState().subagentsBySession["session-1"];
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe("ready");
    });

    it("keeps sessions independent of one another", () => {
      useSubagentStore.getState().set("session-1", [node("session-1:sub-0")]);
      useSubagentStore.getState().set("session-2", [node("session-2:sub-0")]);
      expect(useSubagentStore.getState().subagentsBySession["session-1"]).toHaveLength(1);
      expect(useSubagentStore.getState().subagentsBySession["session-2"]).toHaveLength(1);
    });
  });

  describe("clear", () => {
    it("removes a session entry entirely", () => {
      useSubagentStore.getState().set("session-1", [node("session-1:sub-0")]);
      useSubagentStore.getState().clear("session-1");
      expect(useSubagentStore.getState().subagentsBySession["session-1"]).toBeUndefined();
    });

    it("does not affect other sessions when clearing one", () => {
      useSubagentStore.getState().set("session-1", [node("session-1:sub-0")]);
      useSubagentStore.getState().set("session-2", [node("session-2:sub-0")]);
      useSubagentStore.getState().clear("session-1");
      expect(useSubagentStore.getState().subagentsBySession["session-2"]).toBeDefined();
    });

    it("is a no-op for unknown session ids", () => {
      useSubagentStore.getState().clear("nonexistent");
      expect(useSubagentStore.getState().subagentsBySession).toEqual({});
    });
  });
});
