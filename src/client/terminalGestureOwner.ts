type GestureSource = "pointer" | "touch";

export function createTerminalGestureOwner() {
  let source: GestureSource | null = null;
  let pointerId: number | null = null;
  let pointerMoved = false;
  let touchPending = false;

  return {
    beginPointer(nextPointerId: number): boolean {
      if (source === "touch") return false;
      source = "pointer";
      pointerId = nextPointerId;
      pointerMoved = false;
      touchPending = false;
      return true;
    },

    canMovePointer(nextPointerId: number): boolean {
      return source === "pointer" && pointerId === nextPointerId;
    },

    notePointerMoved(nextPointerId: number): boolean {
      if (!this.canMovePointer(nextPointerId)) return false;
      pointerMoved = true;
      touchPending = false;
      return true;
    },

    endPointer(nextPointerId: number): boolean {
      if (!this.canMovePointer(nextPointerId)) return false;
      source = null;
      pointerId = null;
      pointerMoved = false;
      touchPending = false;
      return true;
    },

    beginTouch(): boolean {
      if (source === "pointer" && pointerMoved) return false;
      if (source === "pointer") {
        touchPending = true;
        return true;
      }
      source = "touch";
      pointerId = null;
      pointerMoved = false;
      touchPending = false;
      return true;
    },

    canMoveTouch(): boolean {
      return source === "touch";
    },

    claimTouchMove(): boolean {
      if (source === "touch") return true;
      if (source !== "pointer" || pointerMoved || !touchPending) return false;
      source = "touch";
      pointerId = null;
      pointerMoved = false;
      touchPending = false;
      return true;
    },

    endTouch(): boolean {
      if (source !== "touch") return false;
      source = null;
      touchPending = false;
      return true;
    },

    cancel(): void {
      source = null;
      pointerId = null;
      pointerMoved = false;
      touchPending = false;
    },
  };
}
