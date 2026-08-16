/*****************************************************************************
 * equalizer-worklet.js: AudioWorklet bridge for the equalizer WASM engine
 *****************************************************************************
 * Copyright (C) 2024 Benny Perumalla
 *
 * Author: Benny Perumalla <benny01r@gmail.com>
 ******************************************************************************/

const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_Q = 1.0;
const BUFFER_CAPACITY = 128;

class SuperDribbleEqualizerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.disposed = false;
    this.equalizer = 0;
    this.leftPointer = 0;
    this.rightPointer = 0;

    try {
      const processorOptions = options.processorOptions ?? {};
      if (!(processorOptions.wasmModule instanceof WebAssembly.Module)) {
        throw new Error('Equalizer WebAssembly.Module was not provided');
      }

      const instance = new WebAssembly.Instance(processorOptions.wasmModule, {});
      this.exports = instance.exports;
      this.exports._initialize();

      const bufferBytes = BUFFER_CAPACITY * Float32Array.BYTES_PER_ELEMENT;
      this.leftPointer = this.exports.malloc(bufferBytes);
      this.rightPointer = this.exports.malloc(bufferBytes);
      this.equalizer = this.exports.create_equalizer(sampleRate);
      if (!this.leftPointer || !this.rightPointer || !this.equalizer) {
        throw new Error('Equalizer WASM allocation failed');
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

      const initialState = processorOptions.initialState ?? {};
      this.setVolume(initialState.volume ?? 100);
      this.setEqualizer(initialState.eqValues ?? []);

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

    if (message.type === 'set-volume') {
      this.setVolume(message.value);
    } else if (message.type === 'set-band') {
      this.setBand(message.index, message.gainDb);
    } else if (message.type === 'set-eq') {
      this.setEqualizer(message.values);
    } else if (message.type === 'dispose') {
      this.dispose();
    }
  }

  setVolume(value) {
    if (Number.isFinite(value)) {
      this.exports.set_volume_percent(this.equalizer, value);
    }
  }

  setBand(index, gainDb) {
    if (!Number.isInteger(index) || index < 0 || index >= EQ_FREQUENCIES.length) return;
    if (!Number.isFinite(gainDb)) return;
    this.exports.set_band(this.equalizer, index, EQ_FREQUENCIES[index], gainDb, EQ_Q);
  }

  setEqualizer(values) {
    for (let index = 0; index < EQ_FREQUENCIES.length; index += 1) {
      const gainDb = Array.isArray(values) && Number.isFinite(values[index]) ? values[index] : 0;
      this.setBand(index, gainDb);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.exports) {
      if (this.equalizer) this.exports.destroy_equalizer(this.equalizer);
      if (this.leftPointer) this.exports.free(this.leftPointer);
      if (this.rightPointer) this.exports.free(this.rightPointer);
    }

    this.equalizer = 0;
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

      this.exports.process_buffer(
        this.equalizer,
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

registerProcessor('super-dribble-equalizer', SuperDribbleEqualizerProcessor);
