import type { App, TFile } from "obsidian";
import { parseManifest } from "./parser";
import type { Manifest } from "../types";

export class ManifestCache {
  private manifests: Map<string, Manifest> = new Map();
  private readonly app: App;
  private readonly schemasRoot: string;

  constructor(app: App, schemasRoot: string) {
    this.app = app;
    this.schemasRoot = schemasRoot.replace(/\/+$/, "");
  }

  async load(): Promise<void> {
    this.manifests.clear();
    const files = this.app.vault.getMarkdownFiles();
    const manifestFiles = files.filter((f) => this.isManifestFile(f));

    await Promise.all(
      manifestFiles.map(async (file) => {
        const content = await this.app.vault.read(file);
        const data = parseManifest(content);
        const folderPath = file.path.replace(/\/manifest\.md$/, "");
        this.manifests.set(file.path, { path: file.path, folderPath, data });
      })
    );
  }

  private isManifestFile(file: TFile): boolean {
    return (
      file.path.startsWith(this.schemasRoot + "/") &&
      file.basename === "manifest" &&
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

  async refresh(file: TFile): Promise<void> {
    if (!this.isManifestFile(file)) return;
    const content = await this.app.vault.read(file);
    const data = parseManifest(content);
    const folderPath = file.path.replace(/\/manifest\.md$/, "");
    this.manifests.set(file.path, { path: file.path, folderPath, data });
  }

  delete(filePath: string): void {
    this.manifests.delete(filePath);
  }
}
