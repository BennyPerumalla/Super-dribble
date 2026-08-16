#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const modules = {
  equalizer: {
    source: 'wasm/equalizer/equalizer.cpp',
    output: 'wasm/equalizer/equalizer.wasm',
    exports: [
      'create_equalizer',
      'destroy_equalizer',
      'set_volume_percent',
      'set_band',
      'process_buffer',
    ],
  },
  spatializer: {
    source: 'wasm/spatializer/spatializer.cpp',
    output: 'wasm/spatializer/spatializer.wasm',
    exports: [
      'create_spatializer',
      'destroy_spatializer',
      'spatializer_set_width',
      'spatializer_set_decay',
      'spatializer_set_damping',
      'spatializer_set_mix',
      'spatializer_set_crossover_freq',
      'spatializer_set_low_width_factor',
      'spatializer_set_high_width_factor',
      'spatializer_process_buffer',
    ],
  },
};

function compilerCandidates() {
  const candidates = [];
  if (process.env.EMSDK) {
    candidates.push(path.join(process.env.EMSDK, 'upstream', 'emscripten', 'em++.exe'));
    candidates.push(path.join(process.env.EMSDK, 'upstream', 'emscripten', 'em++.bat'));
  }
  candidates.push(path.join(ROOT, 'emsdk', 'upstream', 'emscripten', 'em++.exe'));
  candidates.push(path.join(ROOT, 'emsdk', 'upstream', 'emscripten', 'em++.bat'));
  candidates.push('em++');
  return [...new Set(candidates)];
}

function findCompiler() {
  for (const candidate of compilerCandidates()) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', shell: false });
    if (result.status === 0) return candidate;
  }
  return null;
}

function buildModule(compiler, name, config) {
  const exportedFunctions = [...config.exports, 'malloc', 'free'].map((entry) => `_${entry}`);
  const args = [
    path.join(ROOT, config.source),
    '-o', path.join(ROOT, config.output),
    '-std=c++17',
    '-O3',
    '-fno-exceptions',
    '--no-entry',
    '-sSTANDALONE_WASM=1',
    `-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
    '-sFILESYSTEM=0',
    '-sMALLOC=emmalloc',
    '-sALLOW_MEMORY_GROWTH=0',
    '-sINITIAL_MEMORY=8388608',
    '-sSTACK_SIZE=131072',
    '-sASSERTIONS=0',
  ];

  console.log(`Building ${name} WASM...`);
  const result = spawnSync(compiler, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`${name} WASM build failed with exit code ${result.status}`);
  console.log(`Built ${config.output}`);
}

function selectedModules(argv = process.argv.slice(2)) {
  const moduleFlag = argv.find((arg) => arg.startsWith('--module='));
  if (!moduleFlag) return Object.keys(modules);
  const selected = moduleFlag.slice('--module='.length);
  if (selected === 'all') return Object.keys(modules);
  if (!modules[selected]) throw new Error(`Unknown module "${selected}". Use equalizer, spatializer, or all.`);
  return [selected];
}

function buildWasm(argv) {
  const compiler = findCompiler();
  if (!compiler) {
    throw new Error('Emscripten was not found. Install/activate emsdk; placeholder WASM files are not supported.');
  }

  const selected = selectedModules(argv);
  console.log(`Using Emscripten compiler: ${compiler}`);
  selected.forEach((name) => buildModule(compiler, name, modules[name]));
  console.log(`Built ${selected.length} WASM module(s) successfully.`);
}

if (require.main === module) {
  try {
    buildWasm();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { buildWasm, findCompiler, selectedModules };
