export interface GbcBBox {
  left: number
  top: number
  right: number
  bottom: number
  confidence?: number | null
}

export interface GbcVertex {
  vertex_id?: string
  label?: string
  bbox?: GbcBBox
  descs?: Array<{ text?: string; kind?: string }>
  in_edges?: unknown[]
  out_edges?: unknown[]
}

export interface GbcGraph {
  vertices?: GbcVertex[]
  edges?: unknown[]
}

export interface GbcRunInput {
  folder: string
  providerId: string
  detector: 'owlv2' | 'sam3'
  versionId?: string
}

export interface GbcRunResult {
  id: string
  outputDir: string
  graphCount: number
  vertexCount: number
  summary: string
  vertices: GbcVertex[]
}
