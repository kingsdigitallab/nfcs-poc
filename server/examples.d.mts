import type { ConnectMiddleware } from './proxies.mjs'

export declare const SLUG_RE: RegExp

export declare class ExampleError extends Error {
  status: number
  constructor(status: number, message: string)
}

export interface ExampleManifestEntry {
  slug:        string
  title:       string
  description: string
  group?:      string
}

export interface ExampleWriteBody {
  slug:         string
  title:        string
  description?: string
  group?:       string
  workflow:     { nodes: unknown[]; [key: string]: unknown }
}

export declare function rebuildManifest(dir: string): ExampleManifestEntry[]
export declare function writeExample(dir: string, body: ExampleWriteBody): string
export declare function deleteExample(dir: string, slug: string): string
export declare function exampleAuthoringMiddleware(dir: string): ConnectMiddleware
