export interface TerminalWriteTarget {
  reset(): void;
  write(data: string, callback?: () => void): void;
}

export interface TerminalWriteQueue {
  dispose(): void;
  flush(): Promise<void>;
  replace(data: string): void;
  write(data: string): void;
}

export function terminalHistoryReplay(data: string, screenRows: number): string {
  if (!data) return "";
  const rows = Number.isFinite(screenRows) ? Math.max(0, Math.floor(screenRows)) : 0;
  // Leave a blank viewport for tmux's attached-client redraw so every captured
  // line remains above the live screen in xterm's scrollback buffer.
  return `${data}${"\r\n".repeat(rows)}`;
}

export function createTerminalWriteQueue(target: TerminalWriteTarget): TerminalWriteQueue {
  let disposed = false;
  let tail = Promise.resolve();

  const enqueue = (operation: () => Promise<void>): void => {
    tail = tail.then(async () => {
      if (disposed) return;
      await operation();
    }).catch(() => {
      // Terminal rendering is best-effort; keep the queue usable after a failed write.
    });
  };

  const write = (data: string): Promise<void> => {
    if (!data || disposed) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        target.write(data, done);
      } catch {
        done();
      }
    });
  };

  return {
    dispose() {
      disposed = true;
    },
    flush() {
      return tail;
    },
    replace(data: string) {
      enqueue(async () => {
        target.reset();
        await write(data);
      });
    },
    write(data: string) {
      enqueue(() => write(data));
    },
  };
}
