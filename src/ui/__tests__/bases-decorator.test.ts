import { type App, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SchemaResolver } from "../../schema/resolver";
import type { PluginSettings } from "../../settings";
import type { ResolvedSchema } from "../../types";
import { BasesDecorator } from "../bases-decorator";

const { openQuickEdit } = vi.hoisted(() => ({ openQuickEdit: vi.fn() }));

vi.mock("../quick-edit-modal", () => ({
  QuickEditModal: class {
    open(): void {
      openQuickEdit();
    }
  },
}));

function makeFile(path: string): TFile {
  return TFile.create__({} as never, path);
}

describe("BasesDecorator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    openQuickEdit.mockClear();
  });

  it("lets a Bases checkbox toggle without opening the quick editor", async () => {
    document.body.innerHTML = `
      <div class="bases-view">
        <table>
          <tbody>
            <tr class="bases-tr">
              <td class="bases-td" data-property="file.name">
                <a data-href="Notes/daily.md">daily</a>
              </td>
              <td class="bases-td" data-property="note.reviewed">
                <label><input type="checkbox"><span>reviewed</span></label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const file = makeFile("Notes/daily.md");
    const schema: ResolvedSchema = {
      manifestPath: "schemas/daily/manifest.md",
      inheritanceChain: ["schemas/daily/manifest.md"],
      name: "daily",
      priority: 0,
      target: {},
      fields: { reviewed: { type: "boolean" } },
      formatting: {},
    };
    const app = {
      vault: { getAbstractFileByPath: vi.fn(() => file) },
      metadataCache: { getFileCache: vi.fn(() => ({ frontmatter: { reviewed: false } })) },
    } as unknown as App;
    const resolver = {
      resolveForNote: vi.fn(() => schema),
    } as unknown as SchemaResolver;
    const settings = { interceptBases: true } as PluginSettings;
    const decorator = new BasesDecorator(app, resolver, settings);
    const checkbox = document.querySelector<HTMLInputElement>("input[type='checkbox']");

    decorator.attach();
    try {
      checkbox?.click();
      await Promise.resolve();

      expect(checkbox?.checked).toBe(true);
      expect(resolver.resolveForNote).not.toHaveBeenCalled();
      expect(openQuickEdit).not.toHaveBeenCalled();
    } finally {
      decorator.detach();
    }
  });

  it("still opens the quick editor for a number input", async () => {
    document.body.innerHTML = `
      <div class="bases-view">
        <table>
          <tbody>
            <tr class="bases-tr">
              <td class="bases-td" data-property="file.name">
                <a data-href="Notes/daily.md">daily</a>
              </td>
              <td class="bases-td" data-property="note.rating">
                <input type="number" value="5">
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const file = makeFile("Notes/daily.md");
    const schema: ResolvedSchema = {
      manifestPath: "schemas/daily/manifest.md",
      inheritanceChain: ["schemas/daily/manifest.md"],
      name: "daily",
      priority: 0,
      target: {},
      fields: { rating: { type: "number" } },
      formatting: {},
    };
    const app = {
      vault: { getAbstractFileByPath: vi.fn(() => file) },
      metadataCache: { getFileCache: vi.fn(() => ({ frontmatter: { rating: 5 } })) },
    } as unknown as App;
    const resolver = {
      resolveForNote: vi.fn(() => schema),
    } as unknown as SchemaResolver;
    const settings = { interceptBases: true } as PluginSettings;
    const decorator = new BasesDecorator(app, resolver, settings);
    const numberInput = document.querySelector<HTMLInputElement>("input[type='number']");

    decorator.attach();
    try {
      numberInput?.click();
      await vi.waitFor(() => expect(openQuickEdit).toHaveBeenCalledOnce());
    } finally {
      decorator.detach();
    }
  });
});
