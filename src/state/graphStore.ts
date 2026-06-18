/**
 * Sessions-graph data model + store.
 *
 * Assembles the unified mission-control tree the graph view renders by composing
 * five inputs into a `repo → worktree → terminal → subagent` forest:
 *
 *   - managed directories  (directoriesStore)   → repo roots
 *   - per-directory sessions (sessionsStore)     → terminals
 *   - per-session status    (statusStore)        → leaf status
 *   - git worktrees         (listWorktrees, wi-01) → worktree children of a repo
 *   - per-session subagents (subagentStore, wi-02) → terminal children
 *
 * Every non-leaf node's status is the worst-wins {@link rollupStatus} of its
 * descendants' statuses (wi-03). Each session nests under the worktree whose
 * path exactly equals its `dirPath`, falling back to the repo root when no
 * worktree matches.
 *
 * The split mirrors `statusStore`/`statusEngine`: {@link assembleGraph} is a
 * pure function over plain inputs (testable without any live store), the zustand
 * store stays passive (state + a single `setRoots`), and ALL subscription and
 * liveness lifecycle lives in {@link startGraphEngine} — which also starts wi-02's
 * subagent engine so subagents are derived only while the graph is live.
 */
import { create } from "zustand";

import { listWorktrees } from "../ipc/commands";
import { rollupStatus } from "../lib/nodeStatus";
import type {
  DirectoryInfo,
  SessionInfo,
  SessionStatus,
  SessionStatusState,
  SubagentNode,
  WorktreeInfo,
} from "../types";
import { useDirectoriesStore } from "./directoriesStore";
import { useSessionsStore } from "./sessionsStore";
import { useStatusStore } from "./statusStore";
import { startSubagentEngine } from "./subagentEngine";
import { useSubagentStore } from "./subagentStore";

/** Discriminator for a node's place in the `repo → worktree → terminal → subagent` tree. */
export type NodeKind = "repo" | "worktree" | "terminal" | "subagent";

/**
 * A single node in the assembled sessions graph. Leaf nodes (terminals,
 * subagents) carry their own `SessionStatus`; parent nodes (repos, worktrees,
 * terminals-with-subagents) carry the worst-wins {@link rollupStatus} of their
 * descendants. The default status for a non-leaf with no descendants is `ready`
 * (see {@link rollupStatus}).
 */
export interface GraphNode {
  /** Stable id within the forest (path for repo/worktree, sessionId for terminal, subagent id). */
  id: string;
  /** Where this node sits in the tree. */
  kind: NodeKind;
  /** Human-readable label for the view. */
  label: string;
  /** Own status (leaf) or rolled-up status of descendants (parent). */
  status: SessionStatus;
  /** Child nodes, in stable assembly order. */
  children: GraphNode[];
}

/** Plain, store-free inputs to {@link assembleGraph} (everything is mockable). */
export interface GraphInputs {
  /** Managed directories — the repo roots. */
  directories: DirectoryInfo[];
  /** Sessions keyed by their owning directory path. */
  sessionsByDirectory: Record<string, SessionInfo[]>;
  /** Per-session derived status, keyed by sessionId. */
  statusBySession: Record<string, SessionStatusState>;
  /** Worktrees keyed by repo path (the directory passed to `listWorktrees`). */
  worktreesByRepo: Record<string, WorktreeInfo[]>;
  /** Per-session subagents, keyed by sessionId. */
  subagentsBySession: Record<string, SubagentNode[]>;
}

/** Status used for a session that has no entry in `statusBySession` yet. */
const DEFAULT_SESSION_STATUS: SessionStatus = "ready";

/** Last path segment of an absolute path (a friendly worktree/repo label). */
function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const segments = trimmed.split(/[/\\]/);
  return segments[segments.length - 1] || path;
}

/** Build the subagent children of a terminal session. */
function subagentNodes(subagents: SubagentNode[]): GraphNode[] {
  return subagents.map((sub) => ({
    id: sub.id,
    kind: "subagent" as const,
    label: sub.label,
    status: sub.status,
    children: [],
  }));
}

/** Build a terminal node (with its subagent children) for one session. */
function terminalNode(session: SessionInfo, inputs: GraphInputs): GraphNode {
  const children = subagentNodes(inputs.subagentsBySession[session.id] ?? []);
  const ownStatus =
    inputs.statusBySession[session.id]?.status ?? DEFAULT_SESSION_STATUS;
  // A terminal's status rolls up its own status together with its subagents,
  // so a working subagent surfaces even when the parent reads ready.
  const status = rollupStatus([ownStatus, ...children.map((c) => c.status)]);
  return {
    id: session.id,
    kind: "terminal",
    label: session.id,
    status,
    children,
  };
}

/**
 * Assemble the full graph forest from plain inputs. Pure: no stores, no IPC, no
 * side effects — given identical inputs it returns an identical tree.
 *
 * For each managed directory (a repo root) it builds worktree children from
 * `worktreesByRepo`, then places every one of that directory's sessions under
 * the worktree whose `path` equals the session's `dirPath`, falling back to the
 * repo root node itself when no worktree matches. Non-leaf statuses are the
 * worst-wins roll-up of their descendants.
 */
