import type { ManifestRule } from "../types";
import { isWikiLink, linkName } from "./link-text";
import { isSelection } from "./selection";

const FOLLOW = /\{\{\s*([^{}|>]+?)\s*>/g;

/**
 * Properties through which rules look into linked notes: `{ project: { when } }`
 * selections and `{{project>...}}` templates. When a note changes, only the
 * notes linking to it through one of these properties need to run their rules
 * again. JavaScript rules are opaque and contribute nothing.
 */
export function collectLinkDependencies(rules: ManifestRule[]): string[] {
  const found = new Set<string>();

  const scanText = (text: string) => {
    FOLLOW.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FOLLOW.exec(text)) !== null) {
      if (match[1]) found.add(match[1].trim());
    }
  };

  /** `ownProperty` is set when `node` is a bare `{ when }` filter under a verb property. */
  const visit = (node: unknown, ownProperty?: string): void => {
    if (typeof node === "string") {
      scanText(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item));
      return;
    }
    if (node === null || typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    if (typeof record["js"] === "string") return;

    if (ownProperty !== undefined && Object.keys(record).every((k) => k === "when")) {
      if (record["when"] !== undefined) {
        found.add(ownProperty);
        visit(record["when"]);
      }
      return;
    }

    if (isSelection(node)) {
      for (const [property, spec] of Object.entries(node)) {
        if (spec.when === undefined) continue;
        found.add(property);
        // Terms inside refer to the linked note; only templates point back at this one
        visit(spec.when);
      }
      return;
    }

    for (const value of Object.values(record)) visit(value);
  };

  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    visit(rule.when);
    const then = rule.then as Record<string, unknown> | undefined;
    if (!then || typeof then !== "object") continue;
    for (const verb of ["set", "add", "remove"]) {
      const spec = then[verb];
      if (!spec || typeof spec !== "object" || Array.isArray(spec)) continue;
      for (const [property, value] of Object.entries(spec)) visit(value, property);
    }
  }

  return Array.from(found);
}

/** True when one of `properties` in `frontmatter` holds a link to the note called `basename`. */
export function linksThrough(
  frontmatter: Record<string, unknown>,
  properties: string[],
  basename: string
): boolean {
  return properties.some((property) => {
    const raw = frontmatter[property];
    return (Array.isArray(raw) ? raw : [raw]).some(
      (value) => isWikiLink(value) && linkName(value) === basename
    );
  });
}
