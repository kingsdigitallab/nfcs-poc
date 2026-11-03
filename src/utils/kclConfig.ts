export const DEFAULT_KCL_API_KEY: string      = import.meta.env.VITE_KCL_API_KEY      ?? ''
export const DEFAULT_EUROPEANA_API_KEY: string = import.meta.env.VITE_EUROPEANA_API_KEY ?? ''

const ALLOWED_MODELS = new Set(['arc:nexus', 'arc:lite', 'arc:nano'])
export const APEX_MODEL = 'arc:apex'

/** All KCL/ARC model ids, small→large. Static fallback for pickers when the
 *  live /v1/models list can't be fetched (offline, no key). */
export const KCL_MODEL_IDS = ['arc:nano', 'arc:lite', 'arc:nexus', 'arc:apex'] as const

const MODEL_CHAR_LIMITS: Record<string, number> = {
  'arc:nano':  12_000,   // small model — keep conservative
  'arc:lite':  32_000,   // mid-tier
  'arc:nexus': 64_000,   // large model
  'arc:apex':  64_000,   // apex — treat same as nexus for safety
}

export function getContentMaxChars(model: string): number {
  return MODEL_CHAR_LIMITS[model] ?? 32_000  // safe default for unknown models
}

export function filterKCLModels(ids: string[], includeApex = false): string[] {
  const filtered = ids.filter(id => ALLOWED_MODELS.has(id) || (includeApex && id === APEX_MODEL))
  return filtered.length > 0 ? filtered : ids
}

// ── Image input (AI Inference by field, inputKind: 'image') ──────────────────
/** Images sent in ONE aggregate call. vLLM-backed deployments cap multi-image
 *  prompts (--limit-mm-per-prompt); keep this modest and let the user raise it. */
export const MAX_IMAGES_PER_CALL = 10
/** Long edge (px) images are downscaled to before being sent — thumbnails are
 *  what the by-field node mostly carries, and the model does not need more. */
export const DEFAULT_IMAGE_SEND_DIM = 512
/** IIIF size parameter used when the field value is a bare Image API service. */
export const DEFAULT_IMAGE_SEND_SIZE = '!512,512'
