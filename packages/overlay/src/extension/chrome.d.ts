/**
 * The slice of the `chrome.*` extension API the CRT extension uses (PRD-extension F-154), typed by
 * hand so the overlay package takes on no dependency for it. Promise forms only (Manifest V3).
 */
declare namespace chrome {
  namespace runtime {
    const id: string;
    interface MessageSender {
      id?: string;
      tab?: tabs.Tab;
      url?: string;
      frameId?: number;
    }
    interface Port {
      name: string;
      sender?: MessageSender;
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: Event<(message: unknown) => void>;
      onDisconnect: Event<() => void>;
    }
    interface Event<F> {
      addListener(fn: F): void;
      removeListener(fn: F): void;
    }
    interface Manifest {
      version: string;
      name: string;
    }
    function getManifest(): Manifest;
    function getURL(path: string): string;
    function sendMessage(message: unknown): Promise<unknown>;
    function connect(info: { name: string }): Port;
    function openOptionsPage(): Promise<void>;
    const onMessage: Event<(message: unknown, sender: MessageSender, reply: (answer: unknown) => void) => boolean | void>;
    const onConnect: Event<(port: Port) => void>;
    const onInstalled: Event<() => void>;
  }
  namespace tabs {
    interface Tab {
      id?: number;
      windowId: number;
      url?: string;
    }
    function captureVisibleTab(windowId: number, options: { format: "png" | "jpeg" }): Promise<string>;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
    function query(info: { url?: string | string[] }): Promise<Tab[]>;
    const onRemoved: runtime.Event<(tabId: number) => void>;
  }
  namespace action {
    const onClicked: runtime.Event<(tab: tabs.Tab) => void>;
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
    function setTitle(details: { title: string; tabId?: number }): Promise<void>;
  }
  namespace permissions {
    function contains(p: { origins: string[] }): Promise<boolean>;
    function request(p: { origins: string[] }): Promise<boolean>;
    function remove(p: { origins: string[] }): Promise<boolean>;
  }
  namespace scripting {
    interface RegisteredContentScript {
      id: string;
      matches?: string[];
      js?: string[];
      runAt?: "document_start" | "document_end" | "document_idle";
      world?: "ISOLATED" | "MAIN";
      allFrames?: boolean;
      persistAcrossSessions?: boolean;
    }
    function registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
    function unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
    function getRegisteredContentScripts(filter?: { ids: string[] }): Promise<RegisteredContentScript[]>;
    function executeScript(injection: { target: { tabId: number }; files: string[]; world?: "ISOLATED" | "MAIN"; injectImmediately?: boolean }): Promise<unknown>;
  }
  namespace storage {
    interface Area {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: Area;
    const session: Area;
  }
}
