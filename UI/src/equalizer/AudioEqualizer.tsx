import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { audioService } from "@/lib/audioService";
import EQ_PRESETS, { EQPreset } from "@/constants/eq_presets";

const LuaPresetManager = React.lazy(() =>
  import("./LuaPresetManager").then((module) => ({
    default: module.LuaPresetManager,
  })),
);

const EQ_BANDS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k']
const WAVE_HEIGHTS = [15, 30, 50, 80, 45, 70, 100, 60, 85, 100, 70, 45, 80, 50, 30, 15]
const WAVE_DELAYS  = [0.1, 0.5, 0.2, 0.8, 0.4, 0.7, 0.3, 0.9, 0.2, 0.6, 0.1, 0.8, 0.5, 0.3, 0.7, 0.2]

// Stereo/Reverb toggles map onto the existing spatializer engine params.
const spatializerParams = (stereoOn: boolean, reverbOn: boolean) => ({
  width: stereoOn ? 1.4 : 1.0,
  decay: 0.4,
  damping: 0.5,
  mix: reverbOn ? 0.25 : 0,
})

const formatTime = (seconds?: number) => {
  if (seconds === undefined || !Number.isFinite(seconds)) return '0:00'
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function GlassPanel({ children, className = '', style = {} }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        background: 'rgba(255,255,255,0.07)',
        backdropFilter: 'blur(30px) saturate(160%)',
        WebkitBackdropFilter: 'blur(30px) saturate(160%)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 16,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function MicroHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`flex items-center ${className}`}
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'rgba(255,255,255,0.45)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {children}
    </span>
  )
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      id={id}
      onClick={() => onChange(!checked)}
      className="relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 shrink-0"
      style={{
        background: checked ? '#ffffff' : 'rgba(255,255,255,0.12)',
        border: '1px solid',
        borderColor: checked ? '#ffffff' : 'rgba(255,255,255,0.18)',
      }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-md transition-transform duration-200"
        style={{
          background: checked ? '#1c1c1e' : '#ffffff',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  )
}

function PresetsDropdown({
  presets,
  activePreset,
  onSelect,
  onImport,
}: {
  presets: EQPreset[]
  activePreset: string
  onSelect: (preset: EQPreset) => void
  onImport: (preset: EQPreset) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleImport = useCallback(() => {
    setOpen(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string)
          const values = Array.isArray(data.values)
            ? data.values
            : Array.isArray(data.bands)
              ? data.bands
              : null
          if (data.name && values && values.length === 10) {
            onImport({ name: data.name, values: values.map((v: unknown) => Number(v) || 0) })
          }
        } catch {
          // ignore malformed files
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [onImport])

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 h-6 pl-2 pr-1.5 rounded-md transition-all duration-150 hover:bg-white/10 active:scale-95"
        style={{
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="EQ presets"
      >
        <span className="text-[10px] font-semibold text-white truncate max-w-[62px]">{activePreset}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="drop-down preset-scroll absolute right-0 z-50 rounded-xl overflow-y-auto"
          style={{
            top: '100%',
            marginTop: 6,
            width: 152,
            maxHeight: 208,
            background: 'rgba(18,18,20,0.98)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.75)',
          }}
        >
          {presets.map((preset, i, arr) => (
            <button
              key={preset.name}
              onClick={() => { onSelect(preset); setOpen(false) }}
              className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium text-left transition-colors duration-100 hover:bg-white/10"
              style={{
                color: activePreset === preset.name ? '#ffffff' : 'rgba(255,255,255,0.6)',
                borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}
            >
              <span>{preset.name}</span>
              {activePreset === preset.name && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(48,209,88,0.9)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}

          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)' }} />

          <button
            onClick={handleImport}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-left transition-colors duration-100 hover:bg-white/10"
            style={{ color: 'rgba(10,132,255,0.9)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Import Preset…
          </button>
        </div>
      )}
    </div>
  )
}

interface AudioEqualizerProps {
  className?: string;
}

export const AudioEqualizer: React.FC<AudioEqualizerProps> = () => {
  const [volume, setVolume] = useState(60)
  const [muted, setMuted] = useState(false)
  const [eqBands, setEqBands] = useState<number[]>(new Array(10).fill(0))
  const [activePreset, setActivePreset] = useState('Flat')
  const [stereo, setStereo] = useState(true)
  const [reverb, setReverb] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [customPresets, setCustomPresets] = useState<EQPreset[]>([])
  const [media, setMedia] = useState<{ title: string; artist: string; artwork?: string; duration?: number; position?: number }>({
    title: '',
    artist: '',
  })

  const [isAudioInitialized, setIsAudioInitialized] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [activeView, setActiveView] = useState<'equalizer' | 'library'>('equalizer')
  const [flipped, setFlipped] = useState(false)
  const [artError, setArtError] = useState('')

  const isAudioAvailable = audioService.isAvailable()

  const refreshMedia = useCallback(async () => {
    const info = await audioService.getMediaInfo()
    if (!info) return
    setPlaying(Boolean(info.isPlaying))
    setMedia({
      title: info.title || '',
      artist: info.artist || '',
      artwork: info.artwork || '',
      duration: info.duration,
      position: info.position,
    })
  }, [])

  const handlePreset = useCallback(async (preset: EQPreset) => {
    setActivePreset(preset.name)
    setEqBands([...preset.values])
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateEQPreset(preset)
    }
  }, [isAudioInitialized])

  const handleImport = useCallback((preset: EQPreset) => {
    setCustomPresets(prev => [...prev.filter(p => p.name !== preset.name), preset])
    void handlePreset(preset)
  }, [handlePreset])

  const handleEq = useCallback(async (i: number, val: number) => {
    setEqBands(prev => {
      const next = [...prev]
      next[i] = val
      return next
    })
    setActivePreset('Custom')
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateEQBand(i, val)
    }
  }, [isAudioInitialized])

  const resetEq = useCallback(async () => {
    const flat = new Array(10).fill(0)
    setEqBands(flat)
    setActivePreset('Flat')
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateEQPreset({ name: 'Flat', values: flat })
    }
  }, [isAudioInitialized])

  const handleToggleMute = useCallback(async () => {
    const next = !muted
    setMuted(next)
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateMute(next, volume)
    }
  }, [muted, volume, isAudioInitialized])

  const handleVolume = useCallback(async (next: number) => {
    setVolume(next)
    if (next > 0 && muted) setMuted(false)
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateVolume(next)
    }
  }, [muted, isAudioInitialized])

  const handleStereo = useCallback(async (next: boolean) => {
    setStereo(next)
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateSpatializer(spatializerParams(next, reverb))
    }
  }, [reverb, isAudioInitialized])

  const handleReverb = useCallback(async (next: boolean) => {
    setReverb(next)
    if (audioService.isAvailable() && isAudioInitialized) {
      await audioService.updateSpatializer(spatializerParams(stereo, next))
    }
  }, [stereo, isAudioInitialized])

  const handleToggleAudioConnection = useCallback(async () => {
    if (!audioService.isAvailable()) return
    setConnectionError('')

    if (isAudioInitialized) {
      await audioService.stopCapture()
      setIsAudioInitialized(false)
      setPlaying(false)
      return
    }

    setIsConnecting(true)
    try {
      const success = await audioService.startCapture()
      setIsAudioInitialized(success)
      if (!success) {
        setConnectionError('Open a regular tab with audio, then try again.')
        return
      }
      await audioService.updateSpatializer(spatializerParams(stereo, reverb))
      void refreshMedia()
    } catch {
      setIsAudioInitialized(false)
      setConnectionError('Audio connection failed. Try another tab.')
    } finally {
      setIsConnecting(false)
    }
  }, [isAudioInitialized, stereo, reverb, refreshMedia])

  // Live media metadata pushed from the content script.
  useEffect(() => {
    const listener = (request: any) => {
      if (!request || request.action !== 'media_state_update') return
      if (typeof request.isPlaying === 'boolean') setPlaying(request.isPlaying)
      setMedia(prev => ({
        title: request.title ?? prev.title,
        artist: request.artist ?? prev.artist,
        artwork: request.artwork ?? prev.artwork,
        duration: request.duration ?? prev.duration,
        position: request.position ?? prev.position,
      }))
    }
    if (audioService.isAvailable()) chrome.runtime.onMessage.addListener(listener)
    return () => {
      if (audioService.isAvailable()) chrome.runtime.onMessage.removeListener?.(listener)
    }
  }, [])

  // Restore an existing session when the popup reopens.
  useEffect(() => {
    const checkStatus = async () => {
      if (!audioService.isAvailable()) return
      const status = await audioService.checkConnection()
      if (!status?.isInitialized) return
      setIsAudioInitialized(true)
      if (typeof status.volume === 'number') setVolume(status.volume)
      if (Array.isArray(status.eqValues)) setEqBands(status.eqValues)
      if (status.preset) setActivePreset(status.preset)
      void refreshMedia()
    }
    void checkStatus()
  }, [refreshMedia])

  // Poll playback/time while connected.
  useEffect(() => {
    if (!audioService.isAvailable() || !isAudioInitialized) return
    let cancelled = false
    const interval = window.setInterval(async () => {
      const info = await audioService.getMediaInfo()
      if (cancelled || !info) return
      setPlaying(Boolean(info.isPlaying))
      setMedia({
        title: info.title || '',
        artist: info.artist || '',
        artwork: info.artwork || '',
        duration: info.duration,
        position: info.position,
      })
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isAudioInitialized])

  const displayVol = muted ? 0 : volume
  const presets = [...EQ_PRESETS, ...customPresets]
  const showArt = Boolean(media.artwork) && media.artwork !== artError

  if (activeView === 'library') {
    return (
      <div className="flex items-center justify-center">
        <div
          className="view-fade relative w-[468px] overflow-hidden"
          style={{
            height: 596,
            background: '#0a0a0a',
            fontFamily: 'var(--font-sans)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
          }}
        >
          {/* Ambient orbs */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: -40, left: -40,
              width: 260, height: 260,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(48,209,88,0.85) 0%, transparent 70%)',
              filter: 'blur(50px)',
              opacity: 0.55,
              mixBlendMode: 'screen',
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              bottom: -60, right: -60,
              width: 310, height: 310,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(10,132,255,0.85) 0%, transparent 70%)',
              filter: 'blur(55px)',
              opacity: 0.45,
              mixBlendMode: 'screen',
            }}
          />

          <div className="relative z-10 flex flex-col h-full p-5 gap-3">
            {/* Header */}
            <header className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveView('equalizer')}
                aria-label="Return to equalizer"
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shrink-0"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}
              >
                <ArrowLeft size={18} />
              </button>
              <div>
                <h1 className="text-sm font-semibold tracking-tight text-white leading-none">PRESET LIBRARY</h1>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Lua audio profiles</p>
              </div>
            </header>

            {/* Scroll region */}
            <div className="flex-1 min-h-0 overflow-y-auto preset-scroll pr-1">
              <React.Suspense
                fallback={
                  <div className="flex min-h-40 items-center justify-center" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <LoaderCircle className="animate-spin" size={20} />
                  </div>
                }
              >
                <LuaPresetManager />
              </React.Suspense>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center">
      <div
        className="view-fade relative w-[468px] overflow-hidden"
        style={{
          height: 596,
          background: '#0a0a0a',
          fontFamily: 'var(--font-sans)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
        }}
      >
        {/* Ambient orbs */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: -40, left: -40,
            width: 260, height: 260,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(48,209,88,0.85) 0%, transparent 70%)',
            filter: 'blur(50px)',
            opacity: 0.55,
            mixBlendMode: 'screen',
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: -60, right: -60,
            width: 310, height: 310,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(10,132,255,0.85) 0%, transparent 70%)',
            filter: 'blur(55px)',
            opacity: 0.45,
            mixBlendMode: 'screen',
          }}
        />

        <div className="relative z-10 flex flex-col h-full p-5 gap-2">

          {/* Header */}
          <header className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  backdropFilter: 'blur(20px)',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-semibold tracking-tight text-white leading-none">SUPER DRIBBLE</h1>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Audio Amplifier</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleAudioConnection}
                disabled={isConnecting || !isAudioAvailable}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-50"
                style={{
                  background: isAudioInitialized ? 'rgba(48,209,88,0.18)' : 'rgba(255,255,255,0.07)',
                  border: `1px solid ${isAudioInitialized ? 'rgba(48,209,88,0.4)' : 'rgba(255,255,255,0.12)'}`,
                }}
                aria-label={isAudioInitialized ? 'Disconnect audio' : 'Connect audio'}
                aria-pressed={isAudioInitialized}
                title={isAudioInitialized ? 'Disconnect audio' : 'Connect audio'}
              >
                {isConnecting ? (
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : isAudioInitialized ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(48,209,88,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23" /><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" /><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" /><path d="M10.71 5.05A16 16 0 0 1 22.58 9" /><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => setActiveView('library')}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
                aria-label="Open preset library"
                title="Preset library"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
                </svg>
              </button>
              <button
                onClick={handleToggleMute}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
                style={{
                  background: muted ? 'rgba(255,59,48,0.2)' : 'rgba(255,255,255,0.07)',
                  border: `1px solid ${muted ? 'rgba(255,59,48,0.4)' : 'rgba(255,255,255,0.12)'}`,
                }}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,59,48,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
              </button>
            </div>
          </header>

          {connectionError && (
            <div
              className="text-[12px] font-medium px-3 py-2 rounded-lg"
              style={{ background: 'rgba(255,59,48,0.12)', border: '1px solid rgba(255,59,48,0.3)', color: 'rgba(255,120,110,0.95)' }}
              role="alert"
            >
              {connectionError}
            </div>
          )}

          {/* Now Playing — 3 of 10 shares of the 492px content column */}
          <GlassPanel className="flex flex-col gap-2 p-4 min-h-0" style={{ flex: 'none', height: 148 }}>
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-[14px] shrink-0 overflow-hidden flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.08)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}
              >
                {showArt ? (
                  <img
                    src={media.artwork}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={() => setArtError(media.artwork || '')}
                  />
                ) : (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[21px] font-semibold text-white leading-tight truncate" style={{ letterSpacing: '-0.02em' }}>
                  {media.title || 'Nothing playing'}
                </h2>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <span className="text-sm truncate" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {media.artist || (isAudioInitialized ? '—' : 'Connect to begin')}
                  </span>
                  <span className="text-sm tabular-nums shrink-0" style={{ color: 'rgba(255,255,255,0.55)', fontFamily: 'var(--font-mono)' }}>
                    {formatTime(media.position)} / {formatTime(media.duration)}
                  </span>
                </div>
              </div>
            </div>

            {/* Waveform */}
            <div className="flex-1 min-h-0 w-full flex items-center justify-between px-0.5 relative">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px" style={{ background: 'rgba(255,255,255,0.25)' }} />
              {WAVE_HEIGHTS.map((h, i) => (
                <div
                  key={i}
                  className="wave-bar rounded-full relative z-10"
                  style={{
                    width: 3,
                    height: `${h}%`,
                    background: playing && !muted
                      ? i < 8 ? 'rgba(48,209,88,0.9)' : 'rgba(255,255,255,0.9)'
                      : 'rgba(255,255,255,0.3)',
                    animationDelay: `${WAVE_DELAYS[i]}s`,
                    animationPlayState: playing && !muted ? 'running' : 'paused',
                  }}
                />
              ))}
            </div>
          </GlassPanel>

          {/* Volume — 1 share */}
          <GlassPanel className="px-4 flex items-center gap-3 min-h-0" style={{ flex: 'none', height: 49 }}>
            <MicroHeader className="shrink-0">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline mr-1.5 -mt-px">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
              Volume
            </MicroHeader>
            <input
              type="range" min={0} max={100} value={volume}
              onChange={e => handleVolume(+e.target.value)}
              className="flex-1 min-w-0"
              aria-label="Master volume"
              style={{
                '--track-fill': muted
                  ? `linear-gradient(to right, rgba(255,59,48,0.7) ${displayVol}%, rgba(255,255,255,0.15) ${displayVol}%)`
                  : `linear-gradient(to right, rgba(255,255,255,0.9) ${displayVol}%, rgba(255,255,255,0.15) ${displayVol}%)`,
              } as React.CSSProperties}
            />
            <span className="text-sm font-semibold tabular-nums shrink-0 text-right" style={{ width: 38, color: 'rgba(255,255,255,0.95)', fontFamily: 'var(--font-mono)' }}>
              {displayVol}%
            </span>
          </GlassPanel>

          {/* EQ (front) / Spatializer (back) — 3D flip card, 6 shares */}
          <div className="flip-card min-h-0" style={{ flex: 'none', height: 295 }}>
            <div className={`flip-inner ${flipped ? 'is-flipped' : ''}`}>

              {/* ---------- FRONT: Parametric EQ ---------- */}
              <div className="flip-face flip-front">
                <GlassPanel className="w-full h-full p-4 flex flex-col">
                  <div className="flex justify-between items-center gap-2 mb-1">
                    <button
                      onClick={() => setFlipped(true)}
                      className="flex items-center gap-1.5 shrink-0 group"
                      aria-label="Show spatializer settings"
                      title="Show spatializer"
                    >
                      <MicroHeader className="transition-colors duration-150 group-hover:text-white">
                        Parametric EQ
                      </MicroHeader>
                      <svg
                        width="11" height="11" viewBox="0 0 24 24" fill="none"
                        stroke="rgba(10,132,255,0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        className="transition-transform duration-200 group-hover:rotate-180"
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <PresetsDropdown
                        presets={presets}
                        activePreset={activePreset}
                        onSelect={handlePreset}
                        onImport={handleImport}
                      />
                      <button
                        onClick={resetEq}
                        className="text-[11px] font-semibold uppercase transition-colors duration-150 hover:text-white"
                        style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.06em' }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 flex items-center justify-center min-h-0">
                    <div className="flex justify-between items-end w-full px-1">
                      {EQ_BANDS.map((band, i) => (
                        <div key={band} className="flex flex-col items-center gap-1.5">
                          <input
                            type="range"
                            min={-12} max={12}
                            value={eqBands[i]}
                            onChange={e => handleEq(i, +e.target.value)}
                            className="eq-slider"
                            aria-label={`${band} Hz EQ band`}
                          />
                          <span
                            className="tabular-nums"
                            style={{
                              fontSize: 9,
                              fontFamily: 'var(--font-mono)',
                              color: eqBands[i] !== 0 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)',
                              fontWeight: eqBands[i] !== 0 ? 600 : 400,
                            }}
                          >
                            {band}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </GlassPanel>
              </div>

              {/* ---------- BACK: Spatializer ---------- */}
              <div className="flip-face flip-back">
                <GlassPanel className="w-full h-full p-4 flex flex-col">
                  <MicroHeader>Spatializer</MicroHeader>

                  <div className="flex-1 flex flex-col justify-center gap-3">
                    <div
                      className="flex justify-between items-center px-3.5 py-3 rounded-xl transition-colors duration-200"
                      style={{
                        background: stereo ? 'rgba(10,132,255,0.12)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${stereo ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.09)'}`,
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-white leading-none">Stereo</p>
                        <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                          Widen the stereo field
                        </p>
                      </div>
                      <Toggle id="stereo" checked={stereo} onChange={handleStereo} />
                    </div>

                    <div
                      className="flex justify-between items-center px-3.5 py-3 rounded-xl transition-colors duration-200"
                      style={{
                        background: reverb ? 'rgba(10,132,255,0.12)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${reverb ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.09)'}`,
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold leading-none" style={{ color: reverb ? '#ffffff' : 'rgba(255,255,255,0.75)' }}>
                          Reverb
                        </p>
                        <p className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                          Add room ambience
                        </p>
                      </div>
                      <Toggle id="reverb" checked={reverb} onChange={handleReverb} />
                    </div>
                  </div>

                  <button
                    onClick={() => setFlipped(false)}
                    className="w-full h-9 rounded-xl flex items-center justify-center gap-2 text-[12px] font-semibold text-white transition-all duration-200 hover:bg-white/10 active:scale-95"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
                  >
                    <ArrowLeft size={14} />
                    Back to EQ
                  </button>
                </GlassPanel>
              </div>

            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
