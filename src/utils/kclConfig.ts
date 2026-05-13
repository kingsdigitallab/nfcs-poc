export const DEFAULT_KCL_API_KEY = 'sk-C80102foRxkyBAtkrze6-Q'

const BLOCKED_MODELS = new Set(['arc:apex'])

export function filterKCLModels(ids: string[]): string[] {
  return ids.filter(id => !BLOCKED_MODELS.has(id))
}
