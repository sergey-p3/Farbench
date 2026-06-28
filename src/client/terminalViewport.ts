export interface TerminalViewportMetrics {
  innerHeight: number;
  maxTouchPoints: number;
  userAgent: string;
  visualViewportHeight: number;
  visualViewportOffsetTop: number;
}

const IPHONE_KEYBOARD_CHROME_INSET_PX = 64;
const KEYBOARD_VIEWPORT_REDUCTION_THRESHOLD_PX = 80;
const IOS_TERMINAL_FIT_DELAY_MS = 220;

export function terminalKeyboardChromeInset(metrics: TerminalViewportMetrics): number {
  if (!isIosTouchViewport(metrics.userAgent, metrics.maxTouchPoints)) return 0;

  const visualViewportBottom = metrics.visualViewportOffsetTop + metrics.visualViewportHeight;
  const viewportReduction = metrics.innerHeight - visualViewportBottom;
  return viewportReduction >= KEYBOARD_VIEWPORT_REDUCTION_THRESHOLD_PX ? IPHONE_KEYBOARD_CHROME_INSET_PX : 0;
}

export function terminalViewportFitDelayMs(input: {
  isTerminalInputFocused: boolean;
  metrics: TerminalViewportMetrics;
}): number {
  if (!input.isTerminalInputFocused) return 0;
  if (!isIosTouchViewport(input.metrics.userAgent, input.metrics.maxTouchPoints)) return 0;

  const visualViewportBottom = input.metrics.visualViewportOffsetTop + input.metrics.visualViewportHeight;
  const viewportReduction = input.metrics.innerHeight - visualViewportBottom;
  return viewportReduction >= KEYBOARD_VIEWPORT_REDUCTION_THRESHOLD_PX ? IOS_TERMINAL_FIT_DELAY_MS : 0;
}

function isIosTouchViewport(userAgent: string, maxTouchPoints: number): boolean {
  return /\b(iPad|iPhone|iPod)\b/.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1);
}
