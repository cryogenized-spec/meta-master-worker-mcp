/**
 * Conservative temporary handoff triggers. This list is NOT a definitive
 * legal classification. A later agent must use curated product policy
 * metadata plus actual Meta/WhatsApp terms; unknown categories default
 * to draft-only until approved. No outbound send code is in this module.
 */
const SENSITIVE_TOPICS: RegExp[] = [
  /\b(?:blank[\s-]?guns?|firearms?|pistols?|rifles?|shotguns?|ammunition|cartridges|weapon(?:s)?)\b/i,
  /\b(?:pcp\s+(?:rifle|gun)|co2\s+(?:pistol|gun)|blow\s+mini\s*9|bruni\s+mini\s+gap)\b/i,
  /\b(?:payday\s+loan|borrow\s+money|cash\s+advance|loan(?:s)?)\b/i,
];

const HUMAN_REQUESTS: RegExp[] = [
  /\b(?:human|real person|speak to (?:someone|a person)|call me|manager|complaint)\b/i,
];

export type ReviewReason =
  | "regulated_or_sensitive_topic"
  | "customer_requests_human"
  | "unsupported_content_requires_human";

export function reviewReason(
  type: "text" | "unsupported",
  text: string | null,
): ReviewReason | null {
  if (type !== "text" || text === null) return "unsupported_content_requires_human";
  if (SENSITIVE_TOPICS.some(pattern => pattern.test(text))) return "regulated_or_sensitive_topic";
  if (HUMAN_REQUESTS.some(pattern => pattern.test(text))) return "customer_requests_human";
  return null;
}
