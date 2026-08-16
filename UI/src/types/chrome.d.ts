// Chrome Extension API type declarations
declare namespace chrome {
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
    }

    function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    // Support both Promise (MV3 polyfills) and callback styles
    function sendMessage(tabId: number, message: any): Promise<any>;
    function sendMessage(tabId: number, message: any, responseCallback: (response: any) => void): void;
  }

  namespace runtime {
    function sendMessage(message: any): Promise<any>;
    const onMessage: {
      addListener(
        callback: (request: any, sender: { tab?: chrome.tabs.Tab } | any, sendResponse: (response?: any) => void) => void,
      ): void;
      removeListener(
        callback: (request: any, sender: { tab?: chrome.tabs.Tab } | any, sendResponse: (response?: any) => void) => void,
      ): void;
    };
    const lastError: {
      message: string;
    } | undefined;
  }

  namespace tabCapture {
    function capture(
      options: { audio: boolean; video: boolean },
      callback: (stream: MediaStream | null) => void,
    ): void;
  }

  namespace scripting {
    function executeScript(
      details: { target: { tabId: number }; files: string[] },
      callback?: (injectionResults: any[]) => void,
    ): void;
  }
}

declare const chrome: typeof chrome;
