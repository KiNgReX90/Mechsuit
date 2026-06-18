import { describe, expect, it } from "vitest";

import { parseSubagents } from "./subagentParser";

describe("subagentParser", () => {
  describe("graceful degradation", () => {
    it("returns no subagents for empty input", () => {
      expect(parseSubagents("")).toEqual([]);
    });

    it("returns no subagents for plain-shell output", () => {
      const shell = "$ ls -la\ntotal 12\ndrwxr-xr-x 3 user user 4096 src\n$ npm test\n";
      expect(parseSubagents(shell)).toEqual([]);
    });

    it("does not fire on the word 'task' mid-sentence", () => {
      expect(parseSubagents("Your next task is to run the build.\n")).toEqual([]);
    });

    it("ignores ANSI noise without Task markers", () => {
      const noise = "\x1b[2K\x1b[1;32mready\x1b[0m\n\x1b[H\x1b[J";
      expect(parseSubagents(noise)).toEqual([]);
    });

    it("never throws on garbage input", () => {
      expect(() => parseSubagents("\x00\x07Task(\x1b[")).not.toThrow();
    });
  });

  describe("Task header detection", () => {
    it("detects a running Task and reads its label", () => {
      const out = "● Task(Explore the codebase)\n  ⎿ Running…\n";
      const subs = parseSubagents(out);
      expect(subs).toHaveLength(1);
      expect(subs[0].label).toBe("Explore the codebase");
      expect(subs[0].state).toBe("running");
    });

    it("detects a Task through ANSI styling", () => {
      const out = "\x1b[1m●\x1b[0m \x1b[36mTask(\x1b[0mWrite tests\x1b[36m)\x1b[0m\n  ⎿ Running…\n";
      const subs = parseSubagents(out);
      expect(subs).toHaveLength(1);
      expect(subs[0].label).toBe("Write tests");
    });

    it("falls back to 'subagent' when the header exposes no label", () => {
      const subs = parseSubagents("● Task()\n  ⎿ Running…\n");
      expect(subs).toHaveLength(1);
      expect(subs[0].label).toBe("subagent");
    });
  });

  describe("status classification", () => {
    it("classifies a Done status line as done", () => {
      const subs = parseSubagents("● Task(Find bug)\n  ⎿ Done (3 tool uses)\n");
      expect(subs[0].state).toBe("done");
    });

    it("classifies an error/failed status line as failed", () => {
      const subs = parseSubagents("● Task(Risky thing)\n  ⎿ Error: subagent failed\n");
      expect(subs[0].state).toBe("failed");
    });

    it("defaults an announced-but-unresolved Task to running", () => {
      const subs = parseSubagents("● Task(Just started)\n");
      expect(subs[0].state).toBe("running");
    });
  });

  describe("multiple subagents", () => {
    it("detects several Tasks in render order with per-block status", () => {
      const out =
        "● Task(First)\n  ⎿ Done (1 tool use)\n" +
        "● Task(Second)\n  ⎿ Running…\n" +
        "● Task(Third)\n  ⎿ Error: boom\n";
      const subs = parseSubagents(out);
      expect(subs.map((s) => s.label)).toEqual(["First", "Second", "Third"]);
      expect(subs.map((s) => s.state)).toEqual(["done", "running", "failed"]);
    });

    it("does not leak one Task's status onto the next", () => {
      // The 'Done' belongs to First; Second has no status line of its own.
      const out = "● Task(First)\n  ⎿ Done\n● Task(Second)\n";
      const subs = parseSubagents(out);
      expect(subs[0].state).toBe("done");
      expect(subs[1].state).toBe("running");
    });
  });
});
