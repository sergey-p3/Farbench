import type { GitChange, GitCommitFile } from "../../../shared/types.js";

export type GitView = "files" | "history" | "branches";
export type DisplayedChange = GitChange | GitCommitFile;

export interface ChangeGroup {
  label: string | null;
  changes: DisplayedChange[];
}
