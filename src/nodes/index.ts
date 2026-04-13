import { ParamNode } from './ParamNode'
import { GBIFSearchNode } from './GBIFSearchNode'
import { LLDSSearchNode } from './LLDSSearchNode'
import { ADSSearchNode }  from './ADSSearchNode'
import { MDSSearchNode }  from './MDSSearchNode'
import { TableOutputNode } from './TableOutputNode'
import { JSONOutputNode }  from './JSONOutputNode'
import { MapOutputNode }      from './MapOutputNode'
import { TimelineOutputNode } from './TimelineOutputNode'

export const nodeTypes = {
  param:       ParamNode,
  gbifSearch:  GBIFSearchNode,
  lldsSearch:  LLDSSearchNode,
  adsSearch:   ADSSearchNode,
  mdsSearch:   MDSSearchNode,
  tableOutput: TableOutputNode,
  jsonOutput:  JSONOutputNode,
  mapOutput:      MapOutputNode,
  timelineOutput: TimelineOutputNode,
}
