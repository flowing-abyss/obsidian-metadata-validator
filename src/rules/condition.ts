import type { RuleCondition } from "../types";
import { evaluateQuery } from "../schema/query";
import { dataviewContext, executeJs } from "../utils/js-exec";
import type { NoteContext, RuleEnv } from "./context";
import { templateContextOf } from "./context";
import { isSelection, resolveSelection } from "./selection";
import { expandTemplatesInQuery } from "./template";

/** A rule is written wrongly (not a runtime failure). Reported once as a rule-config warning. */
export class RuleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleConfigError";
  }
}

/**
 * Evaluate a rule condition against `target`: the rule's own note, or the note
 * behind a link when called from a selection. Templates always render from the
 * rule's own note (`env.self`).
 */
export async function evaluateCondition(
  cond: RuleCondition,
  target: NoteContext,
  env: RuleEnv
): Promise<boolean> {
  if (typeof cond === "string") {
    const expanded = expandTemplatesInQuery(cond, templateContextOf(env));
    return evaluateQuery(expanded, target.path, target.tags, target.frontmatter);
  }
  if (cond === null || typeof cond !== "object" || Array.isArray(cond)) {
    throw new RuleConfigError("a condition must be a string or an object.");
  }
  if ("js" in cond && typeof cond.js === "string") {
    const { dv, currentPage } = dataviewContext(env.app, env.file);
    const result = await executeJs(
      cond.js,
      { fm: target.frontmatter, file: env.file, app: env.app, dv, currentPage },
      env.enableJs
    );
    return Boolean(result);
  }
  if ("and" in cond && Array.isArray(cond.and)) {
    for (const c of cond.and) if (!(await evaluateCondition(c, target, env))) return false;
    return true;
  }
  if ("or" in cond && Array.isArray(cond.or)) {
    for (const c of cond.or) if (await evaluateCondition(c, target, env)) return true;
    return false;
  }
  if ("not" in cond && Array.isArray(cond.not)) {
    for (const c of cond.not) if (await evaluateCondition(c, target, env)) return false;
    return true;
  }
  if (isSelection(cond)) {
    return (await resolveSelection(cond, target, env)).length > 0;
  }
  throw new RuleConfigError(`unrecognised condition ${JSON.stringify(cond)}.`);
}
