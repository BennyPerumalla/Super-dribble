import React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface EqualizerBandProps {
  frequency: string;
  value: number;
  onChange: (value: number) => void;
  color: string;
  visualizationRef?: (node: HTMLDivElement | null) => void;
  isActive?: boolean;
  className?: string;
}

export const EqualizerBand: React.FC<EqualizerBandProps> = ({
  frequency,
  value,
  onChange,
  color,
  visualizationRef,
  isActive = false,
  className,
}) => {
  const percentage = ((value + 12) / 24) * 100;
  const displayValue = `${value > 0 ? "+" : ""}${value.toFixed(1)}`;

  const adjustValue = (amount: number) => {
    onChange(Math.max(-12, Math.min(12, value + amount)));
  };

  return (
    <div
      className={cn(
        "eq-band flex min-w-0 flex-col items-center",
        className,
      )}
      style={{ "--band-color": color } as React.CSSProperties}
    >
      <span className="eq-frequency-label mb-3 whitespace-nowrap text-[12px] font-semibold text-[#4e5669]">
        {frequency}
      </span>

      <button
        type="button"
        onClick={() => adjustValue(0.5)}
        disabled={value >= 12}
        aria-label={`Increase ${frequency} gain`}
        className="soft-control eq-step-control flex items-center justify-center rounded-[9px] text-[#71798a] hover:text-[#3f7df4] disabled:opacity-35"
      >
        <Plus size={14} strokeWidth={2} />
      </button>

      <div className="eq-band-track relative my-3 h-[228px]">
        <div
          ref={visualizationRef}
          className="eq-energy-layer pointer-events-none absolute bottom-0 left-1/2 z-[1] h-full w-[14px] -translate-x-1/2 overflow-hidden rounded-full"
          aria-hidden="true"
        >
          <div className="eq-energy-fill absolute inset-x-0 bottom-0 rounded-full" />
          <div className="eq-energy-peak absolute inset-x-[2px] h-px rounded-full" />
        </div>

        <div className="absolute bottom-0 left-1/2 h-full w-[6px] -translate-x-1/2 overflow-hidden rounded-full bg-[#e9edf4] shadow-inner">
          <div
            className="absolute bottom-0 left-0 w-full rounded-full transition-[height] duration-150 ease-out"
            style={{
              height: `${percentage}%`,
              background: color,
              opacity: isActive ? 1 : 0.88,
            }}
          />
        </div>

        <div className="absolute left-[7px] right-[7px] top-1/2 h-px -translate-y-1/2 bg-[#d8dee9]" />

        <div
          className="eq-gain-thumb pointer-events-none absolute left-1/2 z-[3] -translate-x-1/2 translate-y-1/2 rounded-[7px] border border-white/90 bg-white shadow-[0_5px_12px_rgba(58,69,92,0.18)] transition-[bottom,box-shadow,transform] duration-100"
          style={{
            bottom: `${percentage}%`,
            boxShadow: isActive
              ? `0 5px 14px ${color}38, 0 2px 5px rgba(58,69,92,0.12)`
              : undefined,
          }}
        />

        <input
          className="band-range"
          type="range"
          min="-12"
          max="12"
          step="0.5"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={`${frequency} equalizer gain`}
          aria-valuetext={`${displayValue} decibels`}
        />
      </div>

      <button
        type="button"
        onClick={() => adjustValue(-0.5)}
        disabled={value <= -12}
        aria-label={`Decrease ${frequency} gain`}
        className="soft-control eq-step-control flex items-center justify-center rounded-[9px] text-[#71798a] hover:text-[#3f7df4] disabled:opacity-35"
      >
        <Minus size={14} strokeWidth={2} />
      </button>

      <output
        className="eq-gain-output data-type mt-3 text-center text-[12px] font-semibold"
        style={{ color }}
        aria-live="polite"
      >
        <span>{displayValue}</span>
        <span className="eq-db-unit"> dB</span>
      </output>
    </div>
  );
};
