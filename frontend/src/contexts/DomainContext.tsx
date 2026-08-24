import React, { createContext, useContext, useMemo, useState } from 'react';

export type DomainLevel = 'project' | 'plant' | 'area' | 'unit';

export interface DomainNode {
  id: string;
  name: string;
  level: DomainLevel;
  children?: DomainNode[];
}

interface DomainSelection {
  project: DomainNode;
  plant: DomainNode;
  area: DomainNode;
  unit: DomainNode;
  projectId: string;
  displayPath: string;
  areaCode: string;
}

interface DomainContextType {
  tree: DomainNode[];
  selectedUnitId: string;
  selected: DomainSelection;
  selectUnit: (unitId: string) => void;
  addProject: () => void;
  addChild: (parentId: string) => void;
  renameNode: (nodeId: string, name: string) => void;
  deleteNode: (nodeId: string) => void;
}

const STORAGE_KEY = 'tpi_domain_tree';
const SELECTED_KEY = 'tpi_domain_selected_unit';

const createId = () => `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_TREE: DomainNode[] = [
  {
    id: 'project_p11671_bab',
    name: 'P11671_BAB',
    level: 'project',
    children: [
      {
        id: 'plant_11',
        name: '11',
        level: 'plant',
        children: [
          {
            id: 'area_28',
            name: '28',
            level: 'area',
            children: [
              { id: 'unit_1378p', name: '1378P', level: 'unit', children: [] },
            ],
          },
        ],
      },
    ],
  },
];

const LEVEL_CHILD: Record<DomainLevel, DomainLevel | null> = {
  project: 'plant',
  plant: 'area',
  area: 'unit',
  unit: null,
};

const LEVEL_LABEL: Record<DomainLevel, string> = {
  project: 'Project',
  plant: 'Plant',
  area: 'Area',
  unit: 'Unit',
};

function clone(nodes: DomainNode[]): DomainNode[] {
  return nodes.map(node => ({ ...node, children: node.children ? clone(node.children) : [] }));
}

function loadTree(): DomainNode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DomainNode[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_TREE;
}

function saveTree(tree: DomainNode[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
}

function findPath(nodes: DomainNode[], id: string, path: DomainNode[] = []): DomainNode[] | null {
  for (const node of nodes) {
    const nextPath = [...path, node];
    if (node.id === id) return nextPath;
    const found = findPath(node.children || [], id, nextPath);
    if (found) return found;
  }
  return null;
}

function findFirstUnit(nodes: DomainNode[]): DomainNode | null {
  for (const node of nodes) {
    if (node.level === 'unit') return node;
    const found = findFirstUnit(node.children || []);
    if (found) return found;
  }
  return null;
}

function updateNode(nodes: DomainNode[], nodeId: string, updater: (node: DomainNode) => DomainNode): DomainNode[] {
  return nodes.map(node => {
    if (node.id === nodeId) return updater(node);
    return { ...node, children: updateNode(node.children || [], nodeId, updater) };
  });
}

function removeNode(nodes: DomainNode[], nodeId: string): DomainNode[] {
  return nodes
    .filter(node => node.id !== nodeId)
    .map(node => ({ ...node, children: removeNode(node.children || [], nodeId) }));
}

function unitSelection(tree: DomainNode[], selectedUnitId: string): DomainSelection {
  const unit = findPath(tree, selectedUnitId)?.at(-1);
  const firstUnit = unit?.level === 'unit' ? unit : findFirstUnit(tree);
  const path = firstUnit ? findPath(tree, firstUnit.id) || [] : [];
  const [project, plant, area, selectedUnit] = path;
  const safeProject = project || DEFAULT_TREE[0];
  const safePlant = plant || DEFAULT_TREE[0].children![0];
  const safeArea = area || DEFAULT_TREE[0].children![0].children![0];
  const safeUnit = selectedUnit || DEFAULT_TREE[0].children![0].children![0].children![0];
  const pathNames = [safeProject, safePlant, safeArea, safeUnit].map(item => item.name.trim()).filter(Boolean);

  return {
    project: safeProject,
    plant: safePlant,
    area: safeArea,
    unit: safeUnit,
    projectId: pathNames.join('_') || 'default',
    displayPath: pathNames.join(' / '),
    areaCode: safeArea.name,
  };
}

const DomainContext = createContext<DomainContextType | null>(null);

export const DomainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tree, setTree] = useState<DomainNode[]>(loadTree);
  const [selectedUnitId, setSelectedUnitId] = useState(() => {
    const saved = localStorage.getItem(SELECTED_KEY);
    const first = findFirstUnit(loadTree());
    return saved || first?.id || DEFAULT_TREE[0].children![0].children![0].children![0].id;
  });

  const selected = useMemo(() => unitSelection(tree, selectedUnitId), [selectedUnitId, tree]);

  const commit = (next: DomainNode[]) => {
    setTree(next);
    saveTree(next);
  };

  const selectUnit = (unitId: string) => {
    setSelectedUnitId(unitId);
    localStorage.setItem(SELECTED_KEY, unitId);
  };

  const addProject = () => {
    const unitId = createId();
    const project: DomainNode = {
      id: createId(),
      name: `Project ${tree.length + 1}`,
      level: 'project',
      children: [
        {
          id: createId(),
          name: 'Plant 1',
          level: 'plant',
          children: [
            {
              id: createId(),
              name: 'Area 1',
              level: 'area',
              children: [
                { id: unitId, name: 'Unit 1', level: 'unit', children: [] },
              ],
            },
          ],
        },
      ],
    };
    commit([...tree, project]);
    selectUnit(unitId);
  };

  const addChild = (parentId: string) => {
    const path = findPath(tree, parentId);
    const parent = path?.at(-1);
    if (!parent) return;
    const childLevel = LEVEL_CHILD[parent.level];
    if (!childLevel) return;
    const siblings = parent.children || [];
    const child: DomainNode = {
      id: createId(),
      name: `${LEVEL_LABEL[childLevel]} ${siblings.length + 1}`,
      level: childLevel,
      children: [],
    };
    const next = updateNode(tree, parentId, node => ({ ...node, children: [...(node.children || []), child] }));
    commit(next);
    if (childLevel === 'unit') selectUnit(child.id);
  };

  const renameNode = (nodeId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    commit(updateNode(tree, nodeId, node => ({ ...node, name: trimmed })));
  };

  const deleteNode = (nodeId: string) => {
    const path = findPath(tree, nodeId);
    if (!path) return;
    if (path[0]?.id === nodeId && tree.length <= 1) return;
    const next = removeNode(tree, nodeId);
    const nextUnit = findFirstUnit(next);
    commit(next.length ? next : clone(DEFAULT_TREE));
    if (path.some(node => node.id === selectedUnitId) && nextUnit) selectUnit(nextUnit.id);
  };

  return (
    <DomainContext.Provider value={{ tree, selectedUnitId, selected, selectUnit, addProject, addChild, renameNode, deleteNode }}>
      {children}
    </DomainContext.Provider>
  );
};

export const useDomain = (): DomainContextType => {
  const ctx = useContext(DomainContext);
  if (!ctx) throw new Error('useDomain must be used within DomainProvider');
  return ctx;
};
