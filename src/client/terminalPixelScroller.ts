interface ScrollViewport {
  scrollTop: number;
}

export function scrollTerminalViewportByPixels(viewport: ScrollViewport, deltaY: number): void {
  viewport.scrollTop += deltaY;
}
