/*****************************************************************************
 * spatializer.cpp: Core DSP for stereo spatialization effects
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

#include <vector>
#include <cmath>
#include <algorithm>

const float PI = 3.14159265358979323846f;
const int FDN_ORDER = 4; // 4x4 FDN for a good balance of quality and performance
const float BUTTERWORTH_Q = 1.0f / 1.41421356237f;  // 0.70710678f 

/**
 * @struct DelayLine
 * @brief A simple circular buffer delay line.
 */

struct BiquadFilter {

    // Filter Coefficients
    float b0, b1, b2, a1, a2;
     
    //State  variables for each channel
    float x1 = 0.0f, x2 = 0.0f; //Input history 
    float y1 = 0.0f, y2 = 0.0f; //Output history

    BiquadFilter() : b0(1.0f), b1(0.0f), b2(0.0f), a1(0.0f), a2(0.0f) {}

    void reset() {
        x1 = x2 = y1 = y2 = 0.0f;
    }

    float process(float input) {
        float output = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

        //Update history
        x2 = x1;
        x1 = input;
        y2 = y1;
        y1 = output;

        return output;
    }

    void configure_lowpass(float freq, float sampleRate) {
        float omega = 2.0f * PI * freq / sampleRate;
        float sin_omega = sinf(omega);
        float cos_omega = cosf(omega);
        float alpha = sin_omega / (2.0f * BUTTERWORTH_Q); // ButterWorth 
        
        float a0 = 1.0f + alpha;
        b0 = ((1.0f - cos_omega) / 2.0f ) / a0; 
        b1 = (1.0f - cos_omega) / a0;
        b2 = ((1.0f - cos_omega) / 2.0f ) / a0;
        a1 = (-2.0f * cos_omega) / a0;
        a2 = (1.0f - alpha) / a0;
    }

    void configure_highpass(float freq, float sampleRate) {
        float omega = 2.0f * PI * freq / sampleRate;
        float sin_omega = sinf(omega);
        float cos_omega = cosf(omega);
        float alpha = sin_omega / (2.0f * BUTTERWORTH_Q); // ButterWorth 
        
        float a0 = 1.0f + alpha;
        b0 = ((1.0f + cos_omega) / 2.0f ) / a0; 
        b1 = (-(1.0f + cos_omega)) / a0;
        b2 = ((1.0f + cos_omega) / 2.0f ) / a0;
        a1 = (-2.0f * cos_omega) / a0;
        a2 = (1.0f - alpha) / a0;
    }
};



struct DelayLine {
    std::vector<float> buffer;
    int write_pos = 0;
    int buffer_size;

    DelayLine(int size = 0) {
        set_size(size);
    }

    void set_size(int size) {
        buffer_size = std::max(1, size); 
        buffer.assign(buffer_size, 0.0f);
        write_pos = 0;
    }

    void write(float sample) {
        buffer[write_pos] = sample;
        write_pos = (write_pos + 1) % buffer_size;
    }

    float read(int delay_samples) const {
        int read_pos = (write_pos - delay_samples + buffer_size) % buffer_size;
        return buffer[read_pos];
    }
};

/**
 * @class Spatializer
 * @brief Implements stereo widening and FDN reverberation.
 * The processing chain is as follows:
 * 1. Input (L/R) -> Mid/Side Conversion
 * 2. Side Channel Gain Adjustment (Frequency-Dependent Width)
 * 3. Mid/Side -> L/R Conversion (This is the "Dry" signal: wide_l/r)
 * 4. "Dry" signal is mono-summed and sent to FDN Reverb (This is the "Wet" signal: wet_l/r)
 * 5. Final Dry/Wet Mix: (Dry * (1-mix)) + (Wet * mix)
 */
class Spatializer {
private:
    float sampleRate;

    // --- Crossover Network Components ---
    float crossover_freq = 250.0f; // Crossover frequency in Hz
    float low_width_factor = 0.3f; // Multiplier for width in low frequencies
    float high_width_factor = 1.5f; // Multiplier for width in high frequencies

