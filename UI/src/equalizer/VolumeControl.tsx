import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { VolumeX, Volume1, Volume2 } from "lucide-react";

interface VolumeControlProps {
  volume: number;
  isMuted: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  className?: string;
}

export const VolumeControl: React.FC<VolumeControlProps> = ({
  volume,
  isMuted,
  onVolumeChange,
  onToggleMute,
  className,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [tempVolume, setTempVolume] = useState(volume);

  const getVolumeIcon = () => {
    if (isMuted || volume === 0) return VolumeX;
    if (volume < 50) return Volume1;
    return Volume2;
  };
  const VolumeIcon = getVolumeIcon();

  return (
    <div
      className={cn(
        "flex items-center gap-4 p-4 rounded-xl",
        "border border-eq-border",
        className,
      )}
    >
      {/* Mute Button */}
      <button
        onClick={onToggleMute}
        aria-label={isMuted ? "Unmute audio" : "Mute audio"}
        className={cn(
          "p-2 rounded-lg transition-all duration-150 ease-out",
          "hover:bg-eq-surface-light hover:scale-105",
          {
            "text-eq-danger": isMuted,
            "text-eq-text hover:text-eq-accent": !isMuted,
          },
        )}
      >
        <VolumeIcon size={20} />
      </button>

      {/* Volume Slider Container */}
      <div className="relative flex-1 h-6 flex items-center">
        {/* Background Track */}
        <div className="absolute inset-y-0 left-0 right-0 h-2 bg-eq-slider-track rounded-full my-auto" />

        {/* Active Fill */}
        <div
          className={cn(
            "absolute h-2 rounded-full transition-[width] duration-100 ease-out",
            {
              "bg-gradient-to-r from-eq-volume to-eq-accent-glow": !isMuted,
              "bg-eq-danger": isMuted,
            },
          )}
          style={{
            width: `${isMuted ? 0 : (isDragging ? tempVolume : volume)}%`,
            boxShadow: !isMuted
              ? `0 0 8px hsla(var(--eq-volume), 0.4)`
              : "none",
          }}
        />

        {/* Slider Input */}
        <input
          type="range"
          aria-label="Volume"
          min="0"
          max="100"
          step="1"
          value={isMuted ? 0 : (isDragging ? tempVolume : volume)}
          onInput={(e) =>
            setTempVolume(parseInt((e.target as HTMLInputElement).value))
          }
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={(e) => {
            setIsDragging(false);
            onVolumeChange(parseInt((e.target as HTMLInputElement).value));
          }}
          className={cn(
            "absolute inset-0 w-full h-full opacity-0 cursor-pointer",
            "focus:outline-none",
          )}
        />

        {/* Thumb Indicator */}
        <div
          className={cn(
            "absolute w-5 h-5 rounded-full border-2 border-eq-background",
            "transition-colors duration-150 ease-out pointer-events-none",
            {
              "bg-eq-volume shadow-lg shadow-eq-volume/50 scale-110":
                !isMuted && (isDragging || volume > 0),
              "bg-eq-danger shadow-lg shadow-eq-danger/50": isMuted,
              "bg-eq-text-dim": !isMuted && volume === 0,
            },
          )}
          style={{
            left: `${isMuted ? 0 : (isDragging ? tempVolume : volume)}%`,
            transform: "translateX(-50%)",
            top: "50%",
            marginTop: "-10px",
          }}
        />
      </div>

      {/* Volume Percentage */}
      <div className="text-sm font-mono text-eq-text-dim w-12 text-right">
        {isMuted ? "0%" : `${isDragging ? tempVolume : volume}%`}
      </div>
    </div>
  );
};
