import React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface EqualizerBandProps {
  frequency: string;
  value: number;
  onChange: (value: number) => void;
  color: string;
  isActive?: boolean;
  className?: string;
}

export const EqualizerBand: React.FC<EqualizerBandProps> = ({
  frequency,
  value,
  onChange,
  color,
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
        "flex w-[60px] flex-shrink-0 flex-col items-center",
        className,
      )}
      style={{ "--band-color": color } as React.CSSProperties}
    >
      <span className="mb-3 text-[12px] font-semibold text-[#4e5669]">
        {frequency}
      </span>

      <button
        type="button"
        onClick={() => adjustValue(0.5)}
        disabled={value >= 12}
        aria-label={`Increase ${frequency} gain`}
        className="soft-control flex h-8 w-8 items-center justify-center rounded-[10px] text-[#71798a] hover:text-[#3f7df4] disabled:opacity-35"
      >
        <Plus size={14} strokeWidth={2} />
      </button>

      <div className="relative my-3 h-[228px] w-11">
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
          className="pointer-events-none absolute left-1/2 z-[3] h-[22px] w-[38px] -translate-x-1/2 translate-y-1/2 rounded-[8px] border border-white/90 bg-white shadow-[0_5px_12px_rgba(58,69,92,0.18)] transition-[bottom,box-shadow,transform] duration-150"
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
        className="soft-control flex h-8 w-8 items-center justify-center rounded-[10px] text-[#71798a] hover:text-[#3f7df4] disabled:opacity-35"
      >
        <Minus size={14} strokeWidth={2} />
      </button>

      <output
        className="data-type mt-3 text-[12px] font-semibold"
        style={{ color }}
        aria-live="polite"
      >
        {displayValue} dB
      </output>
    </div>
  );
};
