/*****************************************************************************
 * equalizer.cpp: Core DSP logic for a 16-band parametric equalizer
 *****************************************************************************
 * Copyright (C) 2024 Benny Perumalla
 *
 * Author: Benny Perumalla <benny01r@gmail.com>
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston MA 02110-1301, USA.
 *****************************************************************************/

#include <cmath>

const double PI = 3.14159265358979323846;
const int MAX_BANDS = 16;

/**
 * @enum FilterType
 * @brief Defines the available filter types for each EQ band.
 */
enum FilterType {
    PEAKING = 0,
    LOW_PASS = 1,
    HIGH_PASS = 2,
    LOW_SHELF = 3,
    HIGH_SHELF = 4
};

/**
 * @class BiquadFilter
 * @brief Implements a single second-order IIR filter (biquad).
 *
 * This class holds the coefficients and state for one filter band.
 * The processSample method is designed to be lock-free and real-time safe,
 * making it suitable for use in an audio processing callback.
 */
class BiquadFilter {
public:
    double a0, a1, a2, b1, b2; // Filter coefficients
    double z1, z2;             // Filter state (delay line)

    BiquadFilter() : a0(1.0), a1(0.0), a2(0.0), b1(0.0), b2(0.0), z1(0.0), z2(0.0) {}

    /**
     * Processes a single audio sample.
     * @param in The input sample.
     * @return The filtered output sample.
     */
    double processSample(double in) {
        double out = in * a0 + z1;
        z1 = in * a1 - b1 * out + z2;
        z2 = in * a2 - b2 * out;
        return out;
    }
};

/**
 * @class Equalizer
 * @brief Manages a chain of 16 biquad filters.
 *
 * This is the main class that will be exposed to JavaScript via WASM bindings.
 * It provides an interface to set parameters for each band and to process
 * a buffer of audio data.
 */
class Equalizer {
private:
    double sampleRate;
    BiquadFilter bandsLeft[MAX_BANDS];
    BiquadFilter bandsRight[MAX_BANDS];

public:
    Equalizer(double rate) : sampleRate(rate) {}