    // --- Effect Parameters ---
    float width = 1.0f;    // Stereo width (1.0 = normal, >1 = wider)
    float decay = 0.5f;    // Reverb decay time (0-1)
    float damping = 0.5f;  // HF damping in reverb (0-1)
    float mix = 0.25f;     // Dry/Wet mix (0-1)

    // --- FDN Reverb Components ---
    DelayLine delay_lines[FDN_ORDER];
    float fdn_gains[FDN_ORDER]; // Feedback gains derived from decay
    float fdn_lp_z[FDN_ORDER] = {0}; // State for one-pole LPFs (damping)
    int delay_lengths[FDN_ORDER];


    // Filters for mid/side channels (4 filters total for Linkwitz-Riley)
    BiquadFilter mid_lp1, mid_lp2; // Lowpass for mid (cascaded for 4th order)
    BiquadFilter mid_hp1, mid_hp2; // Highpass for mid 
    BiquadFilter side_lp1, side_lp2;  // Lowpass for side
    BiquadFilter side_hp1, side_hp2; // Highpass for side

    // A simple 4x4 Hadamard matrix for feedback mixing. Computationally cheap.
    const float hadamard_matrix[FDN_ORDER][FDN_ORDER] = {
        { 1,  1,  1,  1 },
        { 1, -1,  1, -1 },
        { 1,  1, -1, -1 },
        { 1, -1, -1,  1 }
    };
    const float hadamard_norm = 0.5f; // 1/sqrt(N) for N=4

public:
    Spatializer(float rate) : sampleRate(rate) {
        // Mutually prime delay lengths for a diffuse reverb tail.
        // Scaled to a max of ~100ms.
        const int base_primes[] = { 1553, 1871, 2083, 2221 };
        for (int i = 0; i < FDN_ORDER; ++i) {
            delay_lengths[i] = static_cast<int>((base_primes[i] / 2221.0f) * sampleRate * 0.1f);
            delay_lines[i].set_size(delay_lengths[i] + 2); // A little extra room
        }
        update_crossover();
        update_params();
    }
    
    void update_crossover() {
        // Configure cascaded 2nd order filters for 4th order Linkwitz-Riley response
        mid_lp1.configure_lowpass(crossover_freq, sampleRate);
        mid_lp2.configure_lowpass(crossover_freq, sampleRate);
        mid_hp1.configure_highpass(crossover_freq, sampleRate);
        mid_hp2.configure_highpass(crossover_freq, sampleRate);
        
        side_lp1.configure_lowpass(crossover_freq, sampleRate);
        side_lp2.configure_lowpass(crossover_freq, sampleRate);
        side_hp1.configure_highpass(crossover_freq, sampleRate);
        side_hp2.configure_highpass(crossover_freq, sampleRate);
    }

    void update_params() {
        // Map decay (0-1) to feedback gain. Exponential mapping feels more natural.
        for (int i = 0; i < FDN_ORDER; ++i) {
            if (decay == 0.0){
                fdn_gains[i] = 0.0;
            }
            else{
                fdn_gains[i] = powf(0.001f, (delay_lengths[i]) / (decay * sampleRate));
            }
        }
    }

