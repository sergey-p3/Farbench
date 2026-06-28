export const TOUCH_SCROLL_TAP_THRESHOLD_PX = 8;

interface MomentumScrollOptions {
  cancelAnimationFrame?: (handle: number) => void;
  friction?: number;
  maxVelocityPxPerMs?: number;
  minVelocityPxPerMs?: number;
  now?: () => number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  sampleWindowMs?: number;
  scrollBy: (deltaY: number) => void;
  thresholdPx?: number;
  velocityBoost?: number;
  viewportHeightPx?: () => number;
}

interface ScrollSample {
  time: number;
  y: number;
}

const DEFAULT_SAMPLE_WINDOW_MS = 120;
const DEFAULT_MIN_VELOCITY_PX_PER_MS = 0.45;
const DEFAULT_MAX_VELOCITY_VIEWPORTS_PER_MS = 0.008;
const DEFAULT_FRICTION = 0.92;
const DEFAULT_VELOCITY_BOOST = 1.25;
const FRAME_MS = 16.67;
const STOP_VELOCITY_VIEWPORTS_PER_MS = 0.00004;
const FALLBACK_VIEWPORT_HEIGHT_PX = 600;

export function createMomentumScrollGesture(options: MomentumScrollOptions) {
  const thresholdPx = options.thresholdPx ?? TOUCH_SCROLL_TAP_THRESHOLD_PX;
  const sampleWindowMs = options.sampleWindowMs ?? DEFAULT_SAMPLE_WINDOW_MS;
  const minVelocityPxPerMs = options.minVelocityPxPerMs ?? DEFAULT_MIN_VELOCITY_PX_PER_MS;
  const maxVelocityViewportsPerMs = (options.maxVelocityPxPerMs ?? DEFAULT_MAX_VELOCITY_VIEWPORTS_PER_MS * FALLBACK_VIEWPORT_HEIGHT_PX) / FALLBACK_VIEWPORT_HEIGHT_PX;
  const friction = options.friction ?? DEFAULT_FRICTION;
  const velocityBoost = options.velocityBoost ?? DEFAULT_VELOCITY_BOOST;
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestAnimationFrame ?? ((callback) => window.requestAnimationFrame(callback));
  const cancelFrame = options.cancelAnimationFrame ?? ((handle) => window.cancelAnimationFrame(handle));

  let startY = 0;
  let lastY: number | null = null;
  let didScroll = false;
  let samples: ScrollSample[] = [];
  let momentumFrame: number | null = null;
  let momentumVelocityViewports = 0;
  let lastMomentumAt = 0;

  function cancelMomentum() {
    if (momentumFrame !== null) {
      cancelFrame(momentumFrame);
      momentumFrame = null;
    }
    momentumVelocityViewports = 0;
  }

  function viewportHeight() {
    return Math.max(1, options.viewportHeightPx?.() ?? FALLBACK_VIEWPORT_HEIGHT_PX);
  }

  function addSample(y: number, time = now()) {
    samples.push({ time, y });
    const minTime = time - sampleWindowMs;
    while (samples.length > 1 && samples[0].time < minTime) {
      samples.shift();
    }
  }

  function resetGesture() {
    startY = 0;
    lastY = null;
    didScroll = false;
    samples = [];
  }

  function startMomentum(velocity: number) {
    const nextVelocity = (velocity / viewportHeight()) * velocityBoost;
    momentumVelocityViewports = Math.max(-maxVelocityViewportsPerMs, Math.min(maxVelocityViewportsPerMs, nextVelocity));
    lastMomentumAt = now();

    const tick = (timestamp: number) => {
      const elapsed = Math.max(1, timestamp - lastMomentumAt);
      lastMomentumAt = timestamp;
      const deltaY = momentumVelocityViewports * viewportHeight() * elapsed;
      options.scrollBy(deltaY);
      momentumVelocityViewports *= Math.pow(friction, elapsed / FRAME_MS);

      if (Math.abs(momentumVelocityViewports) < STOP_VELOCITY_VIEWPORTS_PER_MS) {
        momentumFrame = null;
        momentumVelocityViewports = 0;
        return;
      }
      momentumFrame = requestFrame(tick);
    };

    momentumFrame = requestFrame(tick);
  }

  function releaseVelocity(): number {
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = last.time - first.time;
    if (elapsed <= 0) return 0;
    return (first.y - last.y) / elapsed;
  }

  return {
    begin(y: number) {
      cancelMomentum();
      startY = y;
      lastY = y;
      didScroll = false;
      samples = [];
      addSample(y);
    },

    move(y: number): boolean {
      if (lastY === null) return false;
      if (!didScroll && Math.abs(y - startY) < thresholdPx) {
        return false;
      }
      didScroll = true;

      const deltaY = lastY - y;
      options.scrollBy(deltaY);
      lastY = y;
      addSample(y);
      return true;
    },

    end() {
      if (didScroll) {
        const velocity = releaseVelocity();
        if (Math.abs(velocity) >= minVelocityPxPerMs) {
          startMomentum(velocity);
        }
      }
      resetGesture();
    },

    cancel() {
      cancelMomentum();
      resetGesture();
    },
  };
}
