import type { GitBranch, GitCommit } from "../../../shared/types.js";

export function GitHistoryView({
  commits,
  isLoading,
  onSelectCommit,
  onShowDetails,
}: {
  commits: GitCommit[];
  isLoading: boolean;
  onSelectCommit: (commit: GitCommit) => void;
  onShowDetails: (commit: GitCommit) => void;
}) {
  return (
    <section className="git-list-view" role="tabpanel" aria-label="Git history">
      {isLoading ? <p className="loading-state compact">Loading history...</p> : null}
      <div className="git-history-list">
        {commits.map((commit) => (
          <article className="git-history-row" key={commit.id}>
            <button className="git-history-main" onClick={() => onSelectCommit(commit)} type="button">
              <span className="git-commit-title">{commit.title || "Untitled commit"}</span>
              <span className="git-commit-meta">
                <span className="git-commit-id">{commit.shortId}</span>
                <span className="git-additions">+{commit.additions}</span>
                <span className="git-deletions">-{commit.deletions}</span>
              </span>
            </button>
            <button
              aria-label={`Information for ${commit.title || commit.shortId}`}
              className="git-info-button"
              onClick={() => onShowDetails(commit)}
              title="Commit information"
              type="button"
            >i</button>
          </article>
        ))}
      </div>
      {commits.length === 0 && !isLoading ? <p className="empty-state">No commits on this branch.</p> : null}
    </section>
  );
}

export function GitBranchesView({
  baseBranch,
  branches,
  isLoading,
  onSwitchBranch,
  switchingBranch,
}: {
  baseBranch: string;
  branches: GitBranch[];
  isLoading: boolean;
  onSwitchBranch: (branch: GitBranch) => void;
  switchingBranch: string | null;
}) {
  return (
    <section className="git-list-view" role="tabpanel" aria-label="Git branches">
      <div className="git-list-heading"><strong>Local branches</strong><span>Compared with {baseBranch || "main"}</span></div>
      {isLoading ? <p className="loading-state compact">Loading branches...</p> : null}
      <div className="git-branch-list">
        {branches.map((branch) => (
          <button
            aria-current={branch.current ? "true" : undefined}
            className={branch.current ? "git-branch-row current" : "git-branch-row"}
            disabled={branch.current || switchingBranch !== null}
            key={branch.name}
            onClick={() => onSwitchBranch(branch)}
            type="button"
          >
            <span className="git-branch-main">
              <span className="git-branch-name">{branch.name}</span>
              <small>Last commit {formatDate(branch.lastCommitAt)}</small>
            </span>
            <span className="git-branch-divergence">
              <span className="git-additions">{branch.ahead} ahead</span>
              <span className="git-deletions">{branch.behind} behind</span>
              <small>{branch.current ? "Current" : switchingBranch === branch.name ? "Switching…" : "Switch"}</small>
            </span>
          </button>
        ))}
      </div>
      {branches.length === 0 && !isLoading ? <p className="empty-state">No local branches.</p> : null}
    </section>
  );
}

function formatDate(value: string): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