    // --- Setters for real-time control ---
    void set_width(float w) { if (std::isfinite(w)) width = std::max(0.0f, w); }
    void set_decay(float d) { if (std::isfinite(d)) { decay = std::clamp(d, 0.0f, 1.0f); update_params(); } }
    void set_damping(float d) { if (std::isfinite(d)) damping = std::clamp(d, 0.0f, 1.0f); }
    void set_mix(float m) { if (std::isfinite(m)) mix = std::clamp(m, 0.0f, 1.0f); }
    void set_crossover_freq(float freq) { if (std::isfinite(freq)) { crossover_freq = std::clamp(freq, 50.0f, 500.0f); update_crossover(); } }
    void set_low_width_factor(float factor) { if (std::isfinite(factor)) low_width_factor = std::clamp(factor, 0.0f, 1.0f); }
    void set_high_width_factor(float factor) { if (std::isfinite(factor)) high_width_factor = std::clamp(factor, 0.0f, 3.0f); }
    void process(float* left, float* right, int num_frames) {
        if (!left || !right || num_frames <= 0) {
            return;
        }

        for (int i = 0; i < num_frames; ++i) {
            float dry_l = left[i];
            float dry_r = right[i];

            // --- 1. Frequency-Dependent Stereo Widener (Mid/Side with Crossover) ---
            float mid = (dry_l + dry_r) * 0.5f;
            float side = (dry_l - dry_r) * 0.5f;
           
            // Split mid and side into low and high frequency bands
            float mid_low = mid_lp2.process(mid_lp1.process(mid));
            float mid_high = mid_hp2.process(mid_hp1.process(mid));
            float side_low = side_lp2.process(side_lp1.process(side));
            float side_high = side_hp2.process(side_hp1.process(side));

            // Apply frequency-dependent width control
            side_low *= width * low_width_factor;   // Less width for bass
            side_high *= width * high_width_factor; // More width for highs
           
            // Recombine bands into mid and side
            float processed_mid = mid_low + mid_high;
            float processed_side = side_low + side_high;

            // Convert back to L/R
            float wide_l = processed_mid + processed_side;
            float wide_r = processed_mid - processed_side;

            // --- 2. FDN Reverb (input is mono sum of widened signal) ---
            float fdn_input = (wide_l + wide_r) * 0.5f;
            float fdn_outputs[FDN_ORDER];
            float fdn_mixed_inputs[FDN_ORDER] = {0};

            // Read from delay lines and mix feedback
            for(int j = 0; j < FDN_ORDER; ++j) {
                fdn_outputs[j] = delay_lines[j].read(delay_lengths[j]);
            }

            for(int j = 0; j < FDN_ORDER; ++j) {
                for(int k = 0; k < FDN_ORDER; ++k) {
                    fdn_mixed_inputs[j] += fdn_outputs[k] * hadamard_matrix[j][k];
                }
                fdn_mixed_inputs[j] *= hadamard_norm;
            }

            // Write to delay lines with input, feedback, and damping
            float wet_l = 0.0f, wet_r = 0.0f;
            for(int j = 0; j < FDN_ORDER; ++j) {
                // Apply damping (one-pole LPF)
                float feedback = fdn_mixed_inputs[j] * fdn_gains[j];
                feedback = (1.0f - damping) * feedback + damping * fdn_lp_z[j];
                fdn_lp_z[j] = feedback;

                delay_lines[j].write(fdn_input + feedback);

                // Create stereo output by alternating taps
                if (j % 2 == 0) wet_l += fdn_outputs[j];
                else wet_r += fdn_outputs[j];
            }
            // Normalize reverb output
            wet_l *= 0.5f;
            wet_r *= 0.5f;

            // --- 3. Final Dry/Wet Mix ---
            left[i] = std::clamp((wide_l * (1.0f - mix)) + (wet_l * mix), -1.0f, 1.0f);
            right[i] = std::clamp((wide_r * (1.0f - mix)) + (wet_r * mix), -1.0f, 1.0f);
        }
    }
};

// --- C-style WASM exports ---
extern "C" {
    Spatializer* create_spatializer(float sampleRate) {
        return new Spatializer(sampleRate);
    }

    void destroy_spatializer(Spatializer* sp) {
        delete sp;
    }

    void spatializer_set_width(Spatializer* sp, float width) { if (sp) sp->set_width(width); }
    void spatializer_set_decay(Spatializer* sp, float decay) { if (sp) sp->set_decay(decay); }
    void spatializer_set_damping(Spatializer* sp, float damping) { if (sp) sp->set_damping(damping); }
    void spatializer_set_mix(Spatializer* sp, float mix) { if (sp) sp->set_mix(mix); }
    void spatializer_set_crossover_freq(Spatializer* sp, float freq) { if (sp) sp->set_crossover_freq(freq); }
    void spatializer_set_low_width_factor(Spatializer* sp, float factor) { if (sp) sp->set_low_width_factor(factor); }
    void spatializer_set_high_width_factor(Spatializer* sp, float factor) { if (sp) sp->set_high_width_factor(factor); }
    void spatializer_process_buffer(Spatializer* sp, float* left, float* right, int num_frames) {
        if (sp) {
            sp->process(left, right, num_frames);
        }
    }
}

