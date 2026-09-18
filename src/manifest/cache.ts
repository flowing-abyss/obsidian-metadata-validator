import type { App, TFile } from "obsidian";
import { parseManifest } from "./parser";
import type { Manifest, RulesFile } from "../types";

export class ManifestCache {
  private manifests: Map<string, Manifest> = new Map();
  private rulesFiles: Map<string, RulesFile> = new Map();
  private readonly app: App;
  private readonly schemasRoot: string;

  constructor(app: App, schemasRoot: string) {
    this.app = app;
    this.schemasRoot = schemasRoot.replace(/\/+$/, "");
  }

  async load(): Promise<void> {
    this.manifests.clear();
    this.rulesFiles.clear();
    const files = this.app.vault.getMarkdownFiles();
    const schemaFiles = files.filter((f) => this.isManifestFile(f) || this.isRulesFile(f));

    await Promise.all(schemaFiles.map((file) => this.refresh(file)));
  }

  isManifestFile(file: TFile): boolean {
    return (
      file.path.startsWith(this.schemasRoot + "/") &&
      file.basename === "manifest" &&
      file.extension === "md"
    );
  }

  /** rules.md anywhere under the schemas folder: rules for every manifest in that folder and below */
  isRulesFile(file: TFile): boolean {
    return (
      file.path.startsWith(this.schemasRoot + "/") &&
      file.basename === "rules" &&
      file.extension === "md"
    );
  }

  getAll(): Manifest[] {
    return Array.from(this.manifests.values());
  }

  getByPath(manifestPath: string): Manifest | undefined {
    return this.manifests.get(manifestPath);
  }

  getByFolder(folderPath: string): Manifest | undefined {
    return this.manifests.get(folderPath + "/manifest.md");
  }

  getRulesFiles(): RulesFile[] {
    return Array.from(this.rulesFiles.values());
  }

  /** rules.md files applying to `folderPath`: its own folder and every ancestor, outermost first. */
  getRulesFilesForFolder(folderPath: string): RulesFile[] {
    return this.getRulesFiles()
      .filter((r) => folderPath === r.folderPath || folderPath.startsWith(r.folderPath + "/"))
      .sort((a, b) => a.folderPath.split("/").length - b.folderPath.split("/").length);
  }

  async refresh(file: TFile): Promise<void> {
    if (this.isManifestFile(file)) {
      const content = await this.app.vault.read(file);
      const data = parseManifest(content);
      const folderPath = file.path.replace(/\/manifest\.md$/, "");
      this.manifests.set(file.path, { path: file.path, folderPath, data });
      return;
    }
    if (this.isRulesFile(file)) {
      const content = await this.app.vault.read(file);
      const data = parseManifest(content);
      this.rulesFiles.set(file.path, {
        path: file.path,
        folderPath: file.path.replace(/\/rules\.md$/, ""),
        name: typeof data.name === "string" ? data.name : undefined,
        rules: Array.isArray(data.rules) ? data.rules : [],
        parseError: data.parseError,
      });
    }
  }

  delete(filePath: string): void {
    this.manifests.delete(filePath);
    this.rulesFiles.delete(filePath);
  }
}
