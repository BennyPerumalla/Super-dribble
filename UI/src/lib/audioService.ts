// Audio service for communicating with the background script
// Updated to use Offscreen Document pattern

export interface AudioStatus {
  isProcessing: boolean;
  isInitialized: boolean;
  activeTabId?: number;
  volume?: number;
  eqValues?: number[];
  preset?: string;
  spatializerParams?: SpatializerParams | null;
}

export interface EQPreset {
  name: string;
  values: number[];
}

export interface SpatializerParams {
  width?: number;
  decay?: number;
  damping?: number;
  mix?: number;
  crossoverFrequency?: number;
  lowWidthFactor?: number;
  highWidthFactor?: number;
}

class AudioService {
  private isInitialized = false;
  private capturedTabId: number | null = null;
  private contentScriptReadiness = new Map<number, Promise<boolean>>();

  private sendRawTabMessage<T = any>(tabId: number, message: any): Promise<T | null> {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response: T) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response ?? null);
        }
      });
    });
  }

  private async ensureContentScript(tabId: number): Promise<boolean> {
    const pending = this.contentScriptReadiness.get(tabId);
    if (pending) return pending;

    const readiness = (async () => {
      const ping = await this.sendRawTabMessage<{ success?: boolean }>(tabId, { action: 'ping' });
      if (ping?.success) return true;

      try {
        await new Promise<void>((resolve, reject) => {
          chrome.scripting.executeScript(
            { target: { tabId }, files: ['content.js'] },
            () => {
              const error = chrome.runtime.lastError;
              if (error) reject(new Error(error.message));
              else resolve();
            },
          );
        });
      } catch {
        return false;
      }

      const injectedPing = await this.sendRawTabMessage<{ success?: boolean }>(tabId, { action: 'ping' });
      return !!injectedPing?.success;
    })();

    this.contentScriptReadiness.set(tabId, readiness);
    try {
      return await readiness;
    } finally {
      this.contentScriptReadiness.delete(tabId);
    }
  }

  private async sendMessageToTab<T = any>(message: any, tabId?: number | null): Promise<T> {
    const ensureTabId = async () => {
      if (tabId) return tabId;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id ?? null;
    };

    const targetTabId = await ensureTabId();
    if (!targetTabId) throw new Error('No active tab available');

    if (!(await this.ensureContentScript(targetTabId))) return null as T;
    return (await this.sendRawTabMessage<T>(targetTabId, message)) as T;
  }

  // Initialize audio capture via Offscreen Document
  async startCapture(): Promise<boolean> {
    if (!this.isAvailable()) {
      console.warn('Chrome extension APIs not available');
      return false;
    }

    try {
      console.log('Starting audio capture...');
      
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const tab = tabs[0];
      this.capturedTabId = tab.id ?? null;

      // The active tab is already known, so avoid another tab query while
      // restoring an existing session.
      const existingStatus = await this.getStatus();
      if (existingStatus && existingStatus.isInitialized && existingStatus.activeTabId === this.capturedTabId) {
          console.log('Audio capture already active for this tab.');
          this.isInitialized = true;
          return true;
      }
      
       // Check validity
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://')) {
        throw new Error('Cannot capture audio from browser internal pages');
      }

      // The service worker must create the stream ID so Chrome can authorize
      // the offscreen document to consume it.
      const response = await chrome.runtime.sendMessage({
          action: 'start_capture',
          tabId: this.capturedTabId
      });

      if (response && response.success) {
          this.isInitialized = true;
          console.log('Audio capture started successfully via offscreen');
          return true;
      } else {
          throw new Error(response?.error || 'Failed to start capture');
      }

    } catch (error) {
      console.error('Error starting audio capture:', error);
      this.isInitialized = false;
      return false;
    }
  }

  // Check if there is an active connection for the current tab
  async checkConnection(): Promise<AudioStatus | null> {
      if (!this.isAvailable()) return null;
      try {
          const [status, tabs] = await Promise.all([
            this.getStatus(),
            chrome.tabs.query({ active: true, currentWindow: true }),
          ]);
          const currentTabId = tabs[0]?.id;

          if (status && status.isInitialized && status.activeTabId === currentTabId) {
              this.isInitialized = true;
              this.capturedTabId = currentTabId ?? null;
              console.log('Restored connection to active audio session');
              return status;
          }
          return null;
      } catch (e) {
          console.error('Failed to check connection:', e);
          return null;
      }
  }

  // Stop audio capture
  async stopCapture(): Promise<boolean> {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'stop_capture'
        });
        
        this.isInitialized = false;
        return response?.success || false;
    } catch (error) {
      console.error('Error stopping audio capture:', error);
      return false;
    }
  }

  // Update volume
  async updateVolume(volume: number): Promise<boolean> {
    // If we haven't initialized locally, check if we can restore connection first
    if (!this.isInitialized) await this.checkConnection();
    return this.sendControlMessage('set_volume', { value: volume });
  }

  // Update mute state
  async updateMute(isMuted: boolean, previousVolume: number): Promise<boolean> {
      if (!this.isInitialized) await this.checkConnection();
      const targetVolume = isMuted ? 0 : previousVolume;
      return this.sendControlMessage('set_volume', { value: targetVolume });
  }

  // Update individual EQ band
  async updateEQBand(bandIndex: number, gainDb: number): Promise<boolean> {
     if (!this.isInitialized) await this.checkConnection();
     return this.sendControlMessage('update_eq', { bandIndex, gainDb });
  }

  // Update EQ preset
  async updateEQPreset(preset: EQPreset): Promise<boolean> {
     if (!this.isInitialized) await this.checkConnection();
     return this.sendControlMessage('update_eq_preset', { preset });
  }

  async updateSpatializer(params: SpatializerParams): Promise<boolean> {
     if (!this.isInitialized) await this.checkConnection();
     return this.sendControlMessage('update_spatializer', { params });
  }

  private async sendControlMessage(action: string, data: any): Promise<boolean> {
      if (!this.isInitialized) return false;
      try {
          const response = await chrome.runtime.sendMessage({
              action,
              ...data
          });
          return response?.success || false;
      } catch (e) {
          console.error(`Failed to send ${action}:`, e);
          return false;
      }
  }

  // Send playback control command to the captured tab
  async controlPlayback(command: 'toggle' | 'play' | 'pause' | 'next' | 'previous'): Promise<boolean> {
    try {
      if (!this.capturedTabId) {
          // If we don't have a captured ID, maybe we can just target the active tab
           const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
           if (tabs[0]?.id) this.capturedTabId = tabs[0].id;
      }
      
      if (!this.capturedTabId) return false;
      const response = await this.sendMessageToTab({
        action: 'media_control',
        command,
      }, this.capturedTabId);
      return !!(response && (response as any).success);
    } catch (error) {
      console.error('Error sending playback control:', error);
      return false;
    }
  }

  // Get current media info from the captured tab
  async getMediaInfo(): Promise<{
    isPlaying: boolean;
    title: string;
    artist?: string;
    album?: string;
    appName: string;
    duration?: number;
    position?: number;
  } | null> {
    try {
      if (!this.capturedTabId) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          this.capturedTabId = tabs[0]?.id ?? null;
      }
      if (!this.capturedTabId) return null;

      const response = await this.sendMessageToTab({
        action: 'get_media_info',
      }, this.capturedTabId);
      return (response as any) || null;
    } catch (error) {
      // console.error('Error getting media info:', error);
      return null;
    }
  }

  getCapturedTabId(): number | null {
    return this.capturedTabId;
  }

  // Get audio processing status
  async getStatus(): Promise<(AudioStatus & { activeTabId?: number }) | null> {
    if (!this.isAvailable()) return null;

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'get_status'
      });
      return response;
    } catch (error) {
      return null;
    }
  }

  async loadLuaPresets(presetType: 'equalizer' | 'spatializer'): Promise<any[]> {
      const { LuaPresetParser } = await import("@/utils/lua-preset-parser");
      const parser = new LuaPresetParser();
      const isInitialized = await parser.initialize();

      if (!isInitialized) {
          throw new Error('Failed to initialize Lua preset parser');
      }

      return presetType === 'equalizer'
          ? parser.loadEqualizerPresets()
          : parser.loadSpatializerPresets();
  }

  async applyLuaPreset(presetType: 'equalizer' | 'spatializer', preset: any): Promise<boolean> {
      if (!this.isInitialized) await this.checkConnection();
      
      if (presetType === 'equalizer' && preset.bands && Array.isArray(preset.bands)) {
          // Map Lua bands to the fixed 10 bands required by the engine
          // The Lua presets have 16 bands, indices 0-9 correspond to the 10 UI sliders/engine bands.
          const values = preset.bands.slice(0, 10).map((b: any) => b.gain || 0);
          
          return this.updateEQPreset({
              name: preset.name,
              values: values
          });
      } else if (presetType === 'spatializer') {
          if (!preset.params) return false;
          return this.updateSpatializer(preset.params);
      }
      return false;
  }

  // Check if the service is available (Chrome extension context)
  isAvailable(): boolean {
    return typeof chrome !== 'undefined' && 
           typeof chrome.runtime !== 'undefined' && 
           typeof chrome.runtime.sendMessage !== 'undefined';
  }

  // Get initialization status
  getInitializationStatus(): boolean {
    return this.isInitialized;
  }
}

export const audioService = new AudioService();
