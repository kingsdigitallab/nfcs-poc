import { describe, it, expect } from 'vitest'
import { buildCaptureRecord, isCaptureRecord, appendCaptures, type CaptureMeta } from '../utils/captureRecords'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const smgRecord = {
  id: 'smg:co49346', _source: 'smg', title: "'Amazon' open-end drying tumbler", description: 'A gas-heated tumbler made in 1960.',
  _sourceUrl: 'https://collection.sciencemuseumgroup.org.uk/objects/co49346', _pid: 'co49346',
  smg: { accessionNumber: '1999-1', thumbnail: 'https://coimages.sciencemuseumgroup.org.uk/x.jpg', manifest: 'https://collection.sciencemuseumgroup.org.uk/iiif/objects/co49346' },
}
const meta: CaptureMeta = {
  nodeId: 'img-1', seq: 1700000000000, regionIndex: 0, region: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, regionLabel: 'Region 1',
  canvasLabel: '', canvasIndex: 0, canvasCount: 1, sourceRecord: smgRecord,
  sourceLabel: "Science Museum Group · 'Amazon' open-end drying tumbler", manifestTitle: 'Amazon tumbler', manifestProvider: 'Science Museum Group',
}

describe('buildCaptureRecord', () => {
  const rec = buildCaptureRecord(PNG, meta)

  it('is an image record the AI nodes can send, titled by region', () => {
    expect(rec).toMatchObject({ content: PNG, contentType: 'image', mimeType: 'image/png', title: 'Region 1', _source: 'imageView',
      regionIndex: 0, regionBounds: meta.region, canvasIndex: 0, canvasLabel: '', manifestTitle: 'Amazon tumbler', manifestProvider: 'Science Museum Group' })
    expect(isCaptureRecord(rec)).toBe(true)
  })

  it('description is the capture label (what vision-mode {{content}} renders); the parent description moves aside', () => {
    expect(rec.description).toBe("Science Museum Group · 'Amazon' open-end drying tumbler · canvas 1/1 · Region 1")
    expect(rec.sourceDescription).toBe('A gas-heated tumbler made in 1960.')
    expect(rec.captureSource).toBe('Science Museum Group')
    expect(rec.captureRecordTitle).toBe("'Amazon' open-end drying tumbler")
    expect(typeof rec.capturedAt).toBe('string')
  })

  it('carries the source record provenance and a unique _id per capture and region', () => {
    expect(rec).toMatchObject({ id: 'smg:co49346', _sourceUrl: smgRecord._sourceUrl, _pid: 'co49346', _origin: 'smg' })
    expect((rec.smg as Record<string, unknown>).accessionNumber).toBe('1999-1')
    expect(rec._id).toBe('img-1_cap_1700000000000_0')
    const later = buildCaptureRecord(PNG, { ...meta, seq: 1700000000001, regionIndex: 2 })
    expect(later._id).toBe('img-1_cap_1700000000001_2')
  })

  it('works without a source record (manual manifest URL)', () => {
    const r = buildCaptureRecord(PNG, { ...meta, sourceRecord: undefined, sourceLabel: 'Manual URL' })
    expect(r.description).toBe('Manual URL · canvas 1/1 · Region 1')
    expect(r.id).toBeUndefined()
  })
})

describe('appendCaptures', () => {
  const a = buildCaptureRecord(PNG, meta)
  const b = buildCaptureRecord(PNG, { ...meta, seq: 2, regionIndex: 1, regionLabel: 'Region 2' })

  it('appends to an existing collection', () => {
    expect(appendCaptures([a], [b]).map(r => r._id)).toEqual([a._id, b._id])
  })

  it('drops a non-capture record left by Images mode and starts the collection', () => {
    const single = { content: PNG, contentType: 'image', title: 'Stonehenge', _source: 'imageView' }
    expect(isCaptureRecord(single)).toBe(false)
    expect(appendCaptures([single], [a]).map(r => r._id)).toEqual([a._id])
    expect(appendCaptures(undefined, [a])).toHaveLength(1)
  })
})
