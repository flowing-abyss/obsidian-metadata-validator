import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { runJsValidator } from "../js-validator";

const FIELD = "custom";
const VALUE = "test-value";
const MANIFEST = "schemas/book/manifest.md";

function makeApp(dataview?: Record<string, unknown>): App {
	return {
		plugins: {
			plugins: {
				dataview: dataview ? { api: dataview } : undefined,
			},
		},
	} as unknown as App;
}

function makeFile(path: string): TFile {
	return {
		path,
		basename: path.split("/").pop() ?? "",
		extension: "md",
	} as TFile;
}

describe("runJsValidator", () => {
	it("returns null when JS returns true", async () => {
		const result = await runJsValidator(
			FIELD,
			VALUE,
			"return true;",
			makeApp(),
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		expect(result).toBeNull();
	});

	it("returns error with custom message when JS returns a string", async () => {
		const result = await runJsValidator(
			FIELD,
			VALUE,
			'return "Custom error";',
			makeApp(),
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		expect(result).not.toBeNull();
		expect(result?.severity).toBe("error");
		expect(result?.message).toBe("Custom error");
		expect(result?.rule).toBe("js-validator");
	});

	it("returns generic error when JS returns false", async () => {
		const result = await runJsValidator(
			FIELD,
			VALUE,
			"return false;",
			makeApp(),
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		expect(result?.message).toBe('"custom" failed custom JS validation.');
	});

	it("returns generic error when JS returns a number", async () => {
		const result = await runJsValidator(
			FIELD,
			VALUE,
			"return 42;",
			makeApp(),
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		expect(result?.message).toBe('"custom" failed custom JS validation.');
	});

	it("returns error when JS throws an exception", async () => {
		const result = await runJsValidator(
			FIELD,
			VALUE,
			'throw new Error("boom");',
			makeApp(),
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		expect(result?.severity).toBe("error");
		expect(result?.message).toContain("boom");
	});

	it("provides app, dv, currentFile, currentPage and value to the function", async () => {
		const code = `
      if (app == null) return "missing app";
      if (dv == null) return "missing dv";
      if (currentFile == null) return "missing currentFile";
      if (currentPage == null) return "missing currentPage";
      if (value !== "test-value") return "wrong value";
      return true;
    `;
		const dv = { page: () => ({ name: "page-data" }) };
		const result = await runJsValidator(
			FIELD,
			VALUE,
			code,
			makeApp(dv),
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		expect(result).toBeNull();
	});

	it("handles DataView page() returning null gracefully", async () => {
		const dv = { page: () => null };
		const result = await runJsValidator(
			FIELD,
			VALUE,
			"return true;",
			makeApp(dv),
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		expect(result).toBeNull();
	});

	it("handles DataView page() throwing gracefully", async () => {
		const dv = {
			page: () => {
				throw new Error("dv error");
			},
		};
		const result = await runJsValidator(
			FIELD,
			VALUE,
			"return true;",
			makeApp(dv),
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		expect(result).toBeNull();
	});

	it("handles dv at app.plugins.dataview directly (fallback)", async () => {
		const app = {
			plugins: {
				dataview: { api: { page: () => null } },
			},
		} as unknown as App;
		const result = await runJsValidator(
			FIELD,
			VALUE,
			"return true;",
			app,
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		expect(result).toBeNull();
	});

	it("times out when JS promise never resolves", async () => {
		vi.useFakeTimers();
		const promise = runJsValidator(
			FIELD,
			VALUE,
			"return new Promise(() => {})",
			makeApp(),
			makeFile("Notes/A.md"),
			MANIFEST,
		);
		vi.advanceTimersByTime(3000);
		const result = await promise;
		vi.useRealTimers();
		expect(result).not.toBeNull();
		expect(result?.message).toContain("timed out");
		expect(result?.field).toBe(FIELD);
		expect(result?.manifestPath).toBe(MANIFEST);
		expect(result?.autoFixed).toBe(false);
		expect(result?.rule).toBe("js-validator");
	});
});
