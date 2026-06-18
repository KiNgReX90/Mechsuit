/**
 * Shift+Arrow focus navigation across the session grid.
 *
 * Registers a single CAPTURE-phase `keydown` listener on `window` so it runs
 * before xterm's textarea handler — letting it suppress the key (preventDefault
 * + stopPropagation) so the arrow never reaches the running program. State is
 * read imperatively from the stores on each press, so the listener registers
 * once and always sees live values.
 *
 * It only acts when a terminal actually holds focus (the event originates inside
 * a `.terminal-pane`) and no overlay owns the screen — so Shift+Arrow text
 * selection in any real input passes straight through. In the grid it moves
 * spatially ({@link gridNeighbor}); while a pane is expanded it cycles the
 * expanded session ({@link linearNeighbor}).
 */
import { useEffect } from "react";

import { focusSession } from "../../lib/focusSession";
import {
  gridNeighbor,
  linearNeighbor,
  type NavDirection,
} from "../../lib/gridNavigation";
import { useSessionsStore } from "../../state/sessionsStore";
import { useUiStore } from "../../state/uiStore";

const KEY_TO_DIRECTION: Record<string, NavDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function useGridNavigation(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Shift only — leave Ctrl/Alt/Meta combos (and plain arrows) for the terminal.
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const direction = KEY_TO_DIRECTION[e.key];
      if (!direction) return;

      const ui = useUiStore.getState();
      // An overlay owns the screen — don't steal its keys.
      if (ui.commanderOpen || ui.settingsOpen || ui.graphOpen) return;
      // Only navigate while a terminal holds focus; otherwise (e.g. typing in a
      // real input) let Shift+Arrow do its normal thing.
      const target = e.target as Element | null;
      if (!target?.closest?.(".terminal-pane")) return;

      const dirPath = ui.selectedDirectoryPath;
      if (!dirPath) return;
      const sessions =
        useSessionsStore.getState().sessionsByDirectory[dirPath] ?? [];
      if (sessions.length === 0) return;

      // Expanded mode cycles the full-screen pane; the grid moves spatially.
      const expanded =
        ui.expandedSessionId &&
        sessions.some((s) => s.id === ui.expandedSessionId)
          ? ui.expandedSessionId
          : null;
      const nextId = expanded
        ? linearNeighbor(sessions, expanded, direction)
        : gridNeighbor(sessions, ui.focusedSessionId, direction);
      if (!nextId) return;

      // We own this key: keep it out of xterm and the browser's default.
      e.preventDefault();
      e.stopPropagation();

      focusSession(nextId, { expand: Boolean(expanded) });
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
