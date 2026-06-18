import { describe, expect, it } from "vitest";

import { directoryIdentity } from "./directoryIdentity";

describe("directoryIdentity", () => {
  it("uses the folder name as primary when there is no repo (non-git)", () => {
    expect(directoryIdentity({ name: "notes", repo: null })).toEqual({
      primary: "notes",
      folder: null,
    });
  });

  it("keeps the folder subtitle for a plain clone (repo equals the folder name)", () => {
    // A plain clone whose folder matches the remote still names its directory:
    // the folder is surfaced as the subtitle rather than collapsed away.
    expect(directoryIdentity({ name: "mechsuit", repo: "mechsuit" })).toEqual({
      primary: "mechsuit",
      folder: "mechsuit",
    });
  });

  it("leads with the repo and keeps the folder as a subtitle when they differ", () => {
    expect(
      directoryIdentity({ name: "itris-mechsuit", repo: "Mechsuit" }),
    ).toEqual({ primary: "Mechsuit", folder: "itris-mechsuit" });
  });

  it("treats a blank repo like none (no folder subtitle)", () => {
    expect(directoryIdentity({ name: "thing", repo: "   " })).toEqual({
      primary: "thing",
      folder: null,
    });
  });
});
