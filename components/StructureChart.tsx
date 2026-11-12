"use client";

import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import type { CostRow, Flag, NodeKind, StructNode, Structure } from "@/contracts";
import { CostMoney } from "@/components/SourceDrawer";

import { NODE_W, edgeLabel, flagMarker, nodeHeight } from "@/components/structureChartLogic";

const KIND_STYLE: Record<NodeKind | "propco", string> = {
  investor: "border border-ink bg-sheet text-ink",
  trust: "bg-ink text-sheet",
  fund: "border border-sage bg-sage-soft text-ink",
  company: "border border-ink-soft bg-paper text-ink",
  propco: "border border-ink-soft bg-paper text-ink",
  property: "edged bg-sheet text-ink",
};

const TAX_SHORT: Record<CostRow["tax"], string> = {
  SDLT_NONRES: "SDLT",
  SDLT_RES_HIGHER: "SDLT",
  SDLT_RES_COMPANY_17: "SDLT 17%",
  STAMP_DUTY_SHARES: "Stamp duty",
  STAMP_DUTY_UNITS: "Stamp duty on units",
  CORP_TAX_RENT: "Tax on rent p.a.",
  DIVIDEND_TAX: "Dividend tax p.a.",
  INCOME_TAX_RENT: "Income tax on rent p.a.",
  ATED: "ATED p.a.",
  IHT_ENTRY: "IHT entry",
  IHT_TEN_YEAR: "IHT 10-yr",
  IHT_DEATH_COMPARATOR: "IHT death*",
};

type StructNodeData = { node: StructNode; rows: CostRow[]; option: string; flags: Flag[] };

function StructNodeView({ data }: NodeProps<Node<StructNodeData>>) {
  const { node, rows, option, flags } = data;
  const marker = flagMarker(flags);
  const byTax = new Map<string, CostRow[]>();
  for (const r of rows) byTax.set(TAX_SHORT[r.tax], [...(byTax.get(TAX_SHORT[r.tax]) ?? []), r]);
  return (
    <div className={`rounded-[3px] px-2.5 py-2 text-[12px] leading-tight ${KIND_STYLE[node.kind] ?? KIND_STYLE.company}`} style={{ width: NODE_W }}>
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" />
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 font-semibold">
          {marker && (
            <span
              title={flags.map((f) => f.message).join("\n")}
              className={`nodrag nopan mr-1 inline-block rounded-[2px] px-1 text-[10px] font-bold leading-snug ${marker === "!" ? "bg-ink text-sheet ring-1 ring-sheet" : "bg-sheet text-ink ring-1 ring-rule"}`}
              style={{ pointerEvents: "all" }}
            >
              {marker}
            </span>
          )}
          {node.label}
        </span>
        {node.jurisdiction && <span className="shrink-0 text-[10px] opacity-60">{node.jurisdiction}</span>}
      </div>
      {byTax.size > 0 && (
        // React Flow sets pointer-events:none on non-selectable nodes; re-enable it so £ badges open the SourceDrawer.
        <div className="nodrag nopan pointer-events-auto mt-1 flex flex-wrap gap-1" style={{ pointerEvents: "all" }}>
          {[...byTax.entries()].map(([label, rs]) => (
            <span key={label} className="tabular rounded-[2px] bg-sheet px-1 py-px text-[11px] text-ink ring-1 ring-rule">
              {label} <CostMoney title={`Option ${option} · ${label} · ${node.label}`} rows={rs} />
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" />
    </div>
  );
}

const nodeTypes = { struct: StructNodeView };

function layout(structure: Structure, rows: CostRow[], flags: Flag[]): { nodes: Node<StructNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 14, ranksep: 28, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));
  const rowsOf = (id: string) => rows.filter((r) => r.entity_id === id && r.option === structure.option);
  const heights = new Map<string, number>();
  for (const n of structure.nodes) {
    const h = nodeHeight(new Set(rowsOf(n.id).map((r) => TAX_SHORT[r.tax])).size);
    heights.set(n.id, h);
    g.setNode(n.id, { width: NODE_W, height: h });
  }
  for (const e of structure.edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const nodes = structure.nodes.map((n) => {
    const pos = g.node(n.id);
    const h = heights.get(n.id)!;
    return {
      id: n.id,
      type: "struct",
      position: { x: pos.x - NODE_W / 2, y: pos.y - h / 2 },
      data: { node: n, option: structure.option, rows: rowsOf(n.id), flags: flags.filter((f) => f.entity_id === n.id && f.option === structure.option) },
      draggable: false,
    };
  });
  const kindOf = new Map(structure.nodes.map((n) => [n.id, n.kind as string]));
  const edges = structure.edges.map((e, i) => ({
    id: `${e.from}-${e.to}-${i}`,
    source: e.from,
    target: e.to,
    label: edgeLabel(kindOf.get(e.from) ?? "", kindOf.get(e.to) ?? "", e.pct) || undefined,
    
    labelStyle: { fontSize: 11, fill: "#17262a", fontWeight: 600 },
  }));
  return { nodes, edges };
}

export function StructureChart({ structure, rows, flags = [], large = false }: { structure: Structure; rows: CostRow[]; flags?: Flag[]; large?: boolean }) {
  const { nodes, edges } = useMemo(() => layout(structure, rows, flags), [structure, rows, flags]);
  return (
    <div className="flex h-full w-full flex-col">
    <div className="survey-grid min-h-0 flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: large ? 0.12 : 0.06, maxZoom: large ? 1.6 : 1.1 }}
        key={`${structure.option}-${large}`}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        
      </ReactFlow>
    </div>
    <p className="mt-1 text-[11px] text-ink-soft">p.a. = every year · * comparator, not a cost of this option</p>
    </div>
  );
}
