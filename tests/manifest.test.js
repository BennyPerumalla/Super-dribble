const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
);

test("manifest limits site access to the tab explicitly invoked by the user", () => {
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["activeTab", "offscreen", "scripting", "tabCapture"].sort(),
  );
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.host_permissions, undefined);
});

test("content script is available for user-triggered injection only", () => {
  assert.equal(fs.existsSync(path.join(root, "content.js")), true);
  const source = fs.readFileSync(path.join(root, "content.js"), "utf8");
  assert.match(source, /initializeSuperDribbleContentScript/);
  assert.match(source, /__superDribbleContentScriptLoaded/);
});