    /**
     * Sets the parameters for a specific EQ band.
     * This function recalculates the biquad coefficients based on the provided
     * frequency, gain (in dB), Q factor, and filter type.
     *
     * @param bandIndex The index of the band to modify (0-15).
     * @param frequency The center/cutoff frequency of the band in Hz.
     * @param gainDb The gain in decibels (dB).
     * @param q The Q factor (bandwidth/slope).
     * @param filterType The type of filter (PEAKING, LOW_PASS, HIGH_PASS, LOW_SHELF, HIGH_SHELF).
     */
    void setBand(int bandIndex, double frequency, double gainDb, double q, FilterType filterType = PEAKING) {
        if (bandIndex < 0 || bandIndex >= MAX_BANDS) {
            return;
        }

        // All formulas derived from the Audio EQ Cookbook by Robert Bristow-Johnson.
    
    void setBand(int bandIndex, double frequency, double gainDb, double q) {
        if (bandIndex < 0 || bandIndex >= MAX_BANDS) {
            return;
        }
        
        if (q <= 0.0) return;
        if(frequency <= 0.0 || frequency > sampleRate / 2.0) return;
    
        // This is a standard formula for a peaking EQ filter, derived from the
        // Audio EQ Cookbook by Robert Bristow-Johnson.
        double A = pow(10, gainDb / 40.0);
        double w0 = 2.0 * PI * frequency / sampleRate;
        double cos_w0 = cos(w0);
        double sin_w0 = sin(w0);
        double alpha = sin_w0 / (2.0 * q);

        double b0_coeff, b1_coeff, b2_coeff;
        double a0_coeff, a1_coeff, a2_coeff;

        switch (filterType) {
            case PEAKING:
                b0_coeff = 1.0 + alpha * A;
                b1_coeff = -2.0 * cos_w0;
                b2_coeff = 1.0 - alpha * A;
                a0_coeff = 1.0 + alpha / A;
                a1_coeff = -2.0 * cos_w0;
                a2_coeff = 1.0 - alpha / A;
                break;

            case LOW_PASS:
                b0_coeff = (1.0 - cos_w0) / 2.0;
                b1_coeff = 1.0 - cos_w0;
                b2_coeff = (1.0 - cos_w0) / 2.0;
                a0_coeff = 1.0 + alpha;
                a1_coeff = -2.0 * cos_w0;
                a2_coeff = 1.0 - alpha;
                break;

            case HIGH_PASS:
                b0_coeff = (1.0 + cos_w0) / 2.0;
                b1_coeff = -(1.0 + cos_w0);
                b2_coeff = (1.0 + cos_w0) / 2.0;
                a0_coeff = 1.0 + alpha;
                a1_coeff = -2.0 * cos_w0;
                a2_coeff = 1.0 - alpha;
                break;

            case LOW_SHELF:
                {
                    double sqrt_A = sqrt(A);
                    b0_coeff = A * ((A + 1) - (A - 1) * cos_w0 + 2.0 * sqrt_A * alpha);
                    b1_coeff = 2.0 * A * ((A - 1) - (A + 1) * cos_w0);
                    b2_coeff = A * ((A + 1) - (A - 1) * cos_w0 - 2.0 * sqrt_A * alpha);
                    a0_coeff = (A + 1) + (A - 1) * cos_w0 + 2.0 * sqrt_A * alpha;
                    a1_coeff = -2.0 * ((A - 1) + (A + 1) * cos_w0);
                    a2_coeff = (A + 1) + (A - 1) * cos_w0 - 2.0 * sqrt_A * alpha;
                }
                break;

            case HIGH_SHELF:
                {
                    double sqrt_A = sqrt(A);
                    b0_coeff = A * ((A + 1) + (A - 1) * cos_w0 + 2.0 * sqrt_A * alpha);
                    b1_coeff = -2.0 * A * ((A - 1) + (A + 1) * cos_w0);
                    b2_coeff = A * ((A + 1) + (A - 1) * cos_w0 - 2.0 * sqrt_A * alpha);
                    a0_coeff = (A + 1) - (A - 1) * cos_w0 + 2.0 * sqrt_A * alpha;
                    a1_coeff = 2.0 * ((A - 1) - (A + 1) * cos_w0);
                    a2_coeff = (A + 1) - (A - 1) * cos_w0 - 2.0 * sqrt_A * alpha;
                }
                break;

            default:
                // Fallback to peaking
                b0_coeff = 1.0 + alpha * A;
                b1_coeff = -2.0 * cos_w0;
                b2_coeff = 1.0 - alpha * A;
                a0_coeff = 1.0 + alpha / A;
                a1_coeff = -2.0 * cos_w0;
                a2_coeff = 1.0 - alpha / A;
                break;
        }

        for(int ch = 0; ch < 2; ch++) {
            BiquadFilter& band = ch == 0 ? bandsLeft[bandIndex] : bandsRight[bandIndex];
            band.b1 = b1_coeff / a0_coeff;
            band.b2 = b2_coeff / a0_coeff;
            band.a0 = b0_coeff / a0_coeff;
            band.a1 = a1_coeff / a0_coeff;
            band.a2 = a2_coeff / a0_coeff;
        }
    }

    /**
     * Processes a block of audio samples in place.
     * The input buffer is modified directly with the output.
     *
     * @param buffer A pointer to an interleaved stereo audio buffer.
     * @param numSamples The number of samples in the buffer.
     */
    void process(float* buffer, int numSamples) {

        for (int i = 0; i < numSamples; i += 2) {
            // Process left channel
            double sampleLeft = buffer[i];
            for (int j = 0; j < MAX_BANDS; ++j) {
                sampleLeft = bandsLeft[j].processSample(sampleLeft);
            }
            // Simple hard clipping for safety. A proper limiter would be better in a full implementation.
            if (sampleLeft > 1.0) sampleLeft = 1.0;
            if (sampleLeft < -1.0) sampleLeft = -1.0;
            buffer[i] = (float)sampleLeft;

            // Process right channel
            double sampleRight = buffer[i + 1];
            for (int j = 0; j < MAX_BANDS; ++j) {
                sampleRight = bandsRight[j].processSample(sampleRight);
            }
            if (sampleRight > 1.0) sampleRight = 1.0;
            if (sampleRight < -1.0) sampleRight = -1.0;
            buffer[i + 1] = (float)sampleRight;
        }
    }
};

// These functions provide a C-compatible interface for JavaScript to interact with the C++ classes.
extern "C" {
    Equalizer* create_equalizer(double sampleRate) {
        return new Equalizer(sampleRate);
    }

    void destroy_equalizer(Equalizer* eq) {
        delete eq;
    }

    void set_band(Equalizer* eq, int bandIndex, double frequency, double gainDb, double q, int filterType) {
        eq->setBand(bandIndex, frequency, gainDb, q, static_cast<FilterType>(filterType));
    }

    void process_buffer(Equalizer* eq, float* buffer, int numSamples) {
        eq->process(buffer, numSamples);
    }
}
