/**
 * Typed terminal classification when a combo skips every member.
 *
 * Pre-dispatch skips already carry a reason (decision-trace allowlist, persisted
 * connection status, quota cutoff, availability/credential gate). The all-skipped
 * 503 used to drop that into errorClass=null and remap the body to a generic
 * "pre-dispatch filters" sentence. This helper maps those existing reasons onto
 * a closed errorClass set so clients (e.g. Codex) can print the real skip cause.
 *
 * 3.8.50-compatible: no new combo APIs — string in, string/list out.
 */

export const COMBO_SKIP_ERROR_CLASSES = ["quota_exhausted", "expired", "no_credentials"] as const;

export type ComboSkipErrorClass = (typeof COMBO_SKIP_ERROR_CLASSES)[number];

const QUOTA_TOKENS = new Set(["quota_exhausted", "quota_cutoff", "credits_exhausted"]);
const EXPIRED_TOKENS = new Set(["expired"]);
const NO_CREDENTIALS_TOKENS = new Set(["no_credentials", "availability", "credential_gate"]);

const CLASS_PRIORITY: readonly ComboSkipErrorClass[] = [
  "quota_exhausted",
  "expired",
  "no_credentials",
];

export interface AllSkippedTerminal {
  /** Never null: a typed class, a comma-joined list, or all_targets_skipped. */
  errorClass: string;
  errorClasses: ComboSkipErrorClass[];
  message: string;
}

export function classifyComboSkipErrorClass(
  input:
    | string
    | null
    | undefined
    | {
        skipReason?: string | null;
        skipMessage?: string | null;
        quotaReason?: string | null;
      }
): ComboSkipErrorClass | null {
  if (input == null) return null;
  if (typeof input === "string") {
    return classifyToken(input) ?? classifyMessage(input);
  }
  return (
    classifyToken(input.quotaReason) ??
    classifyToken(input.skipReason) ??
    classifyMessage(input.skipMessage)
  );
}

export function resolveAllSkippedTerminal(
  classes: ReadonlyArray<string | ComboSkipErrorClass | null | undefined>
): AllSkippedTerminal {
  const seen = new Set<ComboSkipErrorClass>();
  for (const value of classes) {
    const typed = classifyComboSkipErrorClass(value);
    if (typed) seen.add(typed);
  }
  const errorClasses = CLASS_PRIORITY.filter((c) => seen.has(c));
  const errorClass =
    errorClasses.length === 0
      ? "all_targets_skipped"
      : errorClasses.length === 1
        ? errorClasses[0]
        : errorClasses.join(",");
  const message =
    errorClasses.length > 0
      ? `Service temporarily unavailable: all combo targets skipped (${errorClasses.join(", ")})`
      : "Service temporarily unavailable: all combo targets skipped";
  return { errorClass, errorClasses, message };
}

export function resolveAllSkippedTerminalFromTrace(
  trace: { decisions?: Array<{ decision?: string; reason?: string }> } | null | undefined,
  extra: ReadonlyArray<string | null | undefined> = []
): AllSkippedTerminal {
  const fromTrace = (trace?.decisions ?? [])
    .filter((d) => d.decision === "skipped_before_dispatch")
    .map((d) => d.reason);
  return resolveAllSkippedTerminal([...fromTrace, ...extra]);
}

function classifyToken(raw?: string | null): ComboSkipErrorClass | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim().toLowerCase();
  if (!token) return null;
  if (QUOTA_TOKENS.has(token)) return "quota_exhausted";
  if (EXPIRED_TOKENS.has(token)) return "expired";
  if (NO_CREDENTIALS_TOKENS.has(token)) return "no_credentials";
  return null;
}

function classifyMessage(msg?: string | null): ComboSkipErrorClass | null {
  if (typeof msg !== "string" || !msg) return null;
  const text = msg.toLowerCase();
  if (/\bstatus=expired\b/.test(text)) return "expired";
  if (/\bstatus=credits_exhausted\b/.test(text) || /\bquota_exhausted\b/.test(text)) {
    return "quota_exhausted";
  }
  if (/\bno credentials\b/.test(text)) return "no_credentials";
  return null;
}
