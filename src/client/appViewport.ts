interface AppViewportTarget {
  style: {
    setProperty: (property: string, value: string) => void;
  };
}

interface AppViewportWindow {
  innerHeight: number;
  visualViewport?: {
    height: number;
    offsetTop: number;
    addEventListener: (type: "resize" | "scroll", listener: () => void) => void;
    removeEventListener: (type: "resize" | "scroll", listener: () => void) => void;
  } | null;
  addEventListener: (type: "resize", listener: () => void) => void;
  removeEventListener: (type: "resize", listener: () => void) => void;
}

export function installAppViewportHeightSync(windowLike: AppViewportWindow, target: AppViewportTarget): () => void {
  const sync = () => {
    const viewport = windowLike.visualViewport;
    const height = viewport?.height ?? windowLike.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    target.style.setProperty("--app-viewport-height", `${height}px`);
    target.style.setProperty("--app-viewport-offset-top", `${offsetTop}px`);
  };

  sync();
  windowLike.addEventListener("resize", sync);
  windowLike.visualViewport?.addEventListener("resize", sync);
  windowLike.visualViewport?.addEventListener("scroll", sync);

  return () => {
    windowLike.removeEventListener("resize", sync);
    windowLike.visualViewport?.removeEventListener("resize", sync);
    windowLike.visualViewport?.removeEventListener("scroll", sync);
  };
}
