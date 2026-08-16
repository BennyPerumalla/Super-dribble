import React, { useRef, useState } from "react";

// Utility function to merge class names
const cn = (...classes: (string | boolean | undefined | Record<string, boolean>)[]) => {
  return classes
    .map(cls => {
      if (typeof cls === 'object' && cls !== null) {
        return Object.entries(cls)
          .filter(([_, value]) => value)
          .map(([key]) => key)
          .join(' ');
      }
      return cls;
    })
    .filter(Boolean)
    .join(" ");
};

interface EqualizerBandProps {
  frequency: string;
  value: number;
  onChange: (value: number) => void;
  isActive?: boolean;
  className?: string;
}

export const EqualizerBand: React.FC<EqualizerBandProps> = ({
  frequency,
  value,
  onChange,
  isActive = false,
  className,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    updateValue(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      updateValue(e);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const updateValue = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;

    const rect = trackRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const percentage = Math.max(0, Math.min(1, y / rect.height));
    
    // Convert percentage to value range (-12 to +12)
    // Invert because top = +12, bottom = -12
    const newValue = 12 - percentage * 24;
    
    // Round to nearest 0.5
    const roundedValue = Math.round(newValue * 2) / 2;
    const clampedValue = Math.max(-12, Math.min(12, roundedValue));
    
    onChange(clampedValue);
  };

  const handleIncrement = () => {
    const newValue = Math.min(12, value + 0.5);
    onChange(newValue);
  };

  const handleDecrement = () => {
    const newValue = Math.max(-12, value - 0.5);
    onChange(newValue);
  };

  // Calculate fill position and height
  const getFillStyle = () => {
    if (value === 0) return { height: '0px', top: '50%' };
    
    if (value > 0) {
      // Positive values: fill from center (50%) to top
      const heightPercent = (value / 12) * 50; // value/12 gives ratio, *50 for half height
      return {
        height: `${heightPercent}%`,
        top: `${50 - heightPercent}%`,
      };
    } else {
      // Negative values: fill from center (50%) downward
      const heightPercent = (Math.abs(value) / 12) * 50;
      return {
        height: `${heightPercent}%`,
        top: '50%',
      };
    }
  };

  const fillStyle = getFillStyle();

  return (
    <div className={cn("flex flex-col items-center space-y-2 flex-shrink-0 w-14", className)}>
      {/* Frequency Label */}
      <div className="text-xs font-mono text-eq-text-dim font-medium h-4 flex items-center justify-center w-full">
        {frequency}
      </div>

      {/* Plus Button */}
      <button
        onClick={handleIncrement}
        aria-label={`Increase ${frequency} gain`}
        className={cn(
          "w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-all duration-150",
          "bg-eq-slider-track hover:bg-eq-accent/20 text-eq-text-dim hover:text-eq-accent",
          "border border-eq-border/50 hover:border-eq-accent/50 flex-shrink-0"
        )}
      >
        +
      </button>

      {/* Slider Container */}
      <div 
        ref={trackRef}
        className="relative h-48 w-8 flex flex-col items-center cursor-pointer select-none flex-shrink-0"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={(e) => {
          if (isDragging) {
            handlePointerUp(e);
          }
        }}
      >
        {/* Background Track */}
        <div className="absolute inset-0 w-2 bg-eq-slider-track rounded-full mx-auto" />

        {/* Center Line (0dB) */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-eq-border transform -translate-y-0.5 z-10" />

        {/* Active Fill */}
        <div
          className={cn(
            "absolute w-2 rounded-full mx-auto pointer-events-none will-change-transform",
            {
              "bg-gradient-to-t from-eq-accent to-eq-accent-glow":
                value > 0 && isActive,
              "bg-gradient-to-b from-eq-accent to-eq-accent-glow":
                value < 0 && isActive,
              "bg-eq-accent/50": !isActive && value !== 0,
              "bg-transparent": value === 0,
            },
          )}
          style={{
            ...fillStyle,
            boxShadow: isActive && value !== 0
              ? `0 0 10px hsla(var(--eq-accent-glow), 0.6)`
              : "none",
            transition: isDragging ? 'none' : 'all 150ms ease-out',
          }}
        />

        {/* Thumb Indicator */}
        <div
          className={cn(
            "absolute w-6 h-3 bg-eq-slider-thumb rounded-sm border border-eq-background z-20",
            "pointer-events-none will-change-transform",
            {
              "shadow-lg shadow-eq-accent-glow/50 scale-110": isActive || isDragging,
              "shadow-md": !isActive && !isDragging,
            },
          )}
          style={{
            top: `${50 - (value / 12) * 50}%`,
            transform: "translateY(-50%)",
            left: "50%",
            marginLeft: "-12px",
            transition: isDragging ? 'none' : 'all 150ms ease-out',
          }}
        />
      </div>

      {/* Minus Button */}
      <button
        onClick={handleDecrement}
        aria-label={`Decrease ${frequency} gain`}
        className={cn(
          "w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-all duration-150",
          "bg-eq-slider-track hover:bg-eq-accent/20 text-eq-text-dim hover:text-eq-accent",
          "border border-eq-border/50 hover:border-eq-accent/50 flex-shrink-0"
        )}
      >
        −
      </button>

      {/* Value Display */}
      <div
        className={cn(
          "text-xs font-mono font-medium h-4 w-12 text-center flex items-center justify-center",
          {
            "text-eq-accent eq-text-glow": isActive && value !== 0,
            "text-eq-text": !isActive && value !== 0,
            "text-eq-text-dim": value === 0,
          },
        )}
        style={{
          transition: 'color 150ms ease-out',
        }}
      >
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}dB
      </div>
    </div>
  );
};
