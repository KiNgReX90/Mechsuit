import type { DirectoryInfo } from "../types";

/**
 * The two names a workspace button renders: the bold primary identity and an
 * optional on-disk folder subtitle.
 */
export interface DirectoryIdentity {
  /** The bold primary label: the repository name when known, else the folder. */
  primary: string;
  /**
   * The on-disk folder name, shown as a secondary subtitle whenever this is a
   * repo — even when it equals the primary (repo) label — so every repo card
   * always names the directory it lives in. `null` only for a non-git
   * directory, whose single name already IS the folder.
   */
  folder: string | null;
}

/**
 * Decide how a directory's two names lead the workspace button.
 *
 * - No repo (non-git) or a blank repo → the folder name is the primary, with no
 *   subtitle (its single name already names the directory).
 * - Any repo → the repo name leads and the on-disk folder is ALWAYS shown as
 *   the subtitle, even when the two match (a plain clone), so the card always
 *   names the directory the repo lives in.
 */
export function directoryIdentity(
  dir: Pick<DirectoryInfo, "name" | "repo">,
): DirectoryIdentity {
  const repo = dir.repo?.trim();
  if (!repo) {
    return { primary: dir.name, folder: null };
  }
  return { primary: repo, folder: dir.name };
}
