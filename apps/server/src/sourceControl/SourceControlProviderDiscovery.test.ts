import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { firstNonEmptyLine } from "./SourceControlProviderDiscovery.ts";

describe("firstNonEmptyLine", () => {
  it("strips terminal control sequences from CLI output", () => {
    const line = firstNonEmptyLine("  \n\u001B[1m0.14.2 \u001B[0m golang: 1.26.4-X:nodwarf5\n");

    expect(Option.getOrUndefined(line)).toBe("0.14.2 golang: 1.26.4-X:nodwarf5");
  });
});
