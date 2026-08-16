import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Headphones,
  Library,
  LoaderCircle,
  Music2,
  PanelTopClose,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { audioService } from "@/lib/audioService";
import FREQUENCY_BANDS from "@/constants/frequencyBands";
import EQ_PRESETS, { EQPreset } from "@/constants/eq_presets";
import { EqualizerBand } from "./EqualizerBand";
import { LuaPresetManager } from "./LuaPresetManager";
import { VolumeControl } from "./VolumeControl";

interface AudioEqualizerProps {
  className?: string;
}

const BAND_COLORS = [
  "#3f7df4",
  "#4d7df2",
  "#6179ef",
  "#7374ed",
  "#8670e9",
  "#996be4",
  "#ad66dc",
  "#c262d2",
  "#d760c2",
  "#e765b1",
];

export const AudioEqualizer: React.FC<AudioEqualizerProps> = ({
  className,
}) => {
  const [eqValues, setEqValues] = useState<number[]>(new Array(10).fill(0));
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(60);
  const [isMuted, setIsMuted] = useState(false);
  const [activePreset, setActivePreset] = useState("Flat");
  const [isAudioInitialized, setIsAudioInitialized] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const [activeView, setActiveView] = useState<"equalizer" | "library">(
    "equalizer",
  );

  const isAudioAvailable = audioService.isAvailable();

  const handleBandChange = useCallback(
    async (index: number, value: number) => {
      setEqValues((previous) => {
        const next = [...previous];
        next[index] = value;
        return next;
      });
      setActivePreset("Custom");

      if (audioService.isAvailable() && isAudioInitialized) {
        await audioService.updateEQBand(index, value);
      }
    },
    [isAudioInitialized],
  );

  const handlePresetSelect = useCallback(
    async (preset: EQPreset) => {
      setEqValues([...preset.values]);
      setActivePreset(preset.name);
      setShowPresetDropdown(false);

      if (audioService.isAvailable() && isAudioInitialized) {
        await audioService.updateEQPreset(preset);
      }
    },
    [isAudioInitialized],
  );

  const handleReset = useCallback(async () => {
    const resetValues = new Array(10).fill(0);
    setEqValues(resetValues);
    setActivePreset("Flat");

    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateEQPreset({ name: "Flat", values: resetValues });
    }
  }, [isAudioInitialized]);

  const handleVolumeChange = useCallback(
    async (newVolume: number) => {
      setVolume(newVolume);
      if (newVolume > 0 && isMuted) setIsMuted(false);

      if (audioService.isAvailable() && isAudioInitialized) {
        await audioService.updateVolume(newVolume);
      }
    },
    [isAudioInitialized, isMuted],
  );

  const handleToggleMute = useCallback(async () => {
    const nextMutedState = !isMuted;
    setIsMuted(nextMutedState);

    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateMute(nextMutedState, volume);
    }
  }, [isAudioInitialized, isMuted, volume]);

  const handlePlayPause = useCallback(async () => {
    if (!audioService.isAvailable()) return;
    await audioService.controlPlayback("toggle");
    setIsPlaying((previous) => !previous);
  }, []);

  const handleToggleAudioConnection = useCallback(async () => {
    if (!audioService.isAvailable()) return;

    setConnectionError("");

    if (isAudioInitialized) {
      await audioService.stopCapture();
      setIsAudioInitialized(false);
      setIsPlaying(false);
      return;
    }

    setIsConnecting(true);
    try {
      const success = await audioService.startCapture();
      setIsAudioInitialized(success);

      if (!success) {
        setConnectionError("Open a regular tab with audio, then try again.");
        return;
      }

      const info = await audioService.getMediaInfo();
      if (info) setIsPlaying(Boolean(info.isPlaying));
    } catch {
      setIsAudioInitialized(false);
      setConnectionError("Audio connection failed. Try another tab.");
    } finally {
      setIsConnecting(false);
    }
  }, [isAudioInitialized]);

  useEffect(() => {
    const listener = (request: any, sender: any) => {
      if (!request || request.action !== "media_state_update") return;

      const capturedId = audioService.getCapturedTabId();
      const senderId = sender?.tab?.id ?? null;
      if (capturedId && senderId && capturedId !== senderId) return;

      if (typeof request.isPlaying === "boolean") {
        setIsPlaying(request.isPlaying);
      }
    };

    if (audioService.isAvailable()) {
      chrome.runtime.onMessage.addListener(listener);
    }

    return () => {
      if (audioService.isAvailable()) {
        chrome.runtime.onMessage.removeListener?.(listener);
      }
    };
  }, []);

  useEffect(() => {
    const checkStatus = async () => {
      if (!audioService.isAvailable()) return;

      const status = await audioService.checkConnection();
      if (!status?.isInitialized) return;

      setIsAudioInitialized(true);
      if (typeof status.volume === "number") setVolume(status.volume);
      if (Array.isArray(status.eqValues)) setEqValues(status.eqValues);
      if (status.preset) setActivePreset(status.preset);

      const info = await audioService.getMediaInfo();
      if (info) setIsPlaying(Boolean(info.isPlaying));
    };

    void checkStatus();
  }, []);

  useEffect(() => {
    if (!audioService.isAvailable() || !isAudioInitialized) return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      const info = await audioService.getMediaInfo();
      if (!cancelled && info) setIsPlaying(Boolean(info.isPlaying));
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isAudioInitialized]);

  useEffect(() => {
    if (!showPresetDropdown) return;

    const closeDropdown = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest("[data-preset-dropdown]")) {
        setShowPresetDropdown(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowPresetDropdown(false);
    };

    document.addEventListener("mousedown", closeDropdown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeDropdown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showPresetDropdown]);

  const statusLabel = isConnecting
    ? "Connecting"
    : connectionError
      ? "Connection issue"
      : isAudioInitialized
        ? "Audio connected"
        : isAudioAvailable
          ? "Ready to connect"
          : "Preview mode";

  return (
    <div
      className={cn("audio-shell overflow-hidden p-4 sm:p-5 md:p-7", className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-4 px-1 pb-5 sm:px-2 sm:pb-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[15px] bg-white shadow-[0_7px_18px_rgba(68,82,110,0.1)]">
            <div className="signal-fill absolute inset-[8px] rounded-[9px] opacity-15" />
            <Headphones
              className="relative text-[#5e68d9]"
              size={22}
              strokeWidth={1.8}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "h-2.5 w-2.5 flex-shrink-0 rounded-full",
                  connectionError
                    ? "bg-[#dc586b]"
                    : isAudioInitialized
                      ? "bg-[#42bd78] shadow-[0_0_0_4px_rgba(66,189,120,0.12)]"
                      : "bg-[#aeb6c5]",
                )}
              />
              <h1 className="truncate text-[22px] font-semibold leading-tight text-[#1f232d] sm:text-[24px]">
                Super Dribble
              </h1>
            </div>
            <p className="mt-0.5 text-[13px] text-[#828999]">
              Sound equalizer · {statusLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleAudioConnection}
            disabled={isConnecting || !isAudioAvailable}
            aria-label={
              isAudioInitialized ? "Disconnect audio" : "Connect audio"
            }
            aria-pressed={isAudioInitialized}
            title={isAudioInitialized ? "Disconnect audio" : "Connect audio"}
            className={cn(
              "soft-control icon-control",
              isAudioInitialized
                ? "text-[#36af6c] hover:text-[#d84f65]"
                : "hover:text-[#3f7df4]",
            )}
          >
            {isConnecting ? (
              <LoaderCircle className="animate-spin" size={20} />
            ) : isAudioInitialized ? (
              <Wifi size={20} strokeWidth={1.9} />
            ) : (
              <WifiOff size={20} strokeWidth={1.9} />
            )}
          </button>
          <button
            type="button"
            onClick={() => window.close()}
            aria-label="Close extension popup"
            title="Close"
            className="soft-control icon-control hover:text-[#3f7df4]"
          >
            <PanelTopClose size={20} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveView((view) =>
                view === "equalizer" ? "library" : "equalizer",
              )
            }
            aria-label={
              activeView === "equalizer"
                ? "Open preset library"
                : "Return to equalizer"
            }
            aria-pressed={activeView === "library"}
            title={
              activeView === "equalizer"
                ? "Preset library"
                : "Return to equalizer"
            }
            className={cn(
              "soft-control icon-control hover:text-[#805ee6]",
              activeView === "library" &&
                "border-[#b4a7ee] bg-[#f4f1ff] text-[#7658dc]",
            )}
          >
            <Settings size={20} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {connectionError && (
        <div
          className="mb-4 rounded-[14px] border border-[#efc5cc] bg-[#fff7f8] px-4 py-3 text-[13px] text-[#a83d4e]"
          role="alert"
        >
          {connectionError}
        </div>
      )}

      {activeView === "library" ? (
        <section aria-labelledby="library-title">
          <div className="surface-panel mb-4 flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setActiveView("equalizer")}
              aria-label="Return to equalizer"
              className="soft-control flex h-9 w-9 items-center justify-center rounded-[11px] text-[#687084] hover:text-[#3f7df4]"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h2
                id="library-title"
                className="text-[15px] font-semibold text-[#282d38]"
              >
                Preset library
              </h2>
              <p className="text-[12px] text-[#858c9c]">
                Lua equalizer and spatial audio profiles
              </p>
            </div>
          </div>
          <LuaPresetManager />
        </section>
      ) : (
        <div className="space-y-4">
          <VolumeControl
            volume={volume}
            isMuted={isMuted}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleMute}
          />

          <div className="flex flex-wrap items-center gap-2.5 px-1 py-1">
            <div className="relative min-w-[148px]" data-preset-dropdown>
              <button
                type="button"
                onClick={() => setShowPresetDropdown((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={showPresetDropdown}
                className="soft-control flex h-11 w-full items-center gap-2.5 rounded-[14px] px-3.5 text-left text-[13px] font-semibold text-[#343a47]"
              >
                <Music2 size={17} className="text-[#6f69df]" />
                <span className="min-w-0 flex-1 truncate">{activePreset}</span>
                <ChevronDown
                  size={15}
                  className={cn(
                    "text-[#858c9c] transition-transform duration-200",
                    showPresetDropdown && "rotate-180",
                  )}
                />
              </button>

              {showPresetDropdown && (
                <div
                  role="listbox"
                  aria-label="Equalizer presets"
                  className="absolute left-0 top-full z-50 mt-2 w-[200px] overflow-hidden rounded-[16px] border border-[#dfe4ec] bg-white/95 p-1.5 shadow-[0_18px_38px_rgba(65,78,105,0.16)] backdrop-blur-xl"
                >
                  {EQ_PRESETS.map((preset) => {
                    const selected = activePreset === preset.name;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        key={preset.name}
                        onClick={() => handlePresetSelect(preset)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-[11px] px-3 py-2 text-left text-[13px] transition-colors duration-150",
                          selected
                            ? "bg-[#f0efff] font-semibold text-[#6753ce]"
                            : "text-[#505767] hover:bg-[#f5f7fb]",
                        )}
                      >
                        {preset.name}
                        {selected && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handlePlayPause}
              disabled={!isAudioInitialized}
              aria-label={isPlaying ? "Pause playback" : "Play playback"}
              className={cn(
                "soft-control flex h-11 w-11 items-center justify-center rounded-[14px]",
                isAudioInitialized
                  ? "border-[#d9d7fb] bg-[#f2f0ff] text-[#7259dc] hover:text-[#5f47ca]"
                  : "text-[#9ba2b1]",
              )}
            >
              {isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" />
              )}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="soft-control flex h-11 items-center gap-2 rounded-[14px] px-3.5 text-[13px] font-semibold text-[#687084] hover:text-[#3f7df4]"
            >
              <RotateCcw size={16} />
              Reset
            </button>

            <button
              type="button"
              onClick={() => setActiveView("library")}
              className="soft-control ml-auto hidden h-11 items-center gap-2 rounded-[14px] px-3.5 text-[13px] font-semibold text-[#687084] hover:text-[#805ee6] sm:flex"
            >
              <Library size={16} />
              <span>More presets</span>
            </button>
          </div>

          <section
            className="surface-panel overflow-hidden"
            aria-labelledby="equalizer-title"
          >
            <div className="flex items-end justify-between gap-4 border-b border-[#e8ebf1] px-5 py-4 sm:px-6">
              <div>
                <h2
                  id="equalizer-title"
                  className="text-[15px] font-semibold text-[#282d38]"
                >
                  10-band equalizer
                </h2>
                <p className="mt-0.5 text-[12px] text-[#8a91a0]">
                  Shape the current tab from low bass to high detail
                </p>
              </div>
              <span className="data-type flex-shrink-0 text-[11px] text-[#9198a6]">
                -12 · +12 dB
              </span>
            </div>

            <div className="eq-scroll overflow-x-auto px-3 pb-4 pt-5 sm:px-5">
              <div className="mx-auto flex w-max min-w-full items-start justify-around gap-1 px-1 pb-1">
                {FREQUENCY_BANDS.map((frequency, index) => (
                  <EqualizerBand
                    key={frequency}
                    frequency={frequency}
                    value={eqValues[index]}
                    color={BAND_COLORS[index]}
                    onChange={(value) => handleBandChange(index, value)}
                    isActive={isPlaying && eqValues[index] !== 0}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
