/** Descriptions are plain text. Ignore malformed YAML values without coercion. */
export function descriptionText(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}
