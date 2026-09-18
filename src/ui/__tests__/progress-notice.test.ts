import { describe, expect, it } from "vitest";
import { formatProgress } from "../progress-notice";

describe("formatProgress", () => {
  it("renders an empty bar when the total is unknown", () => {
    expect(formatProgress("Scanning vault", { processed: 0, total: 0 })).toBe(
      "Scanning vault [..............] 0/? (0%)"
    );
  });

  it("fills the bar proportionally and clamps overflow", () => {
    expect(formatProgress("Applying auto-fix", { processed: 50, total: 100 }, 10)).toBe(
      "Applying auto-fix [#####.....] 50/100 (50%)"
    );
    expect(formatProgress("X", { processed: 120, total: 100 }, 4)).toBe("X [####] 100/100 (100%)");
    expect(formatProgress("X", { processed: -3, total: 10 }, 4)).toBe("X [....] 0/10 (0%)");
  });
});
