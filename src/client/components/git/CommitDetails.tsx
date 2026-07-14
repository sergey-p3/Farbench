import type { GitCommit } from "../../../shared/types.js";

export function CommitDetails({ commit, onClose }: { commit: GitCommit; onClose: () => void }) {
  return (
    <div className="git-dialog-backdrop" onClick={onClose}>
      <section
        aria-label="Commit information"
        aria-modal="true"
        className="git-commit-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="git-dialog-header">
          <strong>Commit information</strong>
          <button aria-label="Close commit information" onClick={onClose} type="button">×</button>
        </div>
        <dl>
          <div><dt>Commit</dt><dd className="git-commit-hash">{commit.id}</dd></div>
          <div><dt>Author</dt><dd>{commit.authorName} &lt;{commit.authorEmail}&gt;</dd></div>
          <div><dt>Authored</dt><dd>{formatDateTime(commit.authoredAt)}</dd></div>
          <div><dt>Committed</dt><dd>{formatDateTime(commit.committedAt)}</dd></div>
          <div><dt>Lines changed</dt><dd><span className="git-additions">+{commit.additions}</span> <span className="git-deletions">-{commit.deletions}</span></dd></div>
          <div><dt>Message</dt><dd className="git-full-message">{commit.message || commit.title}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function formatDateTime(value: string): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(date);
}
