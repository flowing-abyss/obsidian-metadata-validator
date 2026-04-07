import type { ValidationSeverity } from "../../types";

interface FolderLocationResult {
  field: "__location__";
  severity: ValidationSeverity;
  message: string;
  rule: "enforce_folder";
  manifestPath: string;
  autoFixed: false;
  /** Vault path where the file should be moved to */
  targetPath: string;
}

/**
 * Check whether a note lives in the expected target folder.
 * Returns a FolderLocationResult (not a standard ValidationResult) so the
 * caller (main.ts) can trigger an actual file move via vault API.
 */
export function checkFolderLocation(
  filePath: string,
  targetFolder: string,
  manifestPath: string
): FolderLocationResult | null {
  const folder = targetFolder.endsWith("/") ? targetFolder : targetFolder + "/";

  if (filePath.startsWith(folder)) return null;

  const filename = filePath.split("/").pop() ?? filePath;
  const targetPath = folder + filename;

  return {
    field: "__location__",
    severity: "warning",
    message: `This note should be in "${folder}" but is in "${filePath.split("/").slice(0, -1).join("/")}". It will be moved automatically.`,
    rule: "enforce_folder",
    manifestPath,
    autoFixed: false,
    targetPath,
  };
}