export function assembleGraph(inputs: GraphInputs): GraphNode[] {
  return inputs.directories.map((dir) => {
    const sessions = inputs.sessionsByDirectory[dir.path] ?? [];
    const worktrees = inputs.worktreesByRepo[dir.path] ?? [];

    // Terminals whose dirPath does not match any worktree attach to the repo
    // root; the rest are grouped by their matching worktree path.
    const worktreePaths = new Set(worktrees.map((w) => w.path));
    const terminalsByWorktree = new Map<string, GraphNode[]>();
    const rootTerminals: GraphNode[] = [];
    for (const session of sessions) {
      const node = terminalNode(session, inputs);
      if (worktreePaths.has(session.dirPath)) {
        const list = terminalsByWorktree.get(session.dirPath) ?? [];
        list.push(node);
        terminalsByWorktree.set(session.dirPath, list);
      } else {
        rootTerminals.push(node);
      }
    }

    const worktreeNodes: GraphNode[] = worktrees.map((wt) => {
      const children = terminalsByWorktree.get(wt.path) ?? [];
      return {
        id: wt.path,
        kind: "worktree" as const,
        label: wt.branch ?? baseName(wt.path),
        status: rollupStatus(children.map((c) => c.status)),
        children,
      };
    });

    const children = [...worktreeNodes, ...rootTerminals];
    return {
      id: dir.path,
      kind: "repo" as const,
      label: dir.name,
      status: rollupStatus(children.map((c) => c.status)),
      children,
    };
  });
}

export interface GraphState {
  /** The assembled repo-rooted forest the view renders. */
  roots: GraphNode[];
  /** Worktrees cached per repo path; refreshed by the engine's `refreshWorktrees`. */
  worktreesByRepo: Record<string, WorktreeInfo[]>;
  /** Replace the assembled forest (passive setter; the engine drives this). */
  setRoots: (roots: GraphNode[]) => void;
  /** Replace the cached worktrees for a repo (passive setter; the engine drives this). */
  setWorktrees: (repoPath: string, worktrees: WorktreeInfo[]) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  roots: [],
  worktreesByRepo: {},

  setRoots: (roots) => set({ roots }),

  setWorktrees: (repoPath, worktrees) =>
    set((state) => ({
      worktreesByRepo: { ...state.worktreesByRepo, [repoPath]: worktrees },
    })),
}));

/** Selector hook for the view: the assembled graph forest. */
export function useGraph(): GraphNode[] {
  return useGraphStore((state) => state.roots);
}

/**
 * Start the graph liveness layer. This is the graph's analogue of
 * `statusEngine`: it owns ALL subscriptions and the subagent engine's lifetime.
 *
 * On start it:
 *  - starts wi-02's subagent engine so subagents are derived from the PTY stream
 *    only while the graph is live (held disposer tears it down on stop);
 *  - refreshes every managed repo's worktrees once;
 *  - subscribes to the directories, sessions, status and subagent stores and
 *    reassembles the forest from the latest snapshot of all five inputs whenever
 *    any of them changes.
 *
 * Returns a disposer that stops the subagent engine and unsubscribes everything.
 * `refreshWorktrees` may be called again on demand to re-enumerate worktrees.
 */
export function startGraphEngine(): { dispose: () => void; refreshWorktrees: () => Promise<void> } {
  let disposed = false;
  const stopSubagentEngine = startSubagentEngine();

  const reassemble = () => {
    const roots = assembleGraph({
      directories: useDirectoriesStore.getState().directories,
      sessionsByDirectory: useSessionsStore.getState().sessionsByDirectory,
      statusBySession: useStatusStore.getState().statusBySession,
      worktreesByRepo: useGraphStore.getState().worktreesByRepo,
      subagentsBySession: useSubagentStore.getState().subagentsBySession,
    });
    useGraphStore.getState().setRoots(roots);
  };

  // Enumerate worktrees for every managed repo. A non-git dir / git failure
  // resolves to an empty array (listWorktrees never rejects), so the repo simply
  // shows no worktree children. Reassembles once after all repos resolve.
  const refreshWorktrees = async () => {
    const directories = useDirectoriesStore.getState().directories;
    await Promise.all(
      directories.map(async (dir) => {
        const worktrees = await listWorktrees(dir.path);
        if (disposed) return;
        useGraphStore.getState().setWorktrees(dir.path, worktrees);
      }),
    );
    if (disposed) return;
    reassemble();
  };

  // React to any source store changing. Each store is passive, so subscribing
  // here keeps the engine the single owner of liveness (mirrors statusEngine).
  const unsubscribers = [
    useDirectoriesStore.subscribe(reassemble),
    useSessionsStore.subscribe(reassemble),
    useStatusStore.subscribe(reassemble),
    useSubagentStore.subscribe(reassemble),
  ];

  // Initial assembly from current state, then enumerate worktrees.
  reassemble();
  void refreshWorktrees();

  return {
    dispose: () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      stopSubagentEngine();
    },
    refreshWorktrees,
  };
}
