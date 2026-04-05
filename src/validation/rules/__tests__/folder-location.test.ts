import { describe, it, expect } from "vitest";
import { checkFolderLocation } from "../folder-location";

describe("checkFolderLocation", () => {
  it("returns null when note is already in the target folder", () => {
    const result = checkFolderLocation(
      "Books/Atomic Habits.md",
      "Books/",
      "schemas/book/manifest.md"
    );
    expect(result).toBeNull();
  });

  it("returns a move result when note is outside target folder", () => {
    const result = checkFolderLocation(
      "Inbox/Atomic Habits.md",
      "Books/",
      "schemas/book/manifest.md"
    );
    expect(result).not.toBeNull();
    expect(result?.rule).toBe("enforce_folder");
    expect(result?.targetPath).toBe("Books/Atomic Habits.md");
    expect(result?.severity).toBe("warning");
  });

  it("handles nested target folders correctly", () => {
    const result = checkFolderLocation(
      "Resources/Books/Dune.md",
      "Resources/Books/",
      "schemas/book/manifest.md"
    );
    expect(result).toBeNull();
  });

  it("constructs correct target path preserving filename", () => {
    const result = checkFolderLocation(
      "Dump/My Great Book.md",
      "Library/Books/",
      "schemas/book/manifest.md"
    );
    expect(result?.targetPath).toBe("Library/Books/My Great Book.md");
  });
});
