"use client";

import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import type { CostRow, NodeKind, StructNode, Structure } from "@/contracts";
import { CostMoney } from "@/components/SourceDrawer";

const NODE_W = 170;
const NODE_H = 56;

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

type StructNodeData = { node: StructNode; rows: CostRow[]; option: string };

function StructNodeView({ data }: NodeProps<Node<StructNodeData>>) {
  const { node, rows, option } = data;
  const byTax = new Map<string, CostRow[]>();
  for (const r of rows) byTax.set(TAX_SHORT[r.tax], [...(byTax.get(TAX_SHORT[r.tax]) ?? []), r]);
  return (
    <div className={`rounded-[3px] px-2.5 py-2 text-[12px] leading-tight ${KIND_STYLE[node.kind] ?? KIND_STYLE.company}`} style={{ width: NODE_W }}>
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" />
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 font-semibold">{node.label}</span>
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

function layout(structure: Structure, rows: CostRow[]): { nodes: Node<StructNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 14, ranksep: 28, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of structure.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of structure.edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const nodes = structure.nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: "struct",
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: { node: n, option: structure.option, rows: rows.filter((r) => r.entity_id === n.id && r.option === structure.option) },
      draggable: false,
    };
  });
  const edges = structure.edges.map((e, i) => ({
    id: `${e.from}-${e.to}-${i}`,
    source: e.from,
    target: e.to,
    label: e.pct < 100 ? `${e.pct}%` : undefined,
    
    labelStyle: { fontSize: 11, fill: "#17262a", fontWeight: 600 },
  }));
  return { nodes, edges };
}

export function StructureChart({ structure, rows, large = false }: { structure: Structure; rows: CostRow[]; large?: boolean }) {
  const { nodes, edges } = useMemo(() => layout(structure, rows), [structure, rows]);
  return (
    <div className="survey-grid h-full w-full">
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
  );
}
