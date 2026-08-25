export const EQ_CENTER_FREQUENCIES = Object.freeze([
  32,
  64,
  125,
  250,
  500,
  1000,
  2000,
  4000,
  8000,
  16000,
]);

const BAND_EDGE_FACTOR = Math.SQRT2;

export function createBandBinRanges(
  sampleRate,
  fftSize,
  centerFrequencies = EQ_CENTER_FREQUENCIES,
) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("A positive sample rate is required");
  }
  if (!Number.isInteger(fftSize) || fftSize < 32) {
    throw new Error("A valid FFT size is required");
  }

  const frequencyBinCount = fftSize / 2;
  const nyquist = sampleRate / 2;
  const binWidth = sampleRate / fftSize;

  return centerFrequencies.map((centerFrequency) => {
    const lowerFrequency = Math.max(0, centerFrequency / BAND_EDGE_FACTOR);
    const upperFrequency = Math.min(
      nyquist,
      centerFrequency * BAND_EDGE_FACTOR,
    );
    const startBin = Math.max(
      1,
      Math.min(frequencyBinCount - 1, Math.ceil(lowerFrequency / binWidth)),
    );
    const endBin = Math.max(
      startBin,
      Math.min(frequencyBinCount - 1, Math.floor(upperFrequency / binWidth)),
    );

    return {
      centerFrequency,
      startBin,
      endBin,
    };
  });
}

export function calculateBandEnergies(frequencyData, bandRanges, output) {
  const energies = output ?? new Float32Array(bandRanges.length);

  for (let bandIndex = 0; bandIndex < bandRanges.length; bandIndex += 1) {
    const { startBin, endBin } = bandRanges[bandIndex];
    let sumSquares = 0;
    let binCount = 0;

    for (let binIndex = startBin; binIndex <= endBin; binIndex += 1) {
      const normalizedMagnitude = frequencyData[binIndex] / 255;
      sumSquares += normalizedMagnitude * normalizedMagnitude;
      binCount += 1;
    }

    const rms = binCount > 0 ? Math.sqrt(sumSquares / binCount) : 0;
    energies[bandIndex] = Math.min(1, Math.max(0, (rms - 0.025) / 0.975));
  }

  return energies;
}

export function smoothBandEnergies(
  incoming,
  current,
  attack = 0.5,
  release = 0.12,
) {
  for (let index = 0; index < current.length; index += 1) {
    const target = Number.isFinite(incoming[index]) ? incoming[index] : 0;
    const coefficient = target > current[index] ? attack : release;
    const next = current[index] + (target - current[index]) * coefficient;
    current[index] = next < 0.002 ? 0 : Math.min(1, Math.max(0, next));
  }

  return current;
}
