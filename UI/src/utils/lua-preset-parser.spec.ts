import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LuaPresetParser } from "./lua-preset-parser";

const fixturePath = (relativePath: string) =>
  fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));

describe("LuaPresetParser", () => {
  it("parses the bundled equalizer presets", async () => {
    const source = await readFile(
      fixturePath("wasm/equalizer/presets.lua"),
      "utf8",
    );
    const presets = new LuaPresetParser().parsePresets(source, "equalizer");

    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0]).toMatchObject({ name: "Flat" });
    expect(presets[0].bands).toHaveLength(16);
  });

  it("parses the bundled spatializer presets", async () => {
    const source = await readFile(
      fixturePath("wasm/spatializer/spatializer_presets.lua"),
      "utf8",
    );
    const presets = new LuaPresetParser().parsePresets(source, "spatializer");

    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0]).toMatchObject({
      name: "Auditorium",
      params: { width: 1.4, decay: 0.7, damping: 0.4, mix: 0.35 },
    });
  });
});
