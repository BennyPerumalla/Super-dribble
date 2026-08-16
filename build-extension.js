#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execSync, spawnSync } = require('node:child_process');

const ROOT = __dirname;
const OUTPUT_ROOT = path.join(ROOT, 'output');
const PACKAGE_ROOT = path.join(OUTPUT_ROOT, 'super-dribble-extension');
const ZIP_PATH = path.join(OUTPUT_ROOT, 'super-dribble-extension.zip');

const runtimeFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'offscreen.html',
  'offscreen.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'lua/fengari.min.js',
  'wasm/equalizer/equalizer.wasm',
  'wasm/equalizer/equalizer-worklet.js',
  'wasm/equalizer/presets.lua',
  'wasm/spatializer/spatializer.wasm',
  'wasm/spatializer/spatializer-worklet.js',
  'wasm/spatializer/spatializer_presets.lua',
];

const runtimeDirectories = ['UI/build'];

function runBuilds() {
  console.log('Building WASM DSP modules...');
  execFileSync(process.execPath, [path.join(ROOT, 'build-wasm.js')], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  console.log('\nBuilding UI...');
  execSync('pnpm run build', {
    cwd: path.join(ROOT, 'UI'),
    stdio: 'inherit',
  });
}

function assertRuntimeInputs() {
  const missingFiles = runtimeFiles.filter((relativePath) => {
    const sourcePath = path.join(ROOT, relativePath);
    return !fs.existsSync(sourcePath) || fs.statSync(sourcePath).size === 0;
  });
  const missingDirectories = runtimeDirectories.filter((relativePath) => {
    const sourcePath = path.join(ROOT, relativePath);
    return !fs.existsSync(sourcePath)
      || !fs.statSync(sourcePath).isDirectory()
      || fs.readdirSync(sourcePath).length === 0;
  });
  const missing = [...missingFiles, ...missingDirectories];

  if (missing.length > 0) {
    throw new Error(`Runtime build inputs are missing or empty:\n${missing.join('\n')}`);
  }
}

function copyRuntimePackage() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  fs.rmSync(PACKAGE_ROOT, { recursive: true, force: true });
  fs.mkdirSync(PACKAGE_ROOT, { recursive: true });

  for (const relativePath of runtimeFiles) {
    const sourcePath = path.join(ROOT, relativePath);
    const destinationPath = path.join(PACKAGE_ROOT, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }

  for (const relativePath of runtimeDirectories) {
    fs.cpSync(path.join(ROOT, relativePath), path.join(PACKAGE_ROOT, relativePath), {
      recursive: true,
    });
  }
}

function directorySize(directoryPath) {
  let bytes = 0;
  const pending = [directoryPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile()) bytes += fs.statSync(entryPath).size;
    }
  }
  return bytes;
}

function createReleaseArchive() {
  fs.rmSync(ZIP_PATH, { force: true });

  let result;
  if (process.platform === 'win32') {
    const quotePowerShell = (value) => value.replaceAll("'", "''");
    const packageGlob = `${quotePowerShell(PACKAGE_ROOT)}\\*`;
    const archivePath = quotePowerShell(ZIP_PATH);
    result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path '${packageGlob}' -DestinationPath '${archivePath}' -CompressionLevel Optimal -Force`,
      ],
      { cwd: ROOT, stdio: 'inherit', shell: false },
    );
  } else {
    result = spawnSync('zip', ['-q', '-r', ZIP_PATH, '.'], {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
      shell: false,
    });
  }

  if (result.status !== 0 || !fs.existsSync(ZIP_PATH)) {
    throw new Error('Could not create the Chrome Web Store ZIP archive');
  }
}

function main() {
  console.log('Building Super Dribble Chrome Extension...\n');
  runBuilds();
  assertRuntimeInputs();
  copyRuntimePackage();

  execFileSync(process.execPath, [path.join(ROOT, 'verify-extension.js'), PACKAGE_ROOT], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  createReleaseArchive();

  const packageBytes = directorySize(PACKAGE_ROOT);
  const archiveBytes = fs.statSync(ZIP_PATH).size;
  console.log('\nExtension package created successfully.');
  console.log(`Package: ${PACKAGE_ROOT}`);
  console.log(`Size: ${(packageBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Web Store ZIP: ${ZIP_PATH}`);
  console.log(`ZIP size: ${(archiveBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log('\nLoad this exact folder in chrome://extensions:');
  console.log(PACKAGE_ROOT);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  PACKAGE_ROOT,
  ZIP_PATH,
  copyRuntimePackage,
  createReleaseArchive,
  directorySize,
  runtimeDirectories,
  runtimeFiles,
};
