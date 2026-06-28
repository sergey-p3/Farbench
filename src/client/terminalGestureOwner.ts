type GestureSource = "pointer" | "touch";

export function createTerminalGestureOwner() {
  let source: GestureSource | null = null;
  let pointerId: number | null = null;

  return {
    beginPointer(nextPointerId: number): boolean {
      if (source === "touch") return false;
      source = "pointer";
      pointerId = nextPointerId;
      return true;
    },

    canMovePointer(nextPointerId: number): boolean {
      return source === "pointer" && pointerId === nextPointerId;
    },

    endPointer(nextPointerId: number): boolean {
      if (!this.canMovePointer(nextPointerId)) return false;
      source = null;
      pointerId = null;
      return true;
    },

    beginTouch(): boolean {
      if (source === "pointer") return false;
      source = "touch";
      pointerId = null;
      return true;
    },

    canMoveTouch(): boolean {
      return source === "touch";
    },

    endTouch(): boolean {
      if (source !== "touch") return false;
      source = null;
      return true;
    },

    cancel(): void {
      source = null;
      pointerId = null;
    },
  };
}
