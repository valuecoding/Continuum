const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accept only canonical UUID session identifiers before they reach a query.
 * Returns null for absent or malformed values.
 */
export function normalizeSessionId(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : null;
}
