export const DEFAULT_KCL_API_KEY: string      = import.meta.env.VITE_KCL_API_KEY      ?? ''
export const DEFAULT_EUROPEANA_API_KEY: string = import.meta.env.VITE_EUROPEANA_API_KEY ?? ''

const ALLOWED_MODELS = new Set(['arc:nexus', 'arc:lite', 'arc:nano'])
export const APEX_MODEL = 'arc:apex'

export function filterKCLModels(ids: string[], includeApex = false): string[] {
  const filtered = ids.filter(id => ALLOWED_MODELS.has(id) || (includeApex && id === APEX_MODEL))
  return filtered.length > 0 ? filtered : ids
}
