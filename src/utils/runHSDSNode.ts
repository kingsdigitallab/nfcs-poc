/**
 * HSDS runner — Heritage Science Data Service, via the same-origin proxy.
 * Shares the ARIADNE backbone API shape; built from searchRunnerFactory.
 */
import { adaptHSDSResponse, type HSDSSearchResponse } from './hsdsAdapter'
import { makeSearchRunner } from './searchRunnerFactory'

export const runHSDSNode = makeSearchRunner<HSDSSearchResponse>({
  service:    'HSDS',
  serviceUrl: 'https://hsds.ac.uk',
  publisher:  'Heritage Science Data Service',
  endpoint:   '/hsds-proxy/data-catalogue-api/api/search',
  logTag:     '[HSDS]',
  pageSize:   50,
  adapter:    adaptHSDSResponse,
  buildParams: (d, resolve) => {
    const params: Record<string, string> = {
      sort:  (d.sort as string)  || '_score',
      order: (d.order as string) || 'desc',
    }

    const q = resolve('query', 'inlineQuery')
    if (q) params.q = q

    if (d.ariadneSubject) params.ariadneSubject = d.ariadneSubject as string
    if (d.derivedSubject) params.derivedSubject = d.derivedSubject as string
    if (d.nativeSubject)  params.nativeSubject  = d.nativeSubject as string
    if (d.country)        params.country        = d.country as string
    if (d.dataType)       params.dataType       = d.dataType as string
    if (d.temporal)       params.temporal       = d.temporal as string
    if (d.contributor)    params.contributor    = d.contributor as string

    return params
  },
})
