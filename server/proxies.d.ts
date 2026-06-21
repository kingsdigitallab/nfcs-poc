import type { IncomingMessage, ServerResponse } from 'http'

export type ConnectNext = () => void
export type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: ConnectNext,
) => void | Promise<void>

export interface ProxyEntry {
  prefix:   string
  target:   string
  rewrite:  (path: string) => string
  headers?: Record<string, string>
}

export declare const PROXY_TABLE: ProxyEntry[]
export declare function makeViteProxyConfig(): Record<string, unknown>

export declare const adsLibrarySearchMiddleware:   ConnectMiddleware
export declare const adsCatalogueSearchMiddleware: ConnectMiddleware
export declare const lldsSearchMiddleware:         ConnectMiddleware
export declare const urlProxyMiddleware:           ConnectMiddleware
