/*****************************************************************************
 * equalizer.cpp: Core DSP for gain and 10-band parametric equalization
 *****************************************************************************
 * Copyright (C) 2024 Benny Perumalla
 *
 * Author: Benny Perumalla <benny01r@gmail.com>
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 ******************************************************************************/

#include <algorithm>
#include <cmath>

namespace {

constexpr float kPi = 3.14159265358979323846f;
constexpr int kBandCount = 10;

class BiquadFilter {
public:
    float b0 = 1.0f;
    float b1 = 0.0f;
    float b2 = 0.0f;
    float a1 = 0.0f;
    float a2 = 0.0f;
    float z1 = 0.0f;
    float z2 = 0.0f;

    float process(float input) {
        const float output = input * b0 + z1;
        z1 = input * b1 - a1 * output + z2;
        z2 = input * b2 - a2 * output;
        return output;
    }

    void setPeaking(float sampleRate, float frequency, float gainDb, float q) {
        const float amplitude = std::pow(10.0f, gainDb / 40.0f);
        const float omega = 2.0f * kPi * frequency / sampleRate;
        const float alpha = std::sin(omega) / (2.0f * q);
        const float cosine = std::cos(omega);
        const float denominator = 1.0f + alpha / amplitude;

        b0 = (1.0f + alpha * amplitude) / denominator;
        b1 = (-2.0f * cosine) / denominator;
        b2 = (1.0f - alpha * amplitude) / denominator;
        a1 = (-2.0f * cosine) / denominator;
        a2 = (1.0f - alpha / amplitude) / denominator;
    }
};

class Equalizer {
public:
    explicit Equalizer(float sampleRate)
        : sampleRate_(sampleRate),
          gainSmoothing_(std::exp(-1.0f / (0.01f * sampleRate))) {}

    void setVolumePercent(float percent) {
        if (!std::isfinite(percent)) {
            return;
        }
        targetGain_ = std::clamp(percent, 0.0f, 400.0f) / 100.0f;
    }

    void setBand(int bandIndex, float frequency, float gainDb, float q) {
        if (bandIndex < 0 || bandIndex >= kBandCount || !std::isfinite(frequency)
            || !std::isfinite(gainDb) || !std::isfinite(q) || q <= 0.0f) {
            return;
        }

        const float nyquist = sampleRate_ * 0.5f;
        if (frequency <= 0.0f || frequency >= nyquist) {
            return;
        }

        const float clampedGain = std::clamp(gainDb, -24.0f, 24.0f);
        leftBands_[bandIndex].setPeaking(sampleRate_, frequency, clampedGain, q);
        rightBands_[bandIndex].setPeaking(sampleRate_, frequency, clampedGain, q);
    }

    void process(float* left, float* right, int frameCount) {
        if (!left || !right || frameCount <= 0) {
            return;
        }

        for (int frame = 0; frame < frameCount; ++frame) {
            currentGain_ = targetGain_ + gainSmoothing_ * (currentGain_ - targetGain_);

            float leftSample = left[frame];
            float rightSample = right[frame];
            for (int band = 0; band < kBandCount; ++band) {
                leftSample = leftBands_[band].process(leftSample);
                rightSample = rightBands_[band].process(rightSample);
            }

            left[frame] = std::clamp(leftSample * currentGain_, -1.0f, 1.0f);
            right[frame] = std::clamp(rightSample * currentGain_, -1.0f, 1.0f);
        }
    }

private:
    float sampleRate_;
    float currentGain_ = 1.0f;
    float targetGain_ = 1.0f;
    float gainSmoothing_;
    BiquadFilter leftBands_[kBandCount];
    BiquadFilter rightBands_[kBandCount];
};

}  // namespace

extern "C" {

Equalizer* create_equalizer(float sampleRate) {
    return new Equalizer(sampleRate);
}

void destroy_equalizer(Equalizer* equalizer) {
    delete equalizer;
}

void set_volume_percent(Equalizer* equalizer, float percent) {
    if (equalizer) {
        equalizer->setVolumePercent(percent);
    }
}

void set_band(Equalizer* equalizer, int bandIndex, float frequency, float gainDb, float q) {
    if (equalizer) {
        equalizer->setBand(bandIndex, frequency, gainDb, q);
    }
}

void process_buffer(Equalizer* equalizer, float* left, float* right, int frameCount) {
    if (equalizer) {
        equalizer->process(left, right, frameCount);
    }
}

}
