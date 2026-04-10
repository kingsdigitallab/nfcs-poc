import { ParamNode } from './ParamNode'
import { GBIFSearchNode } from './GBIFSearchNode'
import { LLDSSearchNode } from './LLDSSearchNode'
import { ADSSearchNode } from './ADSSearchNode'
import { TableOutputNode } from './TableOutputNode'
import { JSONOutputNode } from './JSONOutputNode'

export const nodeTypes = {
  param:       ParamNode,
  gbifSearch:  GBIFSearchNode,
  lldsSearch:  LLDSSearchNode,
  adsSearch:   ADSSearchNode,
  tableOutput: TableOutputNode,
  jsonOutput:  JSONOutputNode,
}
