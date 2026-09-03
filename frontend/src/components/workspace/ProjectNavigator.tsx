import React, { useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Factory,
  FolderTree,
  Gauge,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useDomain, type DomainLevel, type DomainNode } from '../../contexts/DomainContext';

const LEVEL_LABEL: Record<DomainLevel, string> = {
  project: 'Project',
  plant: 'Plant',
  area: 'Area',
  unit: 'Unit',
};

const LEVEL_ICON: Record<DomainLevel, React.ElementType> = {
  project: FolderTree,
  plant: Factory,
  area: Building2,
  unit: Gauge,
};

const NEXT_LABEL: Record<DomainLevel, string | null> = {
  project: 'Plant',
  plant: 'Area',
  area: 'Unit',
  unit: null,
};

interface NodeRowProps {
  node: DomainNode;
  depth: number;
  selectedUnitId: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelectUnit: (id: string) => void;
  onAddChild: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

const NodeRow: React.FC<NodeRowProps> = ({
  node,
  depth,
  selectedUnitId,
  expanded,
  onToggle,
  onSelectUnit,
  onAddChild,
  onRename,
  onDelete,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.name);
  const hasChildren = !!node.children?.length;
  const isExpanded = expanded.has(node.id);
  const isSelected = node.level === 'unit' && node.id === selectedUnitId;
  const Icon = LEVEL_ICON[node.level];
  const nextLabel = NEXT_LABEL[node.level];

  const commit = () => {
    onRename(node.id, draft);
    setEditing(false);
  };

  return (
    <div>
      <div
        className={`group mx-2 grid h-9 grid-cols-[18px_1fr_auto] items-center gap-1 rounded-lg pr-2 text-sm transition-all ${
          isSelected ? 'tpi-tree-selected font-medium text-[#073b62]' : 'text-[#334155] hover:bg-white hover:shadow-sm'
        }`}
        style={{ paddingLeft: 10 + depth * 16 }}
      >
        <button
          className="flex h-5 w-5 items-center justify-center text-[#64748b]"
          onClick={() => hasChildren && onToggle(node.id)}
          title={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : ''}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : null}
        </button>

        <button
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={() => node.level === 'unit' ? onSelectUnit(node.id) : onToggle(node.id)}
          onDoubleClick={() => setEditing(true)}
        >
          <Icon className={`h-4 w-4 shrink-0 ${isSelected ? 'text-[#0b65a7]' : 'text-[#64748b]'}`} />
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={event => {
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') {
                  setDraft(node.name);
                  setEditing(false);
                }
              }}
              className="h-6 min-w-0 flex-1 rounded border border-[#93b7d6] bg-white px-2 text-sm outline-none"
            />
          ) : (
            <span className="truncate">{node.name}</span>
          )}
        </button>

        <div className="hidden items-center gap-1 group-hover:flex">
          {nextLabel && (
            <button
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-white"
              onClick={() => onAddChild(node.id)}
              title={`Add ${nextLabel}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-white"
            onClick={() => setEditing(true)}
            title={`Rename ${LEVEL_LABEL[node.level]}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {node.level !== 'project' && (
            <button
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-white"
              onClick={() => onDelete(node.id)}
              title={`Delete ${LEVEL_LABEL[node.level]}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {hasChildren && isExpanded && node.children!.map(child => (
        <NodeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedUnitId={selectedUnitId}
          expanded={expanded}
          onToggle={onToggle}
          onSelectUnit={onSelectUnit}
          onAddChild={onAddChild}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};

const expandableIds = (nodes: DomainNode[]): string[] =>
  nodes.flatMap(node => [
    ...(node.children?.length ? [node.id] : []),
    ...expandableIds(node.children || []),
  ]);

const ProjectNavigator: React.FC = () => {
  const { tree, selectedUnitId, selected, selectUnit, addProject, addChild, renameNode, deleteNode } = useDomain();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(expandableIds(tree)));

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddChild = (id: string) => {
    addChild(id);
    setExpanded(prev => new Set(prev).add(id));
  };

  return (
    <aside className="tpi-project-rail flex w-[320px] shrink-0 flex-col text-[#1f2933]">
      <div className="border-b border-slate-200/80 px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold"><FolderTree className="h-4 w-4 text-[#0f6fa8]" /> Project space</div>
            <div className="mt-1 text-[11px] text-[#64748b]">Structured engineering context</div>
          </div>
          <button
            onClick={addProject}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[#0f6fa8]/15 bg-white px-3 text-xs font-semibold text-[#0f5f99] shadow-sm transition hover:-translate-y-px hover:shadow-md"
          >
            <Plus className="h-3.5 w-3.5" />
            Project
          </button>
        </div>
      </div>

      <div className="tpi-scroll-contained min-h-0 flex-1 overflow-auto py-3">
        {tree.map(node => (
          <NodeRow
            key={node.id}
            node={node}
            depth={0}
            selectedUnitId={selectedUnitId}
            expanded={expanded}
            onToggle={toggle}
            onSelectUnit={selectUnit}
            onAddChild={handleAddChild}
            onRename={renameNode}
            onDelete={deleteNode}
          />
        ))}
      </div>

      <div className="m-3 rounded-xl border border-[#0f6fa8]/10 bg-white/80 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0f6fa8]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" /> Active unit</div>
        <div className="mt-1.5 truncate text-sm font-semibold text-[#0f3554]" title={selected.displayPath}>
          {selected.displayPath}
        </div>
      </div>
    </aside>
  );
};

export default ProjectNavigator;
