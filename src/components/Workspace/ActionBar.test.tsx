/**
 * ActionBar tests (RTL + Vitest).
 *
 * The bar pairs a single "add terminal" button with quick-spawn options that
 * fill the workspace to a fixed terminal count. Tests pin the spec-named
 * semantics: which option buttons appear for a given session count, how many
 * terminals each click requests, and that options vanish once their count is
 * reached. Icon shape / alignment is presentation and is not asserted.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionBar } from "./ActionBar";

describe("ActionBar", () => {
  it("requests a single terminal from the add button", () => {
    const onSpawnTerminals = vi.fn();
    render(
      <ActionBar
        hasDirectory
        sessionCount={1}
        onSpawnTerminals={onSpawnTerminals}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add terminal" }));
    expect(onSpawnTerminals).toHaveBeenCalledWith(1);
  });

  it("offers every quick-spawn option above the current count", () => {
    render(
      <ActionBar hasDirectory sessionCount={1} onSpawnTerminals={vi.fn()} />,
    );

    for (const n of [2, 4, 6, 8]) {
      expect(
        screen.getByRole("button", { name: `Open ${n} terminals` }),
      ).toBeInTheDocument();
    }
  });

  it("hides quick-spawn options whose count has already been reached", () => {
    render(
      <ActionBar hasDirectory sessionCount={4} onSpawnTerminals={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: "Open 2 terminals" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open 4 terminals" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open 6 terminals" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open 8 terminals" }),
    ).toBeInTheDocument();
  });

  it("requests exactly enough terminals to reach the chosen count", () => {
    const onSpawnTerminals = vi.fn();
    render(
      <ActionBar
        hasDirectory
        sessionCount={1}
        onSpawnTerminals={onSpawnTerminals}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open 4 terminals" }));
    expect(onSpawnTerminals).toHaveBeenCalledWith(3);
  });

  it("disables adding and offers no quick options without a directory", () => {
    render(
      <ActionBar
        hasDirectory={false}
        sessionCount={0}
        onSpawnTerminals={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add terminal" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Open 2 terminals" }),
    ).toBeNull();
  });
});
