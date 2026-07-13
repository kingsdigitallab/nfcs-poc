/**
 * ARIADNE portal runner — CORS open, direct browser fetch (no proxy needed).
 * Built from searchRunnerFactory; only the endpoint, adapter, citation
 * metadata and filter params are service-specific.
 */
import { adaptARIADNEResponse, type ARIADNESearchResponse } from './ariadneAdapter'
import { makeSearchRunner } from './searchRunnerFactory'

export const runARIADNENode = makeSearchRunner<ARIADNESearchResponse>({
  service:    'ARIADNE',
  serviceUrl: 'https://portal.ariadne-infrastructure.eu',
  publisher:  'ARIADNE Research Infrastructure',
  endpoint:   'https://portal.ariadne-infrastructure.eu/api/search',
  logTag:     '[ARIADNE]',
  pageSize:   50,
  adapter:    adaptARIADNEResponse,
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
