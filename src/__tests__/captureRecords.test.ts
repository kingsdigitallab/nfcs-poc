import { describe, it, expect } from 'vitest'
import { buildCaptureRecord, isCaptureRecord, appendCaptures, resolveCaptureTarget, removeCapture, nextRegionNumber, type CaptureMeta } from '../utils/captureRecords'
import type { IiifEntry } from '../utils/iiifEntries'

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
  entryUrl: smgRecord.smg.manifest, entryKind: 'manifest', canvasKey: 'https://zoom.sciencemuseumgroup.org.uk/iiif/3/534',
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

  it('records where it came from so the gallery can navigate back (underscored: URLs look like image fields)', () => {
    expect(rec).toMatchObject({ _captureEntryUrl: smgRecord.smg.manifest, _captureEntryKind: 'manifest', _captureCanvasKey: meta.canvasKey })
    expect(Object.keys(rec).filter(k => /^capture(Entry|Canvas)/.test(k))).toEqual([])
  })

  it('carries a _captureThumb only when a thumb was made (underscore: the image pickers must skip it)', () => {
    expect(rec).not.toHaveProperty('_captureThumb')
    const withThumb = buildCaptureRecord(PNG, { ...meta, thumbDataUrl: 'data:image/jpeg;base64,THUMB' })
    expect(withThumb._captureThumb).toBe('data:image/jpeg;base64,THUMB')
    // content is inserted before the thumb so auto-detect still picks the full crop
    expect(Object.keys(withThumb).indexOf('content')).toBeLessThan(Object.keys(withThumb).indexOf('_captureThumb'))
  })
})

describe('resolveCaptureTarget', () => {
  const rec = buildCaptureRecord(PNG, { ...meta, canvasIndex: 2 })
  const entry: IiifEntry = { kind: 'manifest', url: smgRecord.smg.manifest, label: 'Amazon', source: 'Science Museum Group', recordIndex: 0, record: smgRecord }

  it('returns the upstream entry (same object) with canvas index, canvas key and region', () => {
    const t = resolveCaptureTarget(rec, [entry])
    expect(t).not.toBeNull()
    expect(t!.entry).toBe(entry)
    expect(t).toMatchObject({ url: smgRecord.smg.manifest, kind: 'manifest', canvasIndex: 2, canvasKey: meta.canvasKey, region: meta.region })
  })

  it('falls back to the stored kind when the record is no longer upstream', () => {
    const t = resolveCaptureTarget(rec, [])
    expect(t!.entry).toBeUndefined()
    expect(t!.kind).toBe('manifest')
    const img = buildCaptureRecord(PNG, { ...meta, entryKind: 'image', entryUrl: 'https://framemark.vam.ac.uk/collections/2016JG8103' })
    expect(resolveCaptureTarget(img, [])).toMatchObject({ kind: 'image', url: 'https://framemark.vam.ac.uk/collections/2016JG8103' })
  })

  it('is null for a legacy capture without navigation keys', () => {
    const legacy = { ...rec }
    delete legacy._captureEntryUrl
    expect(resolveCaptureTarget(legacy, [entry])).toBeNull()
    expect(resolveCaptureTarget({ title: 'not a capture' }, [entry])).toBeNull()
  })
})

describe('removeCapture', () => {
  const a = buildCaptureRecord(PNG, meta)
  const b = buildCaptureRecord(PNG, { ...meta, seq: 2 })
  const c = buildCaptureRecord(PNG, { ...meta, seq: 3 })

  it('drops exactly the capture with that _id and keeps the order', () => {
    expect(removeCapture([a, b, c], String(b._id)).map(r => r._id)).toEqual([a._id, c._id])
  })

  it('is a no-op for an unknown id or an empty collection', () => {
    expect(removeCapture([a, b], 'nope')).toHaveLength(2)
    expect(removeCapture(undefined, String(a._id))).toEqual([])
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

describe('nextRegionNumber', () => {
  const cap = (title: string) => buildCaptureRecord(PNG, { ...meta, regionLabel: title })

  it('starts at 1 with no captures and no pending regions', () => {
    expect(nextRegionNumber([], [])).toBe(1)
  })

  it('is max + 1 over captures and pending regions, so a removed capture never frees its number', () => {
    expect(nextRegionNumber([cap('Region 1'), cap('Region 3')], [{ label: 'Region 4' }])).toBe(5)
    expect(nextRegionNumber([cap('Region 2')], [])).toBe(3)
    expect(nextRegionNumber([], [{ label: 'Region 1' }, { label: 'Region 2' }])).toBe(3)
  })

  it('ignores titles that are not Region n (full-canvas captures, renamed regions)', () => {
    expect(nextRegionNumber([cap('Full canvas'), cap('p. 12')], [{ label: 'Detail' }])).toBe(1)
    expect(nextRegionNumber([cap('Region 7'), cap('Region seven')], [])).toBe(8)
  })
})
