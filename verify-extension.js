#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const defaultExtensionRoot = path.join(
  __dirname,
  "output",
  "super-dribble-extension",
);
const extensionRoot = path.resolve(process.argv[2] || defaultExtensionRoot);
console.log(
  `🔍 Verifying Super Dribble Chrome Extension at ${extensionRoot}...\n`,
);

// Required files for the extension
const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "offscreen.html",
  "offscreen.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "UI/build/index.html",
  "wasm/equalizer/equalizer.wasm",
  "wasm/equalizer/equalizer-worklet.js",
  "wasm/equalizer/presets.lua",
  "wasm/spatializer/spatializer.wasm",
  "wasm/spatializer/spatializer-worklet.js",
  "wasm/spatializer/spatializer_presets.lua",
  "lua/fengari.min.js",
];

// Check if files exist
let allFilesPresent = true;
const missingFiles = [];

console.log("Checking required files:");
requiredFiles.forEach((file) => {
  const filePath = path.join(extensionRoot, file);
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    console.log(`${file}`);
  } else {
    console.log(`${file} - MISSING OR EMPTY`);
    missingFiles.push(file);
    allFilesPresent = false;
  }
});

function listFiles(directoryPath) {
  const files = [];
  const pending = [directoryPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  return files;
}

const packageFiles = listFiles(extensionRoot);
const allowedFiles = new Set(requiredFiles);
const unexpectedFiles = packageFiles
  .map((filePath) =>
    path.relative(extensionRoot, filePath).replaceAll("\\", "/"),
  )
  .filter(
    (relativePath) =>
      !allowedFiles.has(relativePath) && !relativePath.startsWith("UI/build/"),
  );

if (unexpectedFiles.length > 0) {
  console.log(
    `Package contains ${unexpectedFiles.length} non-runtime file(s):`,
  );
  unexpectedFiles.slice(0, 20).forEach((file) => console.log(`  - ${file}`));
  if (unexpectedFiles.length > 20)
    console.log(`  - ...and ${unexpectedFiles.length - 20} more`);
  allFilesPresent = false;
} else {
  console.log("Package contains runtime files only");
}

const packageBytes = packageFiles.reduce(
  (total, filePath) => total + fs.statSync(filePath).size,
  0,
);
const maximumPackageBytes = 20 * 1024 * 1024;
if (packageBytes > maximumPackageBytes) {
  console.log(
    `❌ Package is too large: ${(packageBytes / 1024 / 1024).toFixed(2)} MB`,
  );
  allFilesPresent = false;
} else {
  console.log(`Package size: ${(packageBytes / 1024 / 1024).toFixed(2)} MB`);
}

for (const wasmFile of [
  "wasm/equalizer/equalizer.wasm",
  "wasm/spatializer/spatializer.wasm",
]) {
  const wasmPath = path.join(extensionRoot, wasmFile);
  if (!fs.existsSync(wasmPath)) continue;

  const magic = fs.readFileSync(wasmPath).subarray(0, 4);
  if (magic.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
    console.log(`${wasmFile} has a valid WebAssembly header`);
  } else {
    console.log(`${wasmFile} is not a valid WebAssembly binary`);
    allFilesPresent = false;
  }
}

const requiredWasmExports = {
  "wasm/equalizer/equalizer.wasm": [
    "create_equalizer",
    "destroy_equalizer",
    "set_volume_percent",
    "set_band",
    "process_buffer",
    "malloc",
    "free",
  ],
  "wasm/spatializer/spatializer.wasm": [
    "create_spatializer",
    "destroy_spatializer",
    "spatializer_set_width",
    "spatializer_set_decay",
    "spatializer_set_damping",
    "spatializer_set_mix",
    "spatializer_set_crossover_freq",
    "spatializer_set_low_width_factor",
    "spatializer_set_high_width_factor",
    "spatializer_process_buffer",
    "malloc",
    "free",
  ],
};

for (const [wasmFile, expectedExports] of Object.entries(requiredWasmExports)) {
  try {
    const module = new WebAssembly.Module(
      fs.readFileSync(path.join(extensionRoot, wasmFile)),
    );
    const exports = new Set(
      WebAssembly.Module.exports(module).map((entry) => entry.name),
    );
    expectedExports.forEach((name) => {
      if (exports.has(name)) {
        console.log(`${wasmFile} exports ${name}`);
      } else {
        console.log(`${wasmFile} is missing export ${name}`);
        allFilesPresent = false;
      }
    });
  } catch (error) {
    console.log(`Could not inspect ${wasmFile}: ${error.message}`);
    allFilesPresent = false;
  }
}

const offscreenSource = fs.readFileSync(
  path.join(extensionRoot, "offscreen.js"),
  "utf8",
);
if (
  /createGain|createBiquadFilter|createScriptProcessor|onaudioprocess/.test(
    offscreenSource,
  )
) {
  console.log("offscreen.js contains JavaScript/Web Audio DSP nodes");
  allFilesPresent = false;
} else if (/AudioWorkletNode/.test(offscreenSource)) {
  console.log("offscreen.js routes audio through WASM AudioWorklet nodes");
} else {
  console.log("offscreen.js does not create a WASM AudioWorklet pipeline");
  allFilesPresent = false;
}

// Check manifest.json structure
console.log("\nChecking manifest.json:");
let manifest = null;
try {
  const manifestPath = path.join(extensionRoot, "manifest.json");
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const requiredManifestFields = [
    "manifest_version",
    "name",
    "version",
    "description",
    "permissions",
    "action",
    "background",
  ];

  requiredManifestFields.forEach((field) => {
    if (manifest[field]) {
      console.log(`${field}: ${JSON.stringify(manifest[field])}`);
    } else {
      console.log(`${field}: MISSING`);
      allFilesPresent = false;
    }
  });

  const requiredPermissions = new Set([
    "activeTab",
    "tabCapture",
    "scripting",
    "offscreen",
  ]);
  const declaredPermissions = new Set(manifest.permissions || []);
  const missingPermissions = [...requiredPermissions].filter(
    (permission) => !declaredPermissions.has(permission),
  );
  const unexpectedPermissions = [...declaredPermissions].filter(
    (permission) => !requiredPermissions.has(permission),
  );
  if (missingPermissions.length > 0 || unexpectedPermissions.length > 0) {
    console.log(
      `Manifest permissions must be limited to: ${[...requiredPermissions].join(", ")}`,
    );
    allFilesPresent = false;
  } else {
    console.log("Manifest uses only user-invoked capture permissions");
  }

  if (manifest.content_scripts || manifest.host_permissions) {
    console.log("Manifest must not request broad host access or automatic injection");
    allFilesPresent = false;
  } else {
    console.log("No broad host access or automatic content-script injection");
  }

  // Check popup path
  if (manifest.action && manifest.action.default_popup) {
    const popupPath = path.join(extensionRoot, manifest.action.default_popup);
    if (fs.existsSync(popupPath)) {
      console.log(`Popup file exists: ${manifest.action.default_popup}`);
    } else {
      console.log(`Popup file missing: ${manifest.action.default_popup}`);
      allFilesPresent = false;
    }
  }
} catch (error) {
  console.log(`Error reading manifest.json: ${error.message}`);
  allFilesPresent = false;
}

// Check UI build files
console.log("\nChecking UI build:");
const uiBuildPath = path.join(extensionRoot, "UI/build");
if (fs.existsSync(uiBuildPath)) {
  const buildFiles = fs.readdirSync(uiBuildPath);
  console.log(`UI build directory exists with ${buildFiles.length} files`);
  buildFiles.forEach((file) => {
    console.log(` ${file}`);
  });

  if (
    manifest?.content_security_policy?.extension_pages?.includes(
      "'wasm-unsafe-eval'",
    )
  ) {
    console.log("Extension CSP permits packaged WebAssembly");
  } else {
    console.log("Extension CSP is missing wasm-unsafe-eval");
    allFilesPresent = false;
  }

  const indexPath = path.join(uiBuildPath, "index.html");
  if (fs.existsSync(indexPath)) {
    const indexHtml = fs.readFileSync(indexPath, "utf8");
    const localAssets = [
      ...indexHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g),
    ]
      .map((match) => match[1])
      .filter((asset) => !/^(?:[a-z]+:|\/\/|#)/i.test(asset));

    if (localAssets.length === 0) {
      console.log("giUI index does not reference any local build assets");
      allFilesPresent = false;
    }

    localAssets.forEach((asset) => {
      const assetPath = path.resolve(uiBuildPath, asset.split(/[?#]/, 1)[0]);
      const isInsideBuild = assetPath.startsWith(
        path.resolve(uiBuildPath) + path.sep,
      );
      if (
        isInsideBuild &&
        fs.existsSync(assetPath) &&
        fs.statSync(assetPath).size > 0
      ) {
        console.log(
          `UI asset exists: ${path.relative(extensionRoot, assetPath)}`,
        );
      } else {
        console.log(`UI asset missing or invalid: ${asset}`);
        allFilesPresent = false;
      }
    });
  }
} else {
  console.log("UI build directory missing");
  allFilesPresent = false;
}

// Summary
console.log("\nSummary:");
if (allFilesPresent) {
  console.log("🎉 All files are present! The extension is ready to load.");
  console.log("\n📝 Next steps:");
  console.log("1. Open Chrome and go to chrome://extensions/");
  console.log('2. Enable "Developer mode"');
  console.log(
    '3. Click "Load unpacked" and select the verified extension folder',
  );
  console.log("4. Test the extension on a webpage with audio");
} else {
  console.log(" Some files are missing. Please check the errors above.");
  console.log("\nMissing files:");
  missingFiles.forEach((file) => {
    console.log(`  - ${file}`);
  });
  process.exitCode = 1;
}

console.log("\nExtension Structure:");
console.log("├── manifest.json          # Extension configuration");
console.log("├── background.js          # Audio processing service worker");
console.log("├── content.js            # Content script for web pages");
console.log("├── icons/                # Extension icons");
console.log("│   ├── icon16.png");
console.log("│   ├── icon48.png");
console.log("│   └── icon128.png");
console.log("└── UI/                   # React UI application");
console.log("    └── build/            # Compiled UI files");
console.log("        ├── index.html");
console.log("        └── assets/");

console.log("\nAudio Processing Features:");
console.log("10-band parametric equalizer");
console.log("Volume control with mute");
console.log("Preset equalizer settings");
console.log("Real-time audio processing");
console.log("Web Audio API integration");
console.log("Chrome tab capture support");
console.log("WebAssembly DSP processing");
console.log("Lua preset system");
console.log("Spatializer effects");
