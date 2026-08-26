// Pluggable realtime backend contract.
//
// The whole app talks to the backend through the fb* facade (../firebase.ts),
// which delegates to whichever Backend the injection is configured to use. A
// Backend is a small path-addressed tree store with realtime subscribe — the
// exact shape of Firebase RTDB, which is what all callers were written against:
//
//   1-level  `col`         -> whole collection, read as { id: value }
//   2-level  `col/{id}`    -> a single node's value
//   3-level  `col/{a}/{b}` -> a single leaf's value; `col/{a}` reads as { b: value }
//
// Adapters only implement transport; the facade adds error-swallowing + retry so
// a flaky network never throws into UI code.

export interface FbSub { close(): void }

export interface Backend {
  get<T>(path: string): Promise<T | null>;
  put(path: string, data: any): Promise<void>;
  patch(path: string, data: any): Promise<void>;
  delete(path: string): Promise<void>;
  listen(path: string, onEvent: (data: any) => void): FbSub;
  // True when `url` is this backend's own DB/signaling traffic, so networksync
  // can skip capturing the agent's own requests as if they were app traffic.
  ownsUrl(url: string): boolean;
}

export interface BackendConfig {
  backend: 'firebase' | 'relay' | 'cloudbase';
  // firebase: { databaseURL }
  // relay:    { url }  (http(s) origin of the relay server)
  // cloudbase:{ env, region? }
  [k: string]: any;
}
