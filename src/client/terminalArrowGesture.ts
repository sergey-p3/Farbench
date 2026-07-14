export type TerminalArrowDirection = "left" | "up" | "down" | "right";

export interface TerminalArrowVector {
  direction: TerminalArrowDirection | null;
  distance: number;
}

export const TERMINAL_ARROW_DEAD_ZONE_PX = 22;
export const TERMINAL_ARROW_ACCELERATION_RESET_PX = 34;

const TERMINAL_ARROW_FULL_SPEED_DISTANCE_PX = 150;
const TERMINAL_ARROW_SLOWEST_DELAY_MS = 440;
const TERMINAL_ARROW_FASTEST_DISTANCE_DELAY_MS = 90;
const TERMINAL_ARROW_MAX_ACCELERATION_MS = 8_000;
const TERMINAL_ARROW_MAX_ACCELERATION_FACTOR = 0.48;
const TERMINAL_ARROW_MIN_DELAY_MS = 48;
const TERMINAL_ARROW_VERTICAL_DELAY_FACTOR = 2.5;

export function terminalArrowVector(
  originX: number,
  originY: number,
  pointerX: number,
  pointerY: number,
): TerminalArrowVector {
  const deltaX = pointerX - originX;
  const deltaY = pointerY - originY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < TERMINAL_ARROW_DEAD_ZONE_PX) return { direction: null, distance };

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return { direction: deltaX < 0 ? "left" : "right", distance };
  }
  return { direction: deltaY < 0 ? "up" : "down", distance };
}

export function terminalArrowRepeatDelay(
  distance: number,
  acceleratedForMs: number,
  direction?: TerminalArrowDirection | null,
): number {
  const distanceProgress = clamp(
    (distance - TERMINAL_ARROW_DEAD_ZONE_PX)
      / (TERMINAL_ARROW_FULL_SPEED_DISTANCE_PX - TERMINAL_ARROW_DEAD_ZONE_PX),
    0,
    1,
  );
  const distanceDelay = TERMINAL_ARROW_SLOWEST_DELAY_MS
    - distanceProgress * (TERMINAL_ARROW_SLOWEST_DELAY_MS - TERMINAL_ARROW_FASTEST_DISTANCE_DELAY_MS);
  const accelerationProgress = clamp(acceleratedForMs / TERMINAL_ARROW_MAX_ACCELERATION_MS, 0, 1);
  const accelerationFactor = 1
    - accelerationProgress * (1 - TERMINAL_ARROW_MAX_ACCELERATION_FACTOR);
  const directionFactor = direction === "up" || direction === "down"
    ? TERMINAL_ARROW_VERTICAL_DELAY_FACTOR
    : 1;

  return Math.max(
    TERMINAL_ARROW_MIN_DELAY_MS,
    Math.round(distanceDelay * accelerationFactor * directionFactor),
  );
}

export function shouldResetTerminalArrowAcceleration(peakDistance: number, nextDistance: number): boolean {
  return peakDistance - nextDistance >= TERMINAL_ARROW_ACCELERATION_RESET_PX;
}

export function shouldActivateTerminalSelectionAfterArrowGesture(peakDistance: number): boolean {
  return peakDistance < TERMINAL_ARROW_DEAD_ZONE_PX;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
