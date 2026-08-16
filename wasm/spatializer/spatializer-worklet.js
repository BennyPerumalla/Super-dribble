/*****************************************************************************
 * spatializer-worklet.js: AudioWorklet bridge for the spatializer WASM engine
 *****************************************************************************
 * Copyright (C) 2024 Benny Perumalla
 *
 * Author: Benny Perumalla <benny01r@gmail.com>
 ******************************************************************************/

const BUFFER_CAPACITY = 128;
const WASI_BAD_FILE_DESCRIPTOR = 8;

function createWasiImports() {
  return {
    wasi_snapshot_preview1: {
      fd_write: () => WASI_BAD_FILE_DESCRIPTOR,
      fd_close: () => WASI_BAD_FILE_DESCRIPTOR,
      fd_seek: () => WASI_BAD_FILE_DESCRIPTOR,
    },
  };
}

class SuperDribbleSpatializerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.disposed = false;
    this.spatializer = 0;
    this.leftPointer = 0;
    this.rightPointer = 0;

    try {
      const processorOptions = options.processorOptions ?? {};
      if (!(processorOptions.wasmModule instanceof WebAssembly.Module)) {
        throw new Error('Spatializer WebAssembly.Module was not provided');
      }

      const instance = new WebAssembly.Instance(
        processorOptions.wasmModule,
        createWasiImports(),
      );
      this.exports = instance.exports;
      this.exports._initialize();

      const bufferBytes = BUFFER_CAPACITY * Float32Array.BYTES_PER_ELEMENT;
      this.leftPointer = this.exports.malloc(bufferBytes);
      this.rightPointer = this.exports.malloc(bufferBytes);
      this.spatializer = this.exports.create_spatializer(sampleRate);
      if (!this.leftPointer || !this.rightPointer || !this.spatializer) {
        throw new Error('Spatializer WASM allocation failed');
      }

      this.leftBuffer = new Float32Array(
        this.exports.memory.buffer,
        this.leftPointer,
        BUFFER_CAPACITY,
      );
      this.rightBuffer = new Float32Array(
        this.exports.memory.buffer,
        this.rightPointer,
        BUFFER_CAPACITY,
      );

      this.setParameters(processorOptions.initialParams ?? {});
      this.port.onmessage = (event) => this.handleMessage(event.data);
      this.port.postMessage({ type: 'ready' });
    } catch (error) {
      this.dispose();
      this.port.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  handleMessage(message) {
    if (this.disposed || !message) return;
    if (message.type === 'set-params') {
      this.setParameters(message.params ?? {});
    } else if (message.type === 'dispose') {
      this.dispose();
    }
  }

  setParameters(params) {
    if (Number.isFinite(params.width)) {
      this.exports.spatializer_set_width(this.spatializer, params.width);
    }
    if (Number.isFinite(params.decay)) {
      this.exports.spatializer_set_decay(this.spatializer, params.decay);
    }
    if (Number.isFinite(params.damping)) {
      this.exports.spatializer_set_damping(this.spatializer, params.damping);
    }
    if (Number.isFinite(params.mix)) {
      this.exports.spatializer_set_mix(this.spatializer, params.mix);
    }
    if (Number.isFinite(params.crossoverFrequency)) {
      this.exports.spatializer_set_crossover_freq(this.spatializer, params.crossoverFrequency);
    }
    if (Number.isFinite(params.lowWidthFactor)) {
      this.exports.spatializer_set_low_width_factor(this.spatializer, params.lowWidthFactor);
    }
    if (Number.isFinite(params.highWidthFactor)) {
      this.exports.spatializer_set_high_width_factor(this.spatializer, params.highWidthFactor);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.exports) {
      if (this.spatializer) this.exports.destroy_spatializer(this.spatializer);
      if (this.leftPointer) this.exports.free(this.leftPointer);
      if (this.rightPointer) this.exports.free(this.rightPointer);
    }

    this.spatializer = 0;
    this.leftPointer = 0;
    this.rightPointer = 0;
    this.leftBuffer = null;
    this.rightBuffer = null;
  }

  process(inputs, outputs) {
    if (this.disposed) return false;

    const inputBus = inputs[0];
    const outputBus = outputs[0];
    if (!outputBus || !outputBus[0]) return true;

    const inputLeft = inputBus && inputBus[0];
    const inputRight = inputBus && (inputBus[1] || inputLeft);
    const outputLeft = outputBus[0];
    const outputRight = outputBus[1];
    const frameCount = outputLeft.length;

    for (let offset = 0; offset < frameCount; offset += BUFFER_CAPACITY) {
      const chunkFrames = Math.min(BUFFER_CAPACITY, frameCount - offset);
      for (let frame = 0; frame < chunkFrames; frame += 1) {
        const inputIndex = offset + frame;
        this.leftBuffer[frame] = inputLeft && inputIndex < inputLeft.length
          ? inputLeft[inputIndex]
          : 0;
        this.rightBuffer[frame] = inputRight && inputIndex < inputRight.length
          ? inputRight[inputIndex]
          : 0;
      }

      this.exports.spatializer_process_buffer(
        this.spatializer,
        this.leftPointer,
        this.rightPointer,
        chunkFrames,
      );

      for (let frame = 0; frame < chunkFrames; frame += 1) {
        const outputIndex = offset + frame;
        outputLeft[outputIndex] = this.leftBuffer[frame];
        if (outputRight) outputRight[outputIndex] = this.rightBuffer[frame];
      }
    }

    for (let channel = 2; channel < outputBus.length; channel += 1) {
      outputBus[channel].fill(0);
    }
    return true;
  }
}

registerProcessor('super-dribble-spatializer', SuperDribbleSpatializerProcessor);
