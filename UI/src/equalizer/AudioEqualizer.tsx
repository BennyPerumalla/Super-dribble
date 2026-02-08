import React, { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { EqualizerBand } from "./EqualizerBand";
import { VolumeControl } from "./VolumeControl";
import { LuaPresetManager } from "@/equalizer/LuaPresetManager";
import { Settings, Play, Pause, ChevronDown, Wifi, WifiOff, PanelTopClose } from "lucide-react";
import { audioService } from "@/lib/audioService";
import FREQUENCY_BANDS from "@/constants/frequencyBands";
import EQ_PRESETS, { EQPreset } from "@/constants/eq_presets";


interface AudioEqualizerProps {
  className?: string;
}

export const AudioEqualizer: React.FC<AudioEqualizerProps> = ({
  className,
}) => {
  const [eqValues, setEqValues] = useState<number[]>(new Array(10).fill(0));
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(60);
  const [isMuted, setIsMuted] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("Flat");
  const [isPowerOn, setIsPowerOn] = useState(true);
  const [isAudioInitialized, setIsAudioInitialized] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);

  const handleBandChange = useCallback(async (index: number, value: number) => {
    setEqValues((prev) => {
      const newValues = [...prev];
      newValues[index] = value;
      return newValues;
    });
    setActivePreset("Custom");

    // Update audio processing if available
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateEQBand(index, value);
    }
  }, [isAudioInitialized]);

  const handlePresetSelect = useCallback(async (preset: EQPreset) => {
    setEqValues([...preset.values]);
    setActivePreset(preset.name);
    setShowPresetDropdown(false);

    // Update audio processing if available
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateEQPreset(preset);
    }
  }, [isAudioInitialized]);

  const handleReset = useCallback(async () => {
    const resetValues = new Array(10).fill(0);
    setEqValues([...resetValues]);
    setActivePreset("Flat");

    // Update audio processing if available
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateEQPreset({ name: 'Flat', values: resetValues });
    }
  }, [isAudioInitialized]);

  const handleVolumeChange = useCallback(
    async (newVolume: number) => {
      setVolume(newVolume);
      if (newVolume > 0 && isMuted) {
        setIsMuted(false);
      }

      // Update audio processing if available
      if (audioService.isAvailable() && isAudioInitialized) {
        await audioService.updateVolume(newVolume);
      }
    },
    [isMuted, isAudioInitialized],
  );

  const handleToggleMute = useCallback(async () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);

    // Update audio processing if available
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateMute(newMutedState, volume);
    }
  }, [isMuted, volume, isAudioInitialized]);

  const handlePlayPause = useCallback(async () => {
    if (audioService.isAvailable()) {
      await audioService.controlPlayback('toggle');
      setIsPlaying(prev => !prev); // Optimistic update
    }
  }, []);

  // Audio connection/disconnection handler
  const handleToggleAudioConnection = useCallback(async () => {
    if (!audioService.isAvailable()) return;

    if (isAudioInitialized) {
      // Disconnect
      await audioService.stopCapture();
      setIsAudioInitialized(false);
    } else {
      // Connect
      setIsConnecting(true);
      try {
        const success = await audioService.startCapture();
        setIsAudioInitialized(success);

        if (success) {
          // Fetch initial media info from the page
          const info = await audioService.getMediaInfo();
          if (info) {
            setIsPlaying(!!info.isPlaying);
          }
        }
      } catch (error) {
        setIsAudioInitialized(false);
      } finally {
        setIsConnecting(false);
      }
    }
  }, [isAudioInitialized]);

  // Listen for media updates from the content script
  useEffect(() => {
    const listener = (request: any, sender: any) => {
      if (request && request.action === 'media_state_update') {
        const capturedId = audioService.getCapturedTabId();
        const senderId = sender?.tab?.id ?? null;
        // Accept updates if we don't know the tab yet, or if it matches.
        if (capturedId && senderId && capturedId !== senderId) return;

        // Update playback state
        if (typeof request.isPlaying === 'boolean') setIsPlaying(request.isPlaying);
      }
    };

    if (audioService.isAvailable()) {
      chrome.runtime.onMessage.addListener(listener);
    }
    return () => {
      try {
        if (audioService.isAvailable()) {
          // @ts-ignore
          chrome.runtime.onMessage.removeListener?.(listener);
        }
      } catch { }
    };
  }, []);

  // Check initial connection status on mount
  useEffect(() => {
      const checkStatus = async () => {
          if (audioService.isAvailable()) {
              const status = await audioService.checkConnection();
              if (status && status.isInitialized) {
                  setIsAudioInitialized(true);
                  
                  // Restore State
                  if (typeof status.volume === 'number') setVolume(status.volume);
                  if (status.eqValues && Array.isArray(status.eqValues)) setEqValues(status.eqValues);
                  if (status.preset) setActivePreset(status.preset);

                  const info = await audioService.getMediaInfo();
                  if (info) setIsPlaying(!!info.isPlaying);
              }
          }
      };
      checkStatus();
  }, []);

  // Periodic polling fallback in case events are missed
  useEffect(() => {
    if (!audioService.isAvailable()) return;
    if (!isAudioInitialized) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const info = await audioService.getMediaInfo();
        if (cancelled || !info) return;
        setIsPlaying(!!info.isPlaying);
      } catch { }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAudioInitialized]);

  // Click outside handler for preset dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('[data-preset-dropdown]')) {
        setShowPresetDropdown(false);
      }
    };

    if (showPresetDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPresetDropdown]);

