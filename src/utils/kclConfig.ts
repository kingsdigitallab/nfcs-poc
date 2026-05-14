export const DEFAULT_KCL_API_KEY: string = import.meta.env.VITE_KCL_API_KEY ?? ''

const ALLOWED_MODELS = new Set(['arc:nexus', 'arc:lite', 'arc:nano'])

export function filterKCLModels(ids: string[]): string[] {
  const filtered = ids.filter(id => ALLOWED_MODELS.has(id))
  return filtered.length > 0 ? filtered : ids
}
