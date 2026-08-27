/**
 * FASE 1: Supervisor Token Detection (case-insensitive explicit activation)
 */

/**
 * Detects @super token and extracts objective.
 * - Case-insensitive: @super, @Super, @SUPER
 * - Only at the START of trimmed text (after leading spaces)
 * - @superman, mid-text @super, text @super do NOT activate
 * - Returns { detected: boolean, objective: string, cleaned_text: string }
 */
export function detectSupervisorToken(text: string): {
  detected: boolean;
  objective: string;
  cleaned_text: string;
} {
  const trimmed = text.trim();

  // Match @super ONLY at the very start, followed by space or EOF
  const match = trimmed.match(/^@super\s+(.*)$/i) || trimmed.match(/^@super$/i);

  if (!match) {
    return { detected: false, objective: "", cleaned_text: text };
  }

  const objective = match[1]?.trim() || "";
  // Remove @super from original text for downstream processing
  const cleaned = text.replace(/^\s*@super\s*/i, "").trim();

  return {
    detected: true,
    objective,
    cleaned_text: cleaned,
  };
}
