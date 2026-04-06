// All shared interfaces for the plugin.
// Import from here everywhere — never define types inline in feature files.

export type FieldType =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "list"
  | "date"
  | "link"
  | "multilink"
  | "boolean"
  | "url";

export interface FieldOption {
  value: string;
  label?: string;
}

export interface FieldSource {
  folder?: string;
  tag?: string;
  /** key=value pairs, all must match (AND) */
  property?: Record<string, string>;
  /** Expression filter: "Folder/" AND/OR #tag (overrides folder/tag when set) */
  query?: string;
  js?: string;
}

export interface ManifestField {
  type: FieldType;
  label?: string;
  required?: boolean;
  /** Hide this field from the Edit Properties modal */
  hidden?: boolean;
  default?: unknown;
  /** Always overwrite with this value (auto-fix) */
  fixed?: unknown;
  validate_exists?: boolean;
  sort?: "alphabetical";
  min?: number;
  max?: number;
  format?: string;
  /** Static options list OR dynamic source */
  options?: FieldOption[] | { source: FieldSource };
  /** For link/multilink: filter which notes are valid */
  source?: FieldSource;
  validate?: { js: string };
}

export interface ManifestTarget {
  op?: "AND" | "OR";
  folder?: string;
  tag?: string;
  property?: Record<string, string>;
  /**
   * Logical expression: "Folder/" AND/OR #tag  (overrides folder/tag/op when set)
   * Terms: "path/" for folders, #tag for tags, key=value for properties
   */
  query?: string;
}

/** Raw parsed content of a manifest.md frontmatter */
export interface ManifestData {
  name?: string;
  description?: string;
  priority?: number;
  extends?: string;
  target?: ManifestTarget;
  /**
   * If true, notes matching this manifest MUST be located in `target.folder`.
   * If a matching note is found outside that folder, the plugin auto-moves it.
   * Requires `target.folder` to be set; ignored otherwise.
   *
   * If a string, it is used as the target folder path directly — useful for
   * tag-based or property-based schemas that have no `target.folder`.
   */
  enforce_folder?: boolean | string;
  fields?: Record<string, ManifestField>;
  formatting?: {
    property_order?: string[];
  };
  /**
   * Index signature: allows any additional custom fields in the manifest YAML
   * without breaking the parser. Unknown keys are silently ignored at runtime.
   */
  [key: string]: unknown;
}

/** manifest.md file with its vault path + parsed data */
export interface Manifest {
  path: string; // vault path to the manifest.md file, e.g. "schemas/book/manifest.md"
  folderPath: string; // e.g. "schemas/book"
  data: ManifestData;
}

/** Fully resolved schema after merging inheritance chain */
export interface ResolvedSchema {
  manifestPath: string;
  name: string;
  priority: number;
  enforce_folder?: boolean | string;
  target: ManifestTarget;
  fields: Record<string, ManifestField>;
  formatting: { property_order?: string[] };
  /** vault paths from root ancestor to this manifest */
  inheritanceChain: string[];
}

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationResult {
  field: string;
  severity: ValidationSeverity;
  message: string;
  /** rule name, e.g. "required", "options", "link-exists" */
  rule: string;
  manifestPath: string;
  autoFixed: boolean;
}
