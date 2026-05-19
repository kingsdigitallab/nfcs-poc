/**
 * Module-level registry so outside callers (like the ToolbarNode
 * rendered by withToolbar) can trigger the actual collapse/expand logic
 * living inside the GroupNode component.
 */

const _registry = new Map<string, () => void>()

export function registerToggle(id: string, fn: () => void) {
  _registry.set(id, fn)
}
export function invokeToggle(id: string) {
  _registry.get(id)?.()
}