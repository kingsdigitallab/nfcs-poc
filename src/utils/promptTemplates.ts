/**
 * promptTemplates — the single home for {{token}} prompt substitution.
 *
 * Previously copy-pasted across every LLM runner and component (KCL, Ollama,
 * Evaluator, and both field-mode variants). Centralised so token behaviour
 * stays consistent and so future cross-cutting tokens have one injection
 * point.
 *
 * TODO(context-accrual): reserved token {{_lineage}} — when the workflow
 * context-accrual mechanism lands (docs/context-accrual.md), renderTemplate
 * gains an optional lineage argument and substitutes a natural-language
 * summary of the upstream pipeline here. All LLM nodes inherit it for free.
 *
 * NOTE: no truncation happens here. Content truncation is model-dependent
 * (getContentMaxChars in kclConfig.ts) and stays in the runners, applied
 * BEFORE substitution (CLAUDE.md gotcha 19).
 */

/**
 * Generic substitution: every {{key}} resolves against the record.
 * Objects/arrays are JSON-stringified; null/undefined become ''.
 * Callers add synthetic tokens by spreading extras into the record argument
 * (e.g. {...record, content: baseContent} or {...record, __reference, __candidate}).
 */
export function renderTemplate(template: string, record: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = record[key]
    if (val === undefined || val === null) return ''
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  })
}

/**
 * Field-node aggregate mode: {{values}} / {{value}} both resolve to the
 * joined value block, {{field}} to the field name, {{count}} to the number
 * of aggregated records. No generic record tokens — there is no single
 * record in aggregate mode.
 */
export function renderFieldTemplateAggregate(
  template: string,
  ctx: { values: string; field: string; count: number },
): string {
  return template
    .replace(/\{\{values\}\}/g, () => ctx.values)
    .replace(/\{\{field\}\}/g,  () => ctx.field)
    .replace(/\{\{value\}\}/g,  () => ctx.values)
    .replace(/\{\{count\}\}/g,  String(ctx.count))
}

/**
 * Field-node per-record mode: {{value}} is the (possibly truncated) field
 * value, {{field}} the field name, and any remaining {{key}} resolves
 * against the record as a plain string ('' for null/undefined — field-node
 * templates never JSON-stringify).
 */
export function renderFieldTemplatePerRecord(
  template: string,
  ctx: { value: string; field: string; record: Record<string, unknown> },
): string {
  return template
    .replace(/\{\{value\}\}/g, () => ctx.value)
    .replace(/\{\{field\}\}/g, () => ctx.field)
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(ctx.record[k] ?? ''))
}
