// Stub - plugin-host-services not in Ciutatis V1 scope
// This file exists only to satisfy upstream imports

import type { Db } from "@paperclipai/db";
import type { HostServices } from "@paperclipai/plugin-sdk";

export interface PluginHostService {
  registerHost(): Promise<void>;
  unregisterHost(): Promise<void>;
}

export function pluginHostService(_db: Db): PluginHostService {
  return {
    async registerHost() {
      // No-op - feature not in V1
    },
    async unregisterHost() {
      // No-op - feature not in V1
    },
  };
}

// Additional exports required by upstream app.ts
export function buildHostServices(
  _db: Db,
  _pluginId: string,
  _manifestId: string,
  _eventBus: unknown,
  _notifyWorker: (method: string, params: unknown) => void,
  _options: { pluginWorkerManager: unknown; manifest: unknown },
): HostServices & { dispose(): Promise<void> } {
  return {
    config: { get: async () => ({}) },
    localFolders: {
      declarations: async () => ({ folders: [] }),
      configure: async () => ({ folder: null }),
      status: async () => ({ status: "not_configured" as const }),
      list: async () => ({ entries: [] }),
      readText: async () => ({ content: null }),
      writeTextAtomic: async () => ({ success: false }),
    },
    state: {
      get: async () => ({ value: null }),
      set: async () => {},
      delete: async () => {},
    },
    db: {
      namespace: async () => ({ namespace: "", tables: [] }),
      query: async () => ({ rows: [] }),
      execute: async () => ({ rowCount: 0 }),
    },
    entities: {
      upsert: async () => ({ entity: null }),
      list: async () => ({ entities: [] }),
    },
    events: {
      emit: async () => {},
      subscribe: async () => {},
    },
    http: {
      fetch: async () => ({ status: 200, headers: {}, body: {} }),
    },
    secrets: {
      resolve: async () => "",
    },
    activity: {
      log: async () => {},
    },
    metrics: {
      write: async () => {},
    },
    logger: {
      log: async () => {},
    },
    dispose: async () => {
      // No-op cleanup
    },
  } as unknown as HostServices & { dispose(): Promise<void> };
}

export function flushPluginLogBuffer() {
  // No-op - feature not in V1
}
