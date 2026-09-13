import type { App, TFile } from "obsidian";
import type { ManifestField } from "../types";
import { resolveSourceWithStatus, type SourceResolutionResult } from "./source-resolver";

export async function loadFieldOptions(
  field: ManifestField,
  app: App,
  file: TFile,
  enableJs: boolean
): Promise<SourceResolutionResult> {
  if (Array.isArray(field.options)) return { options: field.options, status: "resolved" };
  const source = field.source ?? field.options?.source;
  return source
    ? resolveSourceWithStatus(source, app, file, enableJs)
    : { options: [], status: "resolved" };
}
