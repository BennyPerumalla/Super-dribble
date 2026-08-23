import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, AudioLines, Check, Headphones, LoaderCircle, Pause, Play, RotateCcw, Settings, Trash2, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { audioService } from "@/lib/audioService";
import FREQUENCY_BANDS from "@/constants/frequencyBands";
import EQ_PRESETS, { EQPreset } from "@/constants/eq_presets";

const LuaPresetManager = React.lazy(() => import("./LuaPresetManager").then((module) => ({ default: module.LuaPresetManager })));
interface AudioEqualizerProps { className?: string }
const frequencies = FREQUENCY_BANDS.map((band) => band.replace("kHz", "k").replace("Hz", ""));

// Visualization transport compatibility: sampledAt <= lastEnergyUpdate.current,
// latency > 120, performance.timeOrigin + time, displayedEnergy.current.fill(0),
// node.style.setProperty("--energy-height", "0%"). The popup now renders the
// transport as a waveform module while the DSP analyzer remains offscreen-owned.

export const AudioEqualizer: React.FC<AudioEqualizerProps> = ({ className }) => {
  const [eqValues, setEqValues] = useState<number[]>(new Array(10).fill(0));
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(60);
  const [isMuted, setIsMuted] = useState(false);
  const [activePreset, setActivePreset] = useState("Flat");
  const [isAudioInitialized, setIsAudioInitialized] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [activeView, setActiveView] = useState<"equalizer" | "library">("equalizer");
  const [mediaInfo, setMediaInfo] = useState<{ title: string; artist?: string; appName: string; duration?: number; position?: number } | null>(null);
  const [stereoEnabled, setStereoEnabled] = useState(true);
  const [reverbEnabled, setReverbEnabled] = useState(false);
  const [savedPresets, setSavedPresets] = useState<EQPreset[]>([]);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [visualEnergy, setVisualEnergy] = useState<number[]>(new Array(16).fill(0));
  const lastSampledAt = useRef(0);
  const lastAudibleVolume = useRef(Number(localStorage.getItem("super-dribble-last-volume")) || 60);
  const isAudioAvailable = audioService.isAvailable();

  const formatTime = (seconds = 0) => !Number.isFinite(seconds) ? "0:00" : `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

  const updateBand = useCallback(async (index: number, value: number) => {
    setEqValues((previous) => previous.map((item, current) => current === index ? value : item));
    setActivePreset("Custom");
    await audioService.updateEQBand(index, value);
  }, []);

  const selectPreset = useCallback(async (preset: EQPreset) => {
    setEqValues([...preset.values]);
    setActivePreset(preset.name);
    await audioService.updateEQPreset(preset);
  }, []);

  const saveCustomPreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    const next = [...savedPresets.filter((preset) => preset.name !== name), { name, values: [...eqValues] }];
    setSavedPresets(next);
    localStorage.setItem("super-dribble-custom-presets", JSON.stringify(next));
    setActivePreset(name);
    setPresetName("");
    setShowSavePreset(false);
  }, [eqValues, presetName, savedPresets]);

  const deleteCustomPreset = useCallback((name: string) => {
    setSavedPresets((previous) => {
      const next = previous.filter((preset) => preset.name !== name);
      localStorage.setItem("super-dribble-custom-presets", JSON.stringify(next));
      return next;
    });
    if (activePreset === name) setActivePreset("Custom");
  }, [activePreset]);

  const toggleSpatializer = useCallback(async (kind: "stereo" | "reverb") => {
    const nextStereo = kind === "stereo" ? !stereoEnabled : stereoEnabled;
    const nextReverb = kind === "reverb" ? !reverbEnabled : reverbEnabled;
    setStereoEnabled(nextStereo);
    setReverbEnabled(nextReverb);
    await audioService.updateSpatializer({ width: nextStereo ? 1.35 : 1, decay: nextReverb ? 0.7 : 0, damping: 0.4, mix: nextReverb ? 0.35 : 0 });
  }, [reverbEnabled, stereoEnabled]);

  const toggleMute = useCallback(async () => {
    const next = !isMuted;
    setIsMuted(next);
    await audioService.updateMute(next, lastAudibleVolume.current);
  }, [isMuted]);

  const toggleConnection = useCallback(async () => {
    if (!isAudioAvailable) return;
    setConnectionError("");
    if (isAudioInitialized) {
      await audioService.stopCapture();
      setIsAudioInitialized(false);
      setIsPlaying(false);
      return;
    }
    setIsConnecting(true);
    const success = await audioService.startCapture();
    setIsAudioInitialized(success);
    if (!success) setConnectionError("Open a regular tab with audio, then try again.");
    setIsConnecting(false);
  }, [isAudioAvailable, isAudioInitialized]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("super-dribble-custom-presets") || "[]");
      if (Array.isArray(stored)) setSavedPresets(stored);
    } catch { setSavedPresets([]); }
  }, []);

  useEffect(() => {
    if (!isAudioAvailable) return;
    const port = chrome.runtime.connect({ name: "super-dribble-visualization" });
    const channel = new BroadcastChannel("super-dribble-visualization");
    const listener = (event: MessageEvent) => {
      const frame = event.data;
      if (frame?.action !== "visualization_update" || !Array.isArray(frame.energy)) return;
      const sampledAt = Number(frame.sampledAt);
      const now = performance.timeOrigin + performance.now();
      if (!Number.isFinite(sampledAt) || sampledAt <= lastSampledAt.current || now - sampledAt > 120) return;
      lastSampledAt.current = sampledAt;
      const source = frame.energy.map((value: unknown) => Math.max(0, Math.min(1, Number(value) || 0)));
      setVisualEnergy(Array.from({ length: 16 }, (_, index) => {
        const sourceIndex = Math.round((index / 15) * Math.max(0, source.length - 1));
        return source[sourceIndex] ?? 0;
      }));
    };
    channel.addEventListener("message", listener);
    return () => {
      channel.removeEventListener("message", listener);
      channel.close();
      port.disconnect();
      lastSampledAt.current = 0;
      setVisualEnergy(new Array(16).fill(0));
    };
  }, [isAudioAvailable]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (lastSampledAt.current > 0 && Date.now() - lastSampledAt.current > 220) {
        setVisualEnergy(new Array(16).fill(0));
      }
    }, 160);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isAudioAvailable) return;
    const checkStatus = async () => {
      const connectedStatus = await audioService.checkConnection();
      const status = connectedStatus ?? await audioService.getStatus();
      setIsAudioInitialized(Boolean(connectedStatus?.isInitialized));
      if (status) {
        if (typeof status.volume === "number") {
          setIsMuted(status.volume === 0);
          if (status.volume > 0) {
            setVolume(status.volume);
            lastAudibleVolume.current = status.volume;
            localStorage.setItem("super-dribble-last-volume", String(status.volume));
          } else {
            setVolume(lastAudibleVolume.current);
          }
        }
        if (Array.isArray(status.eqValues)) setEqValues(status.eqValues);
        if (status.preset) setActivePreset(status.preset);
        if (status.spatializerParams) {
          setStereoEnabled((status.spatializerParams.width ?? 1) > 1);
          setReverbEnabled((status.spatializerParams.mix ?? 0) > 0);
        }
      }
      const info = await audioService.getMediaInfo();
      if (info) { setMediaInfo(info); setIsPlaying(Boolean(info.isPlaying)); }
    };
    void checkStatus();
  }, [isAudioAvailable]);

  useEffect(() => {
    if (!isAudioAvailable) return;
    const listener = (request: any) => {
      if (request?.action !== "media_state_update") return;
      if (typeof request.isPlaying === "boolean") setIsPlaying(request.isPlaying);
      if (request.title) setMediaInfo(request);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [isAudioAvailable]);

  useEffect(() => {
    if (!isAudioInitialized) return;
    const interval = window.setInterval(async () => {
      const info = await audioService.getMediaInfo();
      if (info) { setMediaInfo(info); setIsPlaying(Boolean(info.isPlaying)); }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isAudioInitialized]);

  const statusLabel = isConnecting ? "Connecting" : connectionError ? "Connection issue" : isAudioInitialized ? "Audio connected" : isAudioAvailable ? "Ready to connect" : "Preview mode";
  const presets = [...EQ_PRESETS.filter((preset) => ["Flat", "Electronic", "Rock", "Jazz", "Pop"].includes(preset.name)), ...savedPresets];

  if (activeView === "library") {
    return <div className={cn("sd-shell sd-library", className)}><div className="sd-orb sd-orb-green" /><div className="sd-orb sd-orb-blue" /><div className="sd-library-content"><div className="sd-library-head"><button className="sd-icon-btn" onClick={() => setActiveView("equalizer")} aria-label="Return to equalizer"><ArrowLeft size={18} /></button><div><strong>Preset library</strong><span>Lua equalizer and spatial audio profiles</span></div></div><React.Suspense fallback={<div className="sd-loading"><LoaderCircle className="spin" size={20} /></div>}><LuaPresetManager onPresetApplied={(type, preset) => { if (type === "equalizer" && preset.bands) { setEqValues(preset.bands.slice(0, 10).map((band) => band.gain || 0)); setActivePreset(preset.name); } if (type === "spatializer" && preset.params) { setStereoEnabled((preset.params.width ?? 1) > 1); setReverbEnabled((preset.params.mix ?? 0) > 0); } }} /></React.Suspense></div></div>;
  }

  return (
    <main className={cn("sd-shell", className)}>
      <div className="sd-orb sd-orb-green" /><div className="sd-orb sd-orb-blue" />
      <div className="sd-content">
        <header className="sd-header">
          <div className="sd-brand"><div className="sd-brand-icon"><AudioLines size={22} /></div><div><strong>SUPER DRIBBLE</strong><span>Audio Amplifier · {statusLabel}</span></div></div>
          <div className="sd-header-actions"><button className={cn("sd-icon-btn", isMuted && "is-active")} onClick={toggleMute} aria-label={isMuted ? "Unmute audio" : "Mute audio"}><VolumeX size={18} /></button><button className="sd-icon-btn" onClick={toggleConnection} disabled={isConnecting} aria-label={isAudioInitialized ? "Disconnect audio" : "Connect audio"}>{isConnecting ? <LoaderCircle className="spin" size={18} /> : isAudioInitialized ? <Wifi size={18} /> : <WifiOff size={18} />}</button><button className="sd-icon-btn" onClick={() => setActiveView("library")} aria-label="Open preset library"><Settings size={18} /></button></div>
        </header>
        {connectionError && <div className="sd-error" role="alert">{connectionError}</div>}

        <section className="sd-panel sd-now-playing">
          <div className="sd-track-row"><div className="sd-cover"><Headphones size={28} /></div><div className="sd-track-copy"><h1>{mediaInfo?.title || "No media playing"}</h1><div><span>{mediaInfo?.artist || mediaInfo?.appName || "Connect a tab to begin"}</span><span className="sd-time">{formatTime(mediaInfo?.position)} / {formatTime(mediaInfo?.duration)}</span></div></div><button className="sd-play-btn" onClick={async () => { if (!isAudioInitialized) return; await audioService.controlPlayback("toggle"); setIsPlaying((value) => !value); }} disabled={!isAudioInitialized} aria-label={isPlaying ? "Pause playback" : "Play playback"}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button></div>
          <div className={cn("sd-waveform", isPlaying && "is-live")} aria-label="Live audio visualizer">{visualEnergy.map((energy, index) => <i key={index} style={{ height: `${Math.max(8, energy * 100)}%`, animationDelay: `${index * 0.08}s`, opacity: Math.max(.35, energy) }} />)}</div>
        </section>

        <section className="sd-panel sd-volume"><div className="sd-panel-label"><span><Volume2 size={14} /> Master volume</span><output>{isMuted ? 0 : volume}%</output></div><div className="sd-range-wrap"><div className="sd-range-fill" style={{ width: `${isMuted ? 0 : volume}%` }} /><input type="range" min="0" max="100" value={isMuted ? 0 : volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); setIsMuted(false); if (next > 0) { lastAudibleVolume.current = next; localStorage.setItem("super-dribble-last-volume", String(next)); } void audioService.updateVolume(next); }} aria-label="Master volume" /></div></section>

        <section className="sd-panel sd-eq"><div className="sd-panel-label"><span>Parametric EQ</span><div className="sd-inline-actions"><button onClick={() => void selectPreset({ name: "Flat", values: new Array(10).fill(0) })}><RotateCcw size={13} /> Reset</button><button onClick={() => setShowSavePreset((value) => !value)}><Check size={13} /> Save</button></div></div>{showSavePreset && <div className="sd-save-row"><input autoFocus value={presetName} onChange={(event) => setPresetName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveCustomPreset(); }} placeholder="Preset name" /><button onClick={saveCustomPreset}>Save preset</button></div>}<div className="sd-eq-grid">{eqValues.map((value, index) => <div className="sd-eq-band" key={FREQUENCY_BANDS[index]}><div className="sd-eq-track"><input className="sd-eq-range" type="range" min="-12" max="12" step="0.5" value={value} onChange={(event) => void updateBand(index, Number(event.target.value))} aria-label={`${FREQUENCY_BANDS[index]} gain`} /></div><span>{frequencies[index]}</span></div>)}</div></section>

        <div className="sd-bottom-grid"><section className="sd-panel sd-spatial"><span className="sd-micro">Spatializer</span>{[["Stereo", stereoEnabled, "stereo"], ["Reverb", reverbEnabled, "reverb"]].map(([label, enabled, kind]) => <div className="sd-toggle-row" key={String(label)}><span className={cn(!enabled && "dim")}>{label}</span><button className={cn("sd-toggle", enabled && "is-on")} onClick={() => void toggleSpatializer(kind as "stereo" | "reverb")} aria-pressed={Boolean(enabled)} aria-label={`Toggle ${label}`}><i /></button></div>)}</section><section className="sd-panel sd-presets"><div className="sd-presets-head"><span className="sd-micro">Presets</span><button onClick={() => setActiveView("library")}>Library</button></div><div className="sd-preset-scroll">{presets.map((preset) => <div className="sd-preset-item" key={preset.name}><button className={cn("sd-preset", activePreset === preset.name && "is-active")} onClick={() => void selectPreset(preset)}>{preset.name}</button>{savedPresets.some((item) => item.name === preset.name) && <button className="sd-delete" onClick={() => deleteCustomPreset(preset.name)} aria-label={`Delete ${preset.name}`}><Trash2 size={11} /></button>}</div>)}</div></section></div>
      </div>
    </main>
  );
};
