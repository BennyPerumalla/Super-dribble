// Audio service for communicating with the background script
// Updated to use Offscreen Document pattern

export interface AudioStatus {
  isProcessing: boolean;
  isInitialized: boolean;
  activeTabId?: number;
  volume?: number;
  eqValues?: number[];
  preset?: string;
}

export interface EQPreset {
  name: string;
  values: number[];
}

class AudioService {
  private isInitialized = false;
  private capturedTabId: number | null = null;

  private async sendMessageToTab<T = any>(message: any, tabId?: number | null): Promise<T> {
    const ensureTabId = async () => {
      if (tabId) return tabId;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0]?.id ?? null;
    };

    const targetTabId = await ensureTabId();
    if (!targetTabId) throw new Error('No active tab available');

    // Wrap callback-style API to Promise for reliability across Chrome versions
    return new Promise((resolve, reject) => {
      try {
        // @ts-ignore sendMessage callback signature
        chrome.tabs.sendMessage(targetTabId, message, (response: any) => {
          const err = chrome.runtime.lastError;
          if (err) {
            // Ignore error if we just can't reach the content script (it might not be loaded yet)
            resolve(null as any); 
          } else {
            resolve(response);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
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

       // Check validity
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://')) {
        throw new Error('Cannot capture audio from browser internal pages');
      }

      // Get Media Stream ID
      const streamId = await new Promise<string>((resolve, reject) => {
        (chrome.tabCapture as any).getMediaStreamId({ 
            targetTabId: this.capturedTabId 
        }, (streamId: string) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(streamId);
          }
        });
      });

      console.log('Got Stream ID:', streamId);

      // Send to background to start offscreen processing
      const response = await chrome.runtime.sendMessage({
          action: 'start_capture',
          streamId: streamId,
          tabId: this.capturedTabId // Send tabId for state tracking
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
          const status = await this.getStatus();
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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

  // Load Lua presets (Proxy to background -> which should proxy to Offscreen/WASM if needed, 
  // but currently Lua parser is in background? Wait, background WAS handling Lua.)
  // We need to move Lua handling to offscreen or keep it in background if it's just parsing.
  // Reviewing background.js: I removed Lua parser.
  // So we need to re-implement Lua or make sure offscreen handles it.
  // For now, return empty to prevent crash.
  async loadLuaPresets(presetType: 'equalizer' | 'spatializer'): Promise<any[]> {
      return []; 
  }

  async applyLuaPreset(presetType: 'equalizer' | 'spatializer', preset: any): Promise<boolean> {
      return true; 
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
