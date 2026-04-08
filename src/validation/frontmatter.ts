export function sanitizeFrontmatter(
  rawFrontmatter: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = { ...(rawFrontmatter ?? {}) };
  delete frontmatter["position"];
  return frontmatter;
}
