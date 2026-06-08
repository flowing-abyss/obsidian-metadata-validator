import type { App, TFile } from "obsidian";
import type { ValidationResult } from "../../types";

const JS_TIMEOUT_MS = 2000;

export async function runJsValidator(
  field: string,
  value: unknown,
  jsCode: string,
  app: App,
  currentFile: TFile,
  manifestPath: string
): Promise<ValidationResult | null> {
  const appRecord = app as unknown as Record<string, unknown>;
  const pluginManager = appRecord["plugins"] as Record<string, unknown> | undefined;
  const pluginsMap = pluginManager?.["plugins"] as Record<string, unknown> | undefined;
  const dataview =
    (pluginsMap?.["dataview"] as Record<string, unknown> | undefined) ??
    (pluginManager?.["dataview"] as Record<string, unknown> | undefined);
  const dv = dataview?.["api"];
  let currentPage: unknown = null;
  if (
    dv &&
    typeof dv === "object" &&
    "page" in (dv as Record<string, unknown>) &&
    typeof (dv as { page?: unknown }).page === "function"
  ) {
    try {
      currentPage = (dv as { page: (path: string) => unknown }).page(currentFile.path);
    } catch {
      currentPage = null;
    }
  }

  const timeoutPromise = new Promise<ValidationResult>((resolve) =>
    activeWindow.setTimeout(
      () =>
        resolve({
          field,
          severity: "error",
          message: `"${field}" JS validator timed out after ${JS_TIMEOUT_MS}ms.`,
          rule: "js-validator",
          manifestPath,
          autoFixed: false,
        }),
      JS_TIMEOUT_MS
    )
  );

  const runPromise = (async (): Promise<ValidationResult | null> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Intentional: executes user-provided JS code for custom validation rules. Users opt-in by writing JS in their schema.
      const fn = new Function("app", "dv", "currentFile", "currentPage", "value", jsCode) as (
        app: App,
        dv: unknown,
        currentFile: TFile,
        currentPage: unknown,
        value: unknown
      ) => unknown;
      const result: unknown = await fn(app, dv, currentFile, currentPage, value);
      if (result === true) return null;
      return {
        field,
        severity: "error",
        message: typeof result === "string" ? result : `"${field}" failed custom JS validation.`,
        rule: "js-validator",
        manifestPath,
        autoFixed: false,
      };
    } catch (e) {
      return {
        field,
        severity: "error",
        message: `"${field}" JS validator threw: ${String(e)}`,
        rule: "js-validator",
        manifestPath,
        autoFixed: false,
      };
    }
  })();

  return Promise.race([runPromise, timeoutPromise]);
}
