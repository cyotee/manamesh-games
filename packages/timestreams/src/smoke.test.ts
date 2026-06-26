import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("package scaffolding", () => {
  it("exports the package name", () => {
    expect(PACKAGE_NAME).toBe("@manamesh/timestreams");
  });
});
