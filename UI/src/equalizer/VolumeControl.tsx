import React, { useEffect, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [temporaryVolume, setTemporaryVolume] = useState(volume);
  const isDragging = useRef(false);
  const displayedVolume = isMuted ? 0 : temporaryVolume;
  const VolumeIcon =
    isMuted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  useEffect(() => {
    if (!isDragging.current) setTemporaryVolume(volume);
  }, [volume]);

  const commitPointerValue = (event: React.PointerEvent<HTMLInputElement>) => {
    isDragging.current = false;
    const nextVolume = Number(event.currentTarget.value);
    setTemporaryVolume(nextVolume);
    onVolumeChange(nextVolume);
  };

  return (
    <section
      className={cn(
        "surface-panel flex min-h-[88px] items-center gap-4 px-5 py-4 sm:gap-5 sm:px-6",
        className,
      )}
      aria-label="Output volume"
    >
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={isMuted ? "Unmute audio" : "Mute audio"}
        aria-pressed={isMuted}
        className={cn(
          "soft-control flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px]",
          isMuted ? "text-[#d84f65]" : "text-[#687084] hover:text-[#3f7df4]",
        )}
      >
        <VolumeIcon size={22} strokeWidth={1.8} />
      </button>

      <div className="relative flex h-8 min-w-0 flex-1 items-center">
        <div className="absolute left-0 right-0 h-[10px] rounded-full bg-[#e8ecf3] shadow-inner" />
        <div
          className="signal-fill absolute left-0 h-[10px] rounded-full transition-[width,opacity] duration-150"
          style={{
            width: `${displayedVolume}%`,
            opacity: isMuted ? 0.35 : 1,
          }}
        />
        <input
          type="range"
          aria-label="Volume"
          aria-valuetext={`${displayedVolume} percent`}
          min="0"
          max="100"
          step="1"
          value={displayedVolume}
          onChange={(event) => {
            const nextVolume = Number(event.target.value);
            setTemporaryVolume(nextVolume);
            if (!isDragging.current) onVolumeChange(nextVolume);
          }}
          onPointerDown={() => {
            isDragging.current = true;
          }}
          onPointerUp={commitPointerValue}
          onPointerCancel={commitPointerValue}
          className="volume-range absolute inset-0 z-[2] h-full w-full"
        />
      </div>

      <output className="data-type w-[54px] text-right text-[14px] font-semibold text-[#262b36]">
        {displayedVolume}%
      </output>
    </section>
  );
};
