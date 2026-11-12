/**
 * Allowlisted operational event shapes. Never pass request bodies, URLs,
 * headers, access tokens, OAuth codes, or raw provider error objects.
 */
export type SecurityEvent =
  | "http.health"
  | "http.route_not_found"
  | "http.method_denied"
  | "security.mcp_disabled";

export type EventOutcome = "allowed" | "denied";

export interface SafeEvent {
  event: SecurityEvent;
  outcome: EventOutcome;
  service: "meta-master-worker-mcp";
}

export function safeEvent(event: SecurityEvent, outcome: EventOutcome): SafeEvent {
  return { event, outcome, service: "meta-master-worker-mcp" };
}

/** Converts arbitrary internal failure values into a constant public error. */
export function publicFailure(_cause?: unknown): { error: "internal_error" } {
  return { error: "internal_error" };
}
