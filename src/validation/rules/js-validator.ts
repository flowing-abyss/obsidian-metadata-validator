import type { App, TFile } from "obsidian";
import type { ValidationResult } from "../../types";
import { dataviewContext, executeJsValidator, JsDisabledError } from "../../utils/js-exec";

export async function runJsValidator(
  field: string,
  value: unknown,
  jsCode: string,
  app: App,
  currentFile: TFile,
  manifestPath: string,
  enableJs = false
): Promise<ValidationResult | null> {
  const { dv, currentPage } = dataviewContext(app, currentFile);

  try {
    const result: unknown = await executeJsValidator(
      jsCode,
      app,
      dv,
      currentFile,
      currentPage,
      value,
      enableJs
    );
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
    if (e instanceof JsDisabledError) {
      return {
        field,
        severity: "warning",
        message: `JS validation disabled. Enable "Allow JavaScript execution" in settings to run "${field}" validator.`,
        rule: "js-validator",
        manifestPath,
        autoFixed: false,
      };
    }
    if (e instanceof Error && e.message === "JS validator timed out") {
      return {
        field,
        severity: "error",
        message: `"${field}" JS validator timed out after 2000ms.`,
        rule: "js-validator",
        manifestPath,
        autoFixed: false,
      };
    }
    return {
      field,
      severity: "error",
      message: `"${field}" JS validator threw: ${String(e)}`,
      rule: "js-validator",
      manifestPath,
      autoFixed: false,
    };
  }
}
