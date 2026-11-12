"use client";

import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import type { CostRow, NodeKind, StructNode, Structure } from "@/contracts";
import { CostMoney } from "@/components/SourceDrawer";

const NODE_W = 170;
const NODE_H = 50;

const KIND_STYLE: Record<NodeKind | "propco", string> = {
  investor: "border-slate-300 bg-slate-50 text-slate-800",
  trust: "border-purple-300 bg-purple-50 text-purple-900",
  fund: "border-teal-300 bg-teal-50 text-teal-900",
  company: "border-blue-300 bg-blue-50 text-blue-900",
  propco: "border-blue-300 bg-blue-50 text-blue-900",
  property: "border-amber-300 bg-amber-50 text-amber-900",
};

const TAX_SHORT: Record<CostRow["tax"], string> = {
  SDLT_NONRES: "SDLT",
  SDLT_RES_HIGHER: "SDLT",
  SDLT_RES_COMPANY_17: "SDLT 17%",
  STAMP_DUTY_SHARES: "Stamp duty",
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
    <div className={`rounded-lg border px-2 py-1.5 text-[11px] leading-tight shadow-sm ${KIND_STYLE[node.kind] ?? KIND_STYLE.company}`} style={{ width: NODE_W }}>
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-slate-300" />
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 font-medium">{node.label}</span>
        {node.jurisdiction && <span className="shrink-0 rounded bg-white/70 px-1 text-[9px] text-slate-500">{node.jurisdiction}</span>}
      </div>
      {byTax.size > 0 && (
        <div className="nodrag nopan mt-1 flex flex-wrap gap-1">
          {[...byTax.entries()].map(([label, rs]) => (
            <span key={label} className="rounded bg-white px-1 py-px text-[10px] text-slate-700 ring-1 ring-slate-200">
              {label} <CostMoney title={`Option ${option} · ${label} · ${node.label}`} rows={rs} />
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-slate-300" />
    </div>
  );
}

const nodeTypes = { struct: StructNodeView };

function layout(structure: Structure, rows: CostRow[]): { nodes: Node<StructNodeData>[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 10, ranksep: 22, marginx: 8, marginy: 8 });
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
    style: { stroke: "#94a3b8" },
    labelStyle: { fontSize: 10, fill: "#64748b" },
  }));
  return { nodes, edges };
}

export function StructureChart({ structure, rows }: { structure: Structure; rows: CostRow[] }) {
  const { nodes, edges } = useMemo(() => layout(structure, rows), [structure, rows]);
  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.06, maxZoom: 1.1 }}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        <Background gap={16} color="#f1f5f9" />
      </ReactFlow>
    </div>
  );
}
