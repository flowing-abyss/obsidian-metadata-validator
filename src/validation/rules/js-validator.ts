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
  const plugins = appRecord["plugins"] as Record<string, unknown> | undefined;
  const dataview = plugins?.["dataview"] as Record<string, unknown> | undefined;
  const dv = dataview?.["api"];

  const timeoutPromise = new Promise<ValidationResult>((resolve) =>
    setTimeout(
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
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function("app", "dv", "current", "value", jsCode) as (
        app: App,
        dv: unknown,
        current: TFile,
        value: unknown
      ) => unknown;
      const result: unknown = await fn(app, dv, currentFile, value);
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
