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
  description?: string;
  /** Optional UI group label for dynamic picker rendering */
  group?: string;
  /** Optional per-group selection mode for dynamic picker rendering */
  type?: "select" | "multiselect";
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
  description?: string;
  required?: boolean;
  /** Hide this field from the Edit Properties modal */
  hidden?: boolean;
  default?: unknown;
  /** Always overwrite with this value (auto-fix) */
  fixed?: unknown;
  validate_exists?: boolean;
  sort?: "alphabetical" | "alphabetical-desc";
  min?: number;
  max?: number;
  format?: string;
  /** Static options list OR dynamic source */
  options?: FieldOption[] | { source: FieldSource };
  /**
   * When true (default): all list values must be from the options list.
   * When false: only values that are currently in the options list are managed;
   * extra values are left untouched (no validation error, not replaced on save).
   */
  strict?: boolean;
  /** For link/multilink: filter which notes are valid */
  source?: FieldSource;
  validate?: { js: string };
}

export interface ManifestTarget {
  property?: Record<string, string>;
  /**
   * Logical expression for matching notes.
   * Terms: "path/" for folders, #tag for tags, key=value for properties.
   */
  query?: string;
}

/** A condition in a rule: string query, selection, composition, or JS. */
export type RuleCondition =
  | string
  | { js: string }
  | { and: RuleCondition[] }
  | { or: RuleCondition[] }
  | { not: RuleCondition[] }
  | RuleSelection;

/** `{ property: { when?: RuleCondition } }` — values of a property, filtered by the note behind each link. */
export type RuleSelection = Record<string, { when?: RuleCondition }>;

/** Literal, template string, selection, `{ js }`, or an array of those. */
export type RuleValue = unknown;

export interface RuleThen {
  set?: Record<string, RuleValue>;
  add?: Record<string, RuleValue>;
  remove?: Record<string, RuleValue>;
  js?: string;
}

export interface ManifestRule {
  name?: string;
  /** Shown as help where the rule is listed (properties modal footer) */
  description?: string;
  when?: RuleCondition;
  then: RuleThen;
}

/** rules.md file: folder-scoped rules applying to every manifest in its folder and below */
export interface RulesFile {
  path: string;
  folderPath: string;
  name?: string;
  rules: ManifestRule[];
  parseError?: string;
}

/** Raw parsed content of a manifest.md frontmatter */
export interface ManifestData {
  name?: string;
  description?: string;
  priority?: number;
  extends?: string;
  target?: ManifestTarget;
  /**
   * If true, has no effect (legacy: formerly required target.folder).
   * If a string, notes matching this schema are auto-moved to that folder path.
   */
  enforce_folder?: boolean | string;
  fields?: Record<string, ManifestField>;
  /** Field keys inherited from a parent manifest to exclude in this manifest */
  exclude?: string[];
  /** State-based rules applied after field auto-fixes */
  rules?: ManifestRule[];
  /** Set when the YAML could not be parsed by Obsidian; rules are dropped in that case */
  parseError?: string;
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
  /** Describes this schema only, not an ancestor. */
  description?: string;
  /** Names and descriptions of each ancestor, in inheritance order. */
  manifestSummaries?: { path: string; name: string; description?: string }[];
  priority: number;
  enforce_folder?: boolean | string;
  target: ManifestTarget;
  fields: Record<string, ManifestField>;
  /** Rules from rules.md files and the manifest chain, in execution order */
  rules: ManifestRule[];
  /** YAML errors of any manifest.md or rules.md in this schema's chain, as "path: message" */
  parseErrors: string[];
  /** Properties through which this schema's rules read linked notes (selections, `{{a>b}}`) */
  linkDependencies: string[];
  formatting: { property_order?: string[] };
  /** vault paths from root ancestor to this manifest */
  inheritanceChain: string[];
}

export interface PropertySuggestion {
  key: string;
  field: ManifestField;
  label: string;
}

export type KeyboardPropertyItem = {
  label: string;
  description?: string;
  section?: string;
  pinned?: boolean;
} & (
  | { kind: "property"; property: PropertySuggestion }
  | { kind: "option"; option: FieldOption }
  | {
      kind: "action";
      action: "save" | "add" | "clear" | "message" | "date" | "calendar";
      value?: string;
    }
);

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