if (!isPowerOn) {
    return (
      <div
        className={cn(
          "w-full p-6 rounded-2xl",
          "bg-eq-background border border-eq-border",
          "flex flex-col items-center min-h-[500px] relative overflow-hidden",
          className,
        )}
      >
        {/* Header */}
        <div className="w-full flex justify-center mb-8 z-10">
          <h2 className="text-lg font-medium text-eq-text tracking-wide">Lua Presets</h2>
        </div>

        {/* Central Content Area */}
        <div className="flex-1 w-full flex flex-col items-center justify-center gap-8 z-10">
          
          {/* Settings/Return Hub Button */}
          <div className="relative group">
            <div className="absolute inset-0 bg-eq-accent/10 rounded-full blur-xl group-hover:bg-eq-accent/20 transition-all duration-500" />
            <button
              onClick={() => setIsPowerOn(true)}
              className={cn(
                "relative z-10 p-8 rounded-full bg-eq-surface border border-eq-border",
                "text-eq-text-dim hover:text-eq-accent transition-all duration-300",
                "hover:bg-eq-surface-light hover:scale-105 hover:border-eq-accent/30",
                "shadow-2xl flex items-center justify-center"
              )}
              title="Return to Equalizer"
            >
              <Settings size={32} className="transition-transform duration-700 group-hover:rotate-90" />
            </button>
          </div>

          {/* Lua Preset Manager */}
          <div className="w-full max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
            <LuaPresetManager />
          </div>
        </div>

        {/* Decorative Background Elements */}
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-eq-surface-light/5 via-transparent to-transparent pointer-events-none" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full p-4 rounded-2xl",
        "bg-gradient-to-br from-eq-background via-eq-surface to-eq-background",
        "border border-eq-border shadow-2xl",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 bg-eq-accent rounded-full animate-eq-pulse" />
          <h1 className="text-xl font-bold text-eq-text eq-text-glow">
            Super Dribble
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Audio Connect/Disconnect Button */}
          <button
            onClick={handleToggleAudioConnection}
            disabled={isConnecting}
            className={cn(
              "p-2 rounded-lg transition-all duration-200",
              isAudioInitialized
                ? "text-green-400 hover:text-red-400 hover:bg-eq-surface-light"
                : "text-eq-text-dim hover:text-green-400 hover:bg-eq-surface-light",
              isConnecting && "opacity-50 cursor-not-allowed"
            )}
            title={isAudioInitialized ? "Disconnect Audio" : "Connect Audio"}
          >
            {isAudioInitialized ? <Wifi size={20} /> : <WifiOff size={20} />}
          </button>

          {/* Close Button */}
          <button
            onClick={() => window.close()}
            className={cn(
              "p-2 rounded-lg text-eq-text-dim hover:text-eq-accent",
              "hover:bg-eq-surface-light transition-all duration-200",
            )}
            title="Close extension popup"
          >
            <PanelTopClose size={20} />
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setIsPowerOn(false)}
            className={cn(
              "p-2 rounded-lg text-eq-text-dim hover:text-eq-danger",
              "hover:bg-eq-surface-light transition-all duration-200",
            )}
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="space-y-4">
        {/* Volume Control */}
        <div className="px-2">
          <VolumeControl
            volume={volume}
            isMuted={isMuted}
            onVolumeChange={handleVolumeChange}
            onToggleMute={handleToggleMute}
          />
        </div>

        {/* Presets and Playback Controls */}
        <div className="flex items-center gap-3 px-2">
          {/* Preset Dropdown */}
          <div className="relative" data-preset-dropdown>
            <button
              onClick={() => setShowPresetDropdown(!showPresetDropdown)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg",
                "bg-eq-surface border border-eq-border",
                "text-eq-text text-sm hover:bg-eq-surface-light",
                "transition-all duration-200"
              )}
            >
              <span>{activePreset}</span>
              <ChevronDown size={14} className={cn(
                "transition-transform duration-200",
                showPresetDropdown && "rotate-180"
              )} />
            </button>

            {showPresetDropdown && (
              <div className={cn(
                "absolute top-full left-0 mt-1 min-w-[120px] z-50",
                "bg-eq-surface border border-eq-border rounded-lg shadow-lg",
                "py-1"
              )}>
                {EQ_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => handlePresetSelect(preset)}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-xs",
                      "text-eq-text hover:bg-eq-surface-light",
                      "transition-colors duration-150",
                      activePreset === preset.name && "bg-eq-accent text-eq-background"
                    )}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Play/Pause Button */}
          <button
            onClick={handlePlayPause}
            disabled={!isAudioInitialized}
            className={cn(
              "p-1.5 rounded-lg transition-all duration-200",
              isAudioInitialized
                ? "bg-eq-accent text-eq-background hover:bg-eq-accent-glow hover:scale-105"
                : "bg-eq-surface-light text-eq-text-dim cursor-not-allowed",
            )}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          {/* Reset Button */}
          <button
            onClick={handleReset}
            className={cn(
              "px-3 py-1.5 text-xs rounded-lg",
              "bg-eq-surface border border-eq-border",
              "text-eq-text-dim hover:text-eq-text hover:bg-eq-surface-light",
              "transition-all duration-200"
            )}
          >
            Reset
          </button>
        </div>

        {/* EQ Bands */}
        <div
          className={cn(
            "p-2 rounded-xl bg-gradient-to-r from-eq-surface to-eq-surface-light",
          )}
        >
          <div className="flex justify-between items-start gap-1 pb-2">
            {FREQUENCY_BANDS.map((frequency, index) => (
              <EqualizerBand
                key={`${frequency}-${index}`}
                frequency={frequency}
                value={eqValues[index]}
                onChange={(value) => handleBandChange(index, value)}
                isActive={isPlaying && eqValues[index] !== 0}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};