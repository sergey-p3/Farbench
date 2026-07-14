import { isUnauthorized } from "../api.js";

export function apiErrorMessage(
  error: unknown,
  fallback: string,
  onUnauthorized?: () => void,
): string | null {
  if (isUnauthorized(error)) {
    onUnauthorized?.();
    return onUnauthorized ? null : "Session expired. Sign in again.";
  }
  return error instanceof Error ? error.message : fallback;
}
