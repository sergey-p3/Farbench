import { useEffect, type RefObject } from "react";
import type { OnMount } from "@monaco-editor/react";
import { createMomentumScrollGesture } from "../../scrollMomentum.js";

type MonacoEditor = Parameters<OnMount>[0];

export function useEditorTouchScroll(
  editorHostRef: RefObject<HTMLDivElement | null>,
  editorRef: RefObject<MonacoEditor | null>,
  selectedPath: string | null,
): void {
  useEffect(() => {
    const editorHost = editorHostRef.current;
    if (!editorHost) return;

    const momentum = createMomentumScrollGesture({
      scrollBy: (deltaY) => {
        const editor = editorRef.current;
        if (editor) editor.setScrollTop(editor.getScrollTop() + deltaY);
      },
      viewportHeightPx: () => editorRef.current?.getLayoutInfo().height ?? editorHost.clientHeight,
    });
    const begin = (event: TouchEvent) => {
      const y = averageTouchY(event.touches);
      if (y === null) momentum.cancel();
      else momentum.begin(y);
    };
    const move = (event: TouchEvent) => {
      const y = averageTouchY(event.touches);
      if (y !== null && momentum.move(y) && event.cancelable) event.preventDefault();
    };
    const end = () => momentum.end();
    const cancel = () => momentum.cancel();

    editorHost.addEventListener("touchstart", begin, { capture: true, passive: true });
    editorHost.addEventListener("touchmove", move, { capture: true, passive: false });
    editorHost.addEventListener("touchend", end, true);
    editorHost.addEventListener("touchcancel", cancel, true);
    return () => {
      momentum.cancel();
      editorHost.removeEventListener("touchstart", begin, true);
      editorHost.removeEventListener("touchmove", move, true);
      editorHost.removeEventListener("touchend", end, true);
      editorHost.removeEventListener("touchcancel", cancel, true);
    };
  }, [editorHostRef, editorRef, selectedPath]);
}

function averageTouchY(touches: TouchList): number | null {
  if (touches.length !== 1 && touches.length !== 2) return null;
  let total = 0;
  for (let index = 0; index < touches.length; index += 1) {
    total += touches[index]?.clientY ?? 0;
  }
  return total / touches.length;
}
