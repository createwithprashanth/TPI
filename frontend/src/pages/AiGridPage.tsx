import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Bot,
  Check,
  Columns3,
  Database,
  Filter,
  GripVertical,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import {
  GridPreferencesService,
  InstrumentsService,
  type InstrumentProject,
  type InstrumentLookupOptions,
  type InstrumentRow,
} from '../services/instruments';
import {
  EngineeringTeamService,
  type EngineeringRole,
  type EngineeringSuggestion,
} from '../services/engineeringTeam';
import {
  ProjectIntelligenceService,
  type ProjectMemory,
  type ProjectQueryResponse,
} from '../services/projectIntelligence';

type ColumnKey = keyof InstrumentRow;
type GridRow = InstrumentRow & { _isNew?: boolean };
type DraftChanges = Record<string, Partial<InstrumentRow>>;
type SortDir = 'asc' | 'desc';

interface Column {
  key: ColumnKey;
  label: string;
  width: string;
  kind?: 'text' | 'select' | 'bool';
  optionsKey?: keyof InstrumentLookupOptions;
  readOnly?: boolean;
}

const DATASOURCE_ID = 'instruments';
const ENGINEERING_ROLES: { value: EngineeringRole; label: string }[] = [
  { value: 'instrumentation', label: 'Instrumentation' },
  { value: 'process', label: 'Process' },
  { value: 'piping', label: 'Piping' },
];

const COLUMNS: Column[] = [
  { key: 'tag_number', label: 'Instrument', width: 'minmax(160px, 1.1fr)' },
  { key: 'instrument_type', label: 'Type', width: '98px', kind: 'select', optionsKey: 'instrument_types' },
  { key: 'service', label: 'Service', width: 'minmax(280px, 1.8fr)' },
  { key: 'loop_number', label: 'Loop', width: '105px' },
  { key: 'io_type', label: 'IO', width: '90px', kind: 'select', optionsKey: 'io_type_options' },
  { key: 'signal_type', label: 'Signal', width: '150px', kind: 'select', optionsKey: 'signal_type_options' },
  { key: 'line_tag', label: 'Line', width: 'minmax(190px, 1.2fr)' },
  { key: 'line_confidence', label: 'Line %', width: '76px', readOnly: true },
  { key: 'line_association_method', label: 'Line Method', width: '130px', readOnly: true },
  { key: 'geometry_evidence', label: 'Evidence', width: 'minmax(210px, 1.2fr)', readOnly: true },
  { key: 'pid_number', label: 'P&ID', width: 'minmax(150px, 1fr)' },
  { key: 'area_code', label: 'Area', width: '86px' },
  { key: 'status', label: 'Status', width: '158px', kind: 'select', optionsKey: 'status_options' },
  { key: 'review_required', label: 'Review', width: '86px', kind: 'bool' },
  { key: 'source', label: 'Source', width: '118px', readOnly: true },
];
const DEFAULT_COLUMN_ORDER = COLUMNS.map(column => column.key);
const DEFAULT_VISIBLE_COLUMNS = DEFAULT_COLUMN_ORDER;
const COLUMN_BY_KEY = Object.fromEntries(COLUMNS.map(column => [column.key, column])) as Record<ColumnKey, Column>;

const emptyLookups: InstrumentLookupOptions = {
  instrument_types: [],
  areas: [],
  units: [],
  status_options: [],
  category_options: [],
  io_type_options: [],
  signal_type_options: [],
};

const normalizeProjectId = (projectNo?: string, projectName?: string) => {
  const value = (projectNo || projectName || 'default').trim();
  return value || 'default';
};

const valueToText = (value: unknown) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const evidenceSummary = (value: unknown) => {
  if (!value || typeof value !== 'object') return '';
  const evidence = value as Record<string, any>;
  if (typeof evidence.summary === 'string' && evidence.summary.trim()) {
    return evidence.summary.trim();
  }
  const parts: string[] = [];
  if (evidence.line?.tag) parts.push(`line ${evidence.line.tag}`);
  if (evidence.valve?.tag) parts.push(`${evidence.valve.position || 'near'} valve ${evidence.valve.tag}`);
  if (evidence.equipment?.tag) parts.push(`${evidence.equipment.position || 'near'} equipment ${evidence.equipment.tag}`);
  return parts.join('; ');
};

const valuesEqual = (a: unknown, b: unknown) => {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return valueToText(a) === valueToText(b);
};

const compareValues = (a: unknown, b: unknown, dir: SortDir) => {
  const av = typeof a === 'boolean' ? (a ? 1 : 0) : valueToText(a).toLowerCase();
  const bv = typeof b === 'boolean' ? (b ? 1 : 0) : valueToText(b).toLowerCase();
  const result = typeof av === 'number' && typeof bv === 'number'
    ? av - bv
    : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? result : -result;
};

const AiGridPage: React.FC = () => {
  const { project } = useProject();
  const projectId = useMemo(
    () => normalizeProjectId(project.project_no, project.project_name),
    [project.project_no, project.project_name],
  );

  const [rows, setRows] = useState<GridRow[]>([]);
  const [projects, setProjects] = useState<InstrumentProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [originalRows, setOriginalRows] = useState<Record<string, InstrumentRow>>({});
  const [draftChanges, setDraftChanges] = useState<DraftChanges>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [lookups, setLookups] = useState<InstrumentLookupOptions>(emptyLookups);
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [ioFilter, setIoFilter] = useState('');
  const [reviewFilter, setReviewFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [lineFilter, setLineFilter] = useState('');
  const [sortBy, setSortBy] = useState<ColumnKey>('tag_number');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [columnPanelOpen, setColumnPanelOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(DEFAULT_COLUMN_ORDER);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [pinnedColumns, setPinnedColumns] = useState<ColumnKey[]>(['tag_number']);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [teamPanelOpen, setTeamPanelOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [projectEngineer, setProjectEngineer] = useState<EngineeringRole>('instrumentation');
  const [projectQuestion, setProjectQuestion] = useState('What should we fix first before issuing this project data?');
  const [projectQueryLoading, setProjectQueryLoading] = useState(false);
  const [projectQueryResult, setProjectQueryResult] = useState<ProjectQueryResponse | null>(null);
  const [engineeringRoles, setEngineeringRoles] = useState<EngineeringRole[]>(['instrumentation']);
  const [engineeringQuestion, setEngineeringQuestion] = useState('');
  const [engineeringLoading, setEngineeringLoading] = useState(false);
  const [engineeringSuggestions, setEngineeringSuggestions] = useState<EngineeringSuggestion[]>([]);
  const [appliedSuggestionKeys, setAppliedSuggestionKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const effectiveProjectId = selectedProjectId || projectId;

  useEffect(() => {
    if (!selectedProjectId) setSelectedProjectId(projectId);
  }, [projectId, selectedProjectId]);

  const orderedColumns = useMemo(() => {
    const validOrder = columnOrder.filter(key => COLUMN_BY_KEY[key]);
    const missing = DEFAULT_COLUMN_ORDER.filter(key => !validOrder.includes(key));
    const allOrdered = [...validOrder, ...missing];
    const visibleSet = new Set(visibleColumns);
    const pinnedSet = new Set(pinnedColumns);
    return allOrdered
      .filter(key => visibleSet.has(key))
      .sort((a, b) => {
        const ap = pinnedSet.has(a);
        const bp = pinnedSet.has(b);
        if (ap !== bp) return ap ? -1 : 1;
        return allOrdered.indexOf(a) - allOrdered.indexOf(b);
      })
      .map(key => COLUMN_BY_KEY[key]);
  }, [columnOrder, pinnedColumns, visibleColumns]);

  const gridTemplate = useMemo(() => `36px ${orderedColumns.map(c => c.width).join(' ')} 48px`, [orderedColumns]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const [list, lookupData, projectList, prefs] = await Promise.all([
        InstrumentsService.list(effectiveProjectId, {
          pageSize: 2000,
        }),
        InstrumentsService.getLookups(effectiveProjectId),
        InstrumentsService.listProjects().catch(() => []),
        GridPreferencesService.get(DATASOURCE_ID).catch(() => null),
      ]);
      setRows(list.data);
      setOriginalRows(Object.fromEntries(list.data.map(row => [row.id, row])));
      setDraftChanges({});
      setDeletedIds(new Set());
      setSelectedRowIds(new Set());
      setEngineeringSuggestions([]);
      setAppliedSuggestionKeys(new Set());
      setLookups(lookupData);
      setProjects(projectList);
      if (!list.data.length && !selectedProjectId && projectList.length) {
        const populatedProject = projectList.find(item => item.instrument_count > 0);
        if (populatedProject && populatedProject.project_id !== effectiveProjectId) {
          setSelectedProjectId(populatedProject.project_id);
        }
      }
      if (prefs) {
        const savedVisible = (prefs.visible_columns || []).filter((key): key is ColumnKey => key in COLUMN_BY_KEY);
        const savedOrder = (prefs.column_order || []).filter((key): key is ColumnKey => key in COLUMN_BY_KEY);
        const savedPinned = (prefs.pinned_columns || []).filter((key): key is ColumnKey => key in COLUMN_BY_KEY);
        if (savedVisible.length) setVisibleColumns(savedVisible);
        if (savedOrder.length) setColumnOrder(savedOrder);
        if (savedPinned.length) setPinnedColumns(savedPinned);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not load AI Grid.');
    } finally {
      setLoading(false);
    }
  }, [effectiveProjectId, selectedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadProjectMemory = useCallback(async () => {
    setMemoryLoading(true);
    setError(null);
    try {
      const memory = await ProjectIntelligenceService.getMemory(effectiveProjectId);
      setProjectMemory(memory);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not load project memory.');
    } finally {
      setMemoryLoading(false);
    }
  }, [effectiveProjectId]);

  useEffect(() => {
    if (memoryPanelOpen) void loadProjectMemory();
  }, [loadProjectMemory, memoryPanelOpen]);

  const activeRows = useMemo(
    () => rows
      .filter(row => !deletedIds.has(row.id))
      .filter(row => {
        if (typeFilter && valueToText(row.instrument_type) !== typeFilter) return false;
        if (ioFilter && valueToText(row.io_type) !== ioFilter) return false;
        if (statusFilter && valueToText(row.status) !== statusFilter) return false;
        if (reviewFilter === 'yes' && !row.review_required) return false;
        if (reviewFilter === 'no' && row.review_required) return false;
        if (sourceFilter && valueToText(row.source) !== sourceFilter) return false;
        if (lineFilter === 'with' && !valueToText(row.line_tag).trim()) return false;
        if (lineFilter === 'without' && valueToText(row.line_tag).trim()) return false;
        if (search.trim() && !valueToText(row.tag_number).toLowerCase().startsWith(search.trim().toLowerCase())) {
          return false;
        }
        if (quickFilter.trim()) {
          const needle = quickFilter.trim().toLowerCase();
          const haystack = [
            row.tag_number,
            row.instrument_type,
            row.service,
            row.loop_number,
            row.io_type,
            row.signal_type,
            row.line_tag,
            row.pid_number,
            row.status,
            row.source,
          ].map(valueToText).join(' ').toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a._isNew && !b._isNew) return -1;
        if (!a._isNew && b._isNew) return 1;
        return compareValues(a[sortBy], b[sortBy], sortDir);
      }),
    [deletedIds, ioFilter, lineFilter, quickFilter, reviewFilter, rows, search, sortBy, sortDir, sourceFilter, statusFilter, typeFilter],
  );

  const pendingUpdates = useMemo(
    () => Object.entries(draftChanges).filter(([id]) => !id.startsWith('new-')).length,
    [draftChanges],
  );
  const pendingCreates = rows.filter(row => row._isNew && !deletedIds.has(row.id)).length;
  const pendingDeletes = Array.from(deletedIds).filter(id => !id.startsWith('new-')).length;
  const pendingTotal = pendingCreates + pendingUpdates + pendingDeletes;
  const reviewRequiredCount = activeRows.filter(row => row.review_required).length;
  const activeFilterCount = [
    typeFilter,
    ioFilter,
    statusFilter,
    reviewFilter,
    sourceFilter,
    lineFilter,
  ].filter(Boolean).length;

  const sourceOptions = useMemo(() => {
    const values = new Set(rows.map(row => valueToText(row.source)).filter(Boolean));
    values.add('manual');
    values.add('ai_extracted');
    return Array.from(values).sort();
  }, [rows]);

  const selectedRows = useMemo(
    () => rows.filter(row => selectedRowIds.has(row.id) && !deletedIds.has(row.id)),
    [deletedIds, rows, selectedRowIds],
  );

  const suggestionKey = (suggestion: EngineeringSuggestion) => (
    `${suggestion.id}:${suggestion.engineer}:${String(suggestion.field)}:${String(suggestion.suggested_value)}`
  );

  const toggleRole = (role: EngineeringRole) => {
    setEngineeringRoles(prev => {
      if (prev.includes(role)) {
        const next = prev.filter(item => item !== role);
        return next.length ? next : prev;
      }
      return [...prev, role];
    });
  };

  const toggleSelectedRow = (id: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisibleRows = () => {
    const selectable = activeRows.filter(row => !row._isNew).map(row => row.id);
    const allSelected = selectable.length > 0 && selectable.every(id => selectedRowIds.has(id));
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      selectable.forEach(id => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const runEngineeringReview = async () => {
    const rowsForReview = selectedRows.length ? selectedRows : activeRows.filter(row => !row._isNew).slice(0, 50);
    if (!rowsForReview.length) {
      setError('Select rows or load a project with instruments before running XYRA Engineering Team.');
      return;
    }
    setTeamPanelOpen(true);
    setEngineeringLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await EngineeringTeamService.review({
        project_id: effectiveProjectId,
        roles: engineeringRoles,
        rows: rowsForReview,
        question: engineeringQuestion.trim() || undefined,
      });
      setEngineeringSuggestions(res.suggestions);
      setAppliedSuggestionKeys(new Set());
      setMessage(`XYRA Engineering Team reviewed ${res.summary.rows_reviewed} row${res.summary.rows_reviewed === 1 ? '' : 's'} and found ${res.summary.suggestions} suggestion${res.summary.suggestions === 1 ? '' : 's'}.`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Engineering review failed.');
    } finally {
      setEngineeringLoading(false);
    }
  };

  const runProjectQuery = async () => {
    setMemoryPanelOpen(true);
    setProjectQueryLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await ProjectIntelligenceService.query({
        project_id: effectiveProjectId,
        engineer: projectEngineer,
        question: projectQuestion.trim() || 'Review this project memory and identify the next EPC data fixes.',
        limit: 24,
        use_model: true,
      });
      setProjectMemory(res.memory);
      setProjectQueryResult(res);
      setMessage(`${res.model_status.model} ${res.model_status.status}; ${res.actions.length} project action${res.actions.length === 1 ? '' : 's'} prepared.`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Project memory query failed.');
    } finally {
      setProjectQueryLoading(false);
    }
  };

  const applySuggestion = (suggestion: EngineeringSuggestion) => {
    updateLocal(suggestion.id, suggestion.field, suggestion.suggested_value as string | boolean);
    setAppliedSuggestionKeys(prev => new Set(prev).add(suggestionKey(suggestion)));
  };

  const applyAllSuggestions = () => {
    const stagedFields = new Set<string>();
    const appliedKeys = new Set(appliedSuggestionKeys);
    engineeringSuggestions.forEach(suggestion => {
      const fieldKey = `${suggestion.id}:${String(suggestion.field)}`;
      const key = suggestionKey(suggestion);
      if (!appliedSuggestionKeys.has(key) && !stagedFields.has(fieldKey)) {
        updateLocal(suggestion.id, suggestion.field, suggestion.suggested_value as string | boolean);
        stagedFields.add(fieldKey);
        appliedKeys.add(key);
      }
    });
    setAppliedSuggestionKeys(appliedKeys);
  };

  const applyHighConfidenceSuggestions = () => {
    const HIGH_CONF = 0.85;
    const stagedFields = new Set<string>();
    const appliedKeys = new Set(appliedSuggestionKeys);
    engineeringSuggestions
      .filter(s => s.confidence >= HIGH_CONF)
      .forEach(suggestion => {
        const fieldKey = `${suggestion.id}:${String(suggestion.field)}`;
        const key = suggestionKey(suggestion);
        if (!appliedSuggestionKeys.has(key) && !stagedFields.has(fieldKey)) {
          updateLocal(suggestion.id, suggestion.field, suggestion.suggested_value as string | boolean);
          stagedFields.add(fieldKey);
          appliedKeys.add(key);
        }
      });
    setAppliedSuggestionKeys(appliedKeys);
  };

  const highConfCount = engineeringSuggestions.filter(s => s.confidence >= 0.85).length;

  const handleSort = (key: ColumnKey) => {
    if (sortBy === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const clearFilters = () => {
    setSearch('');
    setQuickFilter('');
    setStatusFilter('');
    setTypeFilter('');
    setIoFilter('');
    setReviewFilter('');
    setSourceFilter('');
    setLineFilter('');
  };

  const toggleColumn = (key: ColumnKey) => {
    if (key === 'tag_number') return;
    setVisibleColumns(prev => (
      prev.includes(key)
        ? prev.filter(item => item !== key)
        : [...prev, key]
    ));
  };

  const moveColumn = (key: ColumnKey, delta: -1 | 1) => {
    setColumnOrder(prev => {
      const next = [...prev];
      const idx = next.indexOf(key);
      const target = idx + delta;
      if (idx < 0 || target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const togglePinned = (key: ColumnKey) => {
    setPinnedColumns(prev => (
      prev.includes(key)
        ? prev.filter(item => item !== key)
        : [...prev, key]
    ));
    setVisibleColumns(prev => (prev.includes(key) ? prev : [...prev, key]));
  };

  const resetLayout = () => {
    setColumnOrder(DEFAULT_COLUMN_ORDER);
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
    setPinnedColumns(['tag_number']);
    setMessage('Layout reset locally.');
  };

  const saveLayout = async () => {
    setError(null);
    setMessage(null);
    try {
      await GridPreferencesService.save(DATASOURCE_ID, {
        visible_columns: visibleColumns,
        column_order: columnOrder,
        column_widths: {},
        pinned_columns: pinnedColumns,
        saved_views: [],
      });
      setMessage('Saved grid layout.');
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not save grid layout.');
    }
  };

  const isDirtyCell = (row: GridRow, key: ColumnKey) => {
    if (row._isNew) return key === 'tag_number' || key === 'instrument_type' || key === 'service';
    if (deletedIds.has(row.id)) return false;
    const original = originalRows[row.id];
    return !!original && !valuesEqual(row[key], original[key]);
  };

  const updateLocal = (id: string, key: ColumnKey, value: string | boolean) => {
    setRows(prev => prev.map(row => (row.id === id ? { ...row, [key]: value } : row)));
    setDraftChanges(prev => {
      const row = rows.find(r => r.id === id);
      const original = originalRows[id];
      const nextRowChanges = { ...(prev[id] || {}), [key]: value };

      if (row?._isNew) return { ...prev, [id]: nextRowChanges };
      if (original && valuesEqual(value, original[key])) {
        delete nextRowChanges[key];
      }
      const next = { ...prev };
      if (Object.keys(nextRowChanges).length) {
        next[id] = nextRowChanges;
      } else {
        delete next[id];
      }
      return next;
    });
  };

  const addDraftRow = () => {
    const id = `new-${Date.now()}`;
    const row: GridRow = {
      id,
      tag_number: '',
      instrument_type: lookups.instrument_types[0]?.value || 'PT',
      service: '',
      status: 'Draft',
      source: 'manual',
      review_required: false,
      active_on_pid: true,
      _isNew: true,
    };
    setRows(prev => [row, ...prev]);
    setDraftChanges(prev => ({
      ...prev,
      [id]: {
        tag_number: '',
        instrument_type: row.instrument_type,
        service: '',
        status: 'Draft',
        source: 'manual',
        review_required: false,
      },
    }));
  };

  const markDelete = (id: string) => {
    if (id.startsWith('new-')) {
      setRows(prev => prev.filter(row => row.id !== id));
      setDraftChanges(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    setDeletedIds(prev => new Set(prev).add(id));
    setDraftChanges(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const discardChanges = () => {
    const restored = Object.values(originalRows).sort((a, b) => valueToText(a.tag_number).localeCompare(valueToText(b.tag_number)));
    setRows(restored);
    setDraftChanges({});
    setDeletedIds(new Set());
    setError(null);
    setMessage('Discarded local edits.');
  };

  const saveChanges = async () => {
    if (!pendingTotal) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const createRows = rows.filter(row => row._isNew && !deletedIds.has(row.id));
      for (const row of createRows) {
        const tag = valueToText(row.tag_number).trim();
        if (!tag) throw new Error('New rows must have an instrument tag before saving.');
        await InstrumentsService.create(effectiveProjectId, {
          tag_number: tag,
          instrument_type: valueToText(row.instrument_type).trim() || 'UNKNOWN',
          service: valueToText(row.service).trim(),
          loop_number: valueToText(row.loop_number).trim(),
          io_type: valueToText(row.io_type).trim(),
          signal_type: valueToText(row.signal_type).trim(),
          line_tag: valueToText(row.line_tag).trim(),
          pid_number: valueToText(row.pid_number).trim(),
          area_code: valueToText(row.area_code).trim(),
          status: valueToText(row.status).trim() || 'Draft',
          review_required: Boolean(row.review_required),
          source: 'manual',
        });
      }

      for (const [id, changes] of Object.entries(draftChanges)) {
        if (id.startsWith('new-') || deletedIds.has(id) || !Object.keys(changes).length) continue;
        await InstrumentsService.update(id, changes);
      }

      for (const id of deletedIds) {
        if (!id.startsWith('new-')) await InstrumentsService.delete(id);
      }

      setMessage(`Saved ${pendingTotal} change${pendingTotal === 1 ? '' : 's'} to SQLite.`);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not save AI Grid changes.');
    } finally {
      setSaving(false);
    }
  };

  const renderCell = (row: GridRow, column: Column) => {
    const raw = row[column.key];
    const dirty = isDirtyCell(row, column.key);
    const cellClass = dirty
      ? 'border-emerald-400/35 bg-emerald-400/[0.08]'
      : 'border-transparent bg-transparent';

    if (column.kind === 'bool') {
      const checked = Boolean(raw);
      return (
        <button
          className={`mx-auto flex h-6 w-6 items-center justify-center rounded border ${
            checked
              ? 'border-amber-300/60 bg-amber-300/15 text-amber-200'
              : 'border-white/[0.1] bg-black text-gray-600 hover:text-gray-300'
          } ${dirty ? 'ring-1 ring-emerald-400/40' : ''}`}
          title={checked ? 'Review required' : 'No review flag'}
          onClick={() => updateLocal(row.id, column.key, !checked)}
        >
          {checked && <Check className="h-3.5 w-3.5" />}
        </button>
      );
    }

    if (column.readOnly && !row._isNew) {
      const title = column.key === 'line_association_method'
        ? valueToText(row.line_association_reason || raw)
        : valueToText(raw);
      const display = column.key === 'line_confidence' && typeof raw === 'number'
        ? `${Math.round(raw * 100)}%`
        : column.key === 'geometry_evidence'
        ? evidenceSummary(raw)
        : valueToText(raw);
      return (
        <div className="h-7 w-full truncate px-1.5 py-1.5 text-xs text-gray-500" title={title}>
          {display || '-'}
        </div>
      );
    }

    if (column.kind === 'select' && column.optionsKey) {
      const options = lookups[column.optionsKey] as Array<string | { value: string; label: string }>;
      return (
        <select
          value={valueToText(raw)}
          onChange={event => updateLocal(row.id, column.key, event.target.value)}
          className={`h-7 w-full rounded border px-2 text-xs text-gray-200 outline-none focus:border-white/30 ${cellClass}`}
        >
          <option value="">-</option>
          {options.map(option => {
            const value = typeof option === 'string' ? option : option.value;
            const label = typeof option === 'string' ? option : option.label;
            return <option key={value} value={value}>{label}</option>;
          })}
        </select>
      );
    }

    return (
      <input
        value={valueToText(raw)}
        onChange={event => updateLocal(row.id, column.key, event.target.value)}
        className={`h-7 w-full rounded border px-1.5 text-xs text-gray-200 outline-none hover:border-white/[0.08] focus:border-white/25 focus:bg-black ${cellClass}`}
      />
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#070709] text-gray-200">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Database className="h-4 w-4 text-gray-500" strokeWidth={1.7} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">AI Grid</div>
            <div className="truncate font-mono text-[10px] uppercase tracking-wider text-gray-600">
              Project DB: {effectiveProjectId}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{activeRows.length} rows</span>
          <span className="rounded border border-white/[0.08] px-2 py-1 font-mono text-gray-600">
            {reviewRequiredCount} review
          </span>
          <span className="rounded border border-white/[0.08] px-2 py-1 font-mono text-gray-600">
            {selectedRows.length} selected
          </span>
          <span className={`rounded border px-2 py-1 font-mono ${pendingTotal ? 'border-emerald-400/30 text-emerald-300' : 'border-white/[0.08] text-gray-600'}`}>
            {pendingTotal} pending
          </span>
          <button
            onClick={discardChanges}
            disabled={!pendingTotal || saving}
            title="Discard local edits"
            className="flex h-7 w-7 items-center justify-center rounded border border-white/[0.08] bg-white/[0.03] text-gray-400 hover:text-white disabled:opacity-30"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => void saveChanges()}
            disabled={!pendingTotal || saving}
            className="flex h-7 items-center gap-1.5 rounded bg-white px-3 text-xs font-semibold text-black hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className={`h-3.5 w-3.5 ${saving ? 'animate-pulse' : ''}`} />
            Save
          </button>
          <button
            onClick={() => void load()}
            disabled={loading || saving}
            title="Refresh grid"
            className="flex h-7 w-7 items-center justify-center rounded border border-white/[0.08] bg-white/[0.03] text-gray-400 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#08080a] px-4 py-1.5">
        <select
          value={effectiveProjectId}
          onChange={event => setSelectedProjectId(event.target.value)}
          className="h-8 max-w-64 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-300 outline-none focus:border-white/25"
          title="Database project"
        >
          {!projects.some(item => item.project_id === effectiveProjectId) && (
            <option value={effectiveProjectId}>{effectiveProjectId}</option>
          )}
          {projects.map(item => (
            <option key={item.project_id} value={item.project_id}>
              {item.project_id} ({item.instrument_count})
            </option>
          ))}
        </select>
        <div className="relative w-52">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Tag starts with"
            className="h-8 w-full rounded border border-white/[0.08] bg-black pl-8 pr-2 text-xs text-gray-200 outline-none placeholder:text-gray-700 focus:border-white/25"
          />
        </div>
        <div className="relative w-56">
          <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600" />
          <input
            value={quickFilter}
            onChange={event => setQuickFilter(event.target.value)}
            placeholder="Find in visible fields"
            className="h-8 w-full rounded border border-white/[0.08] bg-black pl-8 pr-2 text-xs text-gray-200 outline-none placeholder:text-gray-700 focus:border-white/25"
          />
        </div>
        <button
          onClick={() => setAdvancedFiltersOpen(prev => !prev)}
          disabled={saving}
          className={`flex h-8 items-center gap-1.5 rounded border px-3 text-xs font-medium disabled:opacity-40 ${
            advancedFiltersOpen || activeFilterCount
              ? 'border-white/20 bg-white/[0.08] text-white'
              : 'border-white/[0.08] bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters{activeFilterCount ? ` ${activeFilterCount}` : ''}
        </button>
        <button
          onClick={clearFilters}
          disabled={saving}
          className="flex h-8 items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.02] px-3 text-xs font-medium text-gray-400 hover:text-white disabled:opacity-40"
        >
          Clear
        </button>
        <button
          onClick={() => setColumnPanelOpen(prev => !prev)}
          disabled={saving}
          className={`flex h-8 items-center gap-1.5 rounded border px-3 text-xs font-medium disabled:opacity-40 ${
            columnPanelOpen
              ? 'border-white/25 bg-white text-black'
              : 'border-white/[0.08] bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]'
          }`}
        >
          <Columns3 className="h-3.5 w-3.5" />
          Columns
        </button>
        <button
          onClick={() => setTeamPanelOpen(prev => !prev)}
          disabled={saving}
          className={`flex h-8 items-center gap-1.5 rounded border px-3 text-xs font-medium disabled:opacity-40 ${
            teamPanelOpen
              ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100'
              : 'border-white/[0.08] bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          XYRA Team
        </button>
        <button
          onClick={() => setMemoryPanelOpen(prev => !prev)}
          disabled={saving}
          className={`flex h-8 items-center gap-1.5 rounded border px-3 text-xs font-medium disabled:opacity-40 ${
            memoryPanelOpen
              ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100'
              : 'border-white/[0.08] bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]'
          }`}
        >
          <Database className="h-3.5 w-3.5" />
          Project Memory
        </button>
        <button
          onClick={() => void runEngineeringReview()}
          disabled={saving || engineeringLoading || (!selectedRows.length && !activeRows.length)}
          className="flex h-8 items-center gap-1.5 rounded border border-cyan-300/25 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-40"
        >
          <Sparkles className={`h-3.5 w-3.5 ${engineeringLoading ? 'animate-pulse' : ''}`} />
          Review {selectedRows.length ? selectedRows.length : ''}
        </button>
        <button
          onClick={addDraftRow}
          disabled={saving}
          className="ml-auto flex h-8 items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.04] px-3 text-xs font-medium text-gray-200 hover:bg-white/[0.08] disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Row
        </button>
        {error && <div className="max-w-md truncate text-xs text-red-300">{error}</div>}
        {message && !error && <div className="max-w-md truncate text-xs text-emerald-300">{message}</div>}
      </div>

      {advancedFiltersOpen && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#050507] px-4 py-2">
          <select
            value={typeFilter}
            onChange={event => setTypeFilter(event.target.value)}
            className="h-8 w-28 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-300 outline-none focus:border-white/25"
          >
            <option value="">All types</option>
            {lookups.instrument_types.map(item => <option key={item.value} value={item.value}>{item.value}</option>)}
          </select>
          <select
            value={ioFilter}
            onChange={event => setIoFilter(event.target.value)}
            className="h-8 w-28 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-300 outline-none focus:border-white/25"
          >
            <option value="">All IO</option>
            {lookups.io_type_options.map(io => <option key={io} value={io}>{io}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value)}
            className="h-8 w-36 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-300 outline-none focus:border-white/25"
          >
            <option value="">All status</option>
            {lookups.status_options.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
          <select
            value={reviewFilter}
            onChange={event => setReviewFilter(event.target.value)}
            className="h-8 w-32 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-300 outline-none focus:border-white/25"
          >
            <option value="">All review</option>
            <option value="yes">Review only</option>
            <option value="no">No review</option>
          </select>
          <select
            value={lineFilter}
            onChange={event => setLineFilter(event.target.value)}
            className="h-8 w-32 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-300 outline-none focus:border-white/25"
          >
            <option value="">All lines</option>
            <option value="with">With line</option>
            <option value="without">No line</option>
          </select>
          <select
            value={sourceFilter}
            onChange={event => setSourceFilter(event.target.value)}
            className="h-8 w-32 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-300 outline-none focus:border-white/25"
          >
            <option value="">All source</option>
            {sourceOptions.map(source => <option key={source} value={source}>{source}</option>)}
          </select>
          <div className="ml-auto text-[11px] text-gray-600">
            Filters apply instantly to the loaded project.
          </div>
        </div>
      )}

      {columnPanelOpen && (
        <div className="shrink-0 border-b border-white/[0.06] bg-[#09090b] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Columns3 className="h-3.5 w-3.5" />
              Column Layout
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={resetLayout}
                className="h-7 rounded border border-white/[0.08] px-2.5 text-xs text-gray-400 hover:text-white"
              >
                Reset
              </button>
              <button
                onClick={() => void saveLayout()}
                className="flex h-7 items-center gap-1.5 rounded bg-white px-2.5 text-xs font-semibold text-black hover:bg-gray-200"
              >
                <Save className="h-3.5 w-3.5" />
                Save layout
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
            {columnOrder.map((key, index) => {
              const column = COLUMN_BY_KEY[key];
              if (!column) return null;
              const visible = visibleColumns.includes(key);
              const pinned = pinnedColumns.includes(key);
              return (
                <div
                  key={key}
                  className={`flex h-9 items-center gap-2 rounded border px-2 text-xs ${
                    visible ? 'border-white/[0.1] bg-black/60 text-gray-200' : 'border-white/[0.05] bg-black/20 text-gray-600'
                  }`}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-gray-700" />
                  <button
                    onClick={() => toggleColumn(key)}
                    disabled={key === 'tag_number'}
                    className={`h-4 w-4 shrink-0 rounded border ${visible ? 'border-emerald-400/50 bg-emerald-400/20' : 'border-white/[0.12]'} disabled:opacity-70`}
                    title={visible ? 'Hide column' : 'Show column'}
                  >
                    {visible && <Check className="h-3 w-3 text-emerald-300" />}
                  </button>
                  <span className="min-w-0 flex-1 truncate">{column.label}</span>
                  <button
                    onClick={() => togglePinned(key)}
                    title={pinned ? 'Unpin from front' : 'Pin to front'}
                    className={`flex h-6 w-6 items-center justify-center rounded ${pinned ? 'text-white' : 'text-gray-600 hover:text-gray-300'}`}
                  >
                    <Pin className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => moveColumn(key, -1)}
                    disabled={index === 0}
                    title="Move left"
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:text-gray-300 disabled:opacity-20"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => moveColumn(key, 1)}
                    disabled={index === columnOrder.length - 1}
                    title="Move right"
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:text-gray-300 disabled:opacity-20"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {memoryPanelOpen && (
        <div className="shrink-0 border-b border-emerald-300/10 bg-[#07100c] px-4 py-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Database className="h-4 w-4 text-emerald-200" />
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">Shared Project Memory</div>
                <div className="truncate text-[11px] text-gray-500">
                  SQLite project context used by instrumentation, process, and piping engineers.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadProjectMemory()}
                disabled={memoryLoading}
                className="flex h-7 w-7 items-center justify-center rounded border border-white/[0.08] text-gray-500 hover:text-white disabled:opacity-40"
                title="Refresh project memory"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${memoryLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setMemoryPanelOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded border border-white/[0.08] text-gray-500 hover:text-white"
                title="Close project memory"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(420px,0.8fr)_minmax(560px,1.2fr)]">
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Instruments', projectMemory?.counts.instruments ?? rows.length],
                  ['Documents', projectMemory?.counts.documents ?? 0],
                  ['Review', projectMemory?.quality_gaps.review_required ?? reviewRequiredCount],
                  ['No service', projectMemory?.quality_gaps.missing_service ?? 0],
                  ['No line', projectMemory?.quality_gaps.missing_line_tag ?? 0],
                  ['Sizing gap', projectMemory?.quality_gaps.flowsizing_missing_results ?? 0],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border border-white/[0.08] bg-black/40 px-2 py-1.5">
                    <div className="font-mono text-sm font-semibold text-white">{value}</div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-600">{label}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {ENGINEERING_ROLES.map(role => (
                  <button
                    key={role.value}
                    onClick={() => setProjectEngineer(role.value)}
                    className={`h-8 rounded border px-3 text-xs font-medium ${
                      projectEngineer === role.value
                        ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100'
                        : 'border-white/[0.08] bg-black/30 text-gray-500 hover:text-gray-200'
                    }`}
                  >
                    {role.label}
                  </button>
                ))}
              </div>
              <textarea
                value={projectQuestion}
                onChange={event => setProjectQuestion(event.target.value)}
                rows={2}
                className="w-full resize-none rounded border border-white/[0.08] bg-black px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-700 focus:border-emerald-300/35"
              />
              <button
                onClick={() => void runProjectQuery()}
                disabled={projectQueryLoading}
                className="flex h-8 items-center gap-1.5 rounded bg-white px-3 text-xs font-semibold text-black hover:bg-gray-200 disabled:opacity-40"
              >
                <Sparkles className={`h-3.5 w-3.5 ${projectQueryLoading ? 'animate-pulse' : ''}`} />
                Ask {ENGINEERING_ROLES.find(item => item.value === projectEngineer)?.label}
              </button>
            </div>

            <div className="grid gap-2 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div className="rounded border border-white/[0.08] bg-black/40 p-3">
                <div className="mb-1 text-xs font-semibold text-white">Engineer answer</div>
                <div className="text-xs leading-5 text-gray-300">
                  {projectQueryResult?.answer || 'Ask an engineer to reason over the full project memory.'}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(projectQueryResult?.actions || []).map(action => (
                    <span
                      key={`${action.label}-${action.count}`}
                      className={`rounded border px-2 py-1 text-[11px] ${
                        action.severity === 'high'
                          ? 'border-red-300/25 text-red-200'
                          : action.severity === 'medium'
                            ? 'border-amber-300/25 text-amber-200'
                            : 'border-emerald-300/20 text-emerald-200'
                      }`}
                    >
                      {action.label}: {action.count}
                    </span>
                  ))}
                </div>
              </div>
              <div className="max-h-44 overflow-y-auto rounded border border-white/[0.08] bg-black/40 xyra-scroll-contained">
                {(projectQueryResult?.evidence || projectMemory?.evidence_samples || []).map(item => (
                  <div key={`${item.id}-${item.reason}`} className="grid grid-cols-[112px_72px_minmax(0,1fr)] gap-2 border-b border-white/[0.05] px-3 py-2 text-xs last:border-b-0">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-white">{item.tag_number || '-'}</div>
                      <div className="text-[10px] text-gray-600">{item.pid_number || item.table}</div>
                    </div>
                    <div className="font-mono text-[11px] text-emerald-200">{item.instrument_type || '-'}</div>
                    <div className="min-w-0">
                      <div className="truncate text-gray-400" title={item.reason}>{item.reason}</div>
                      <div className="truncate text-[11px] text-gray-600">{item.service || item.line_tag || item.status || '-'}</div>
                    </div>
                  </div>
                ))}
                {!(projectQueryResult?.evidence?.length || projectMemory?.evidence_samples?.length) && (
                  <div className="flex h-24 items-center justify-center text-xs text-gray-600">
                    No project memory evidence yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {teamPanelOpen && (
        <div className="shrink-0 border-b border-cyan-300/10 bg-[#071012] px-4 py-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Bot className="h-4 w-4 text-cyan-200" />
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">XYRA Engineering Team</div>
                <div className="text-[11px] text-gray-500">
                  Select rows, review with discipline models, stage changes, then Save.
                </div>
              </div>
            </div>
            <button
              onClick={() => setTeamPanelOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded border border-white/[0.08] text-gray-500 hover:text-white"
              title="Close engineering team"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(360px,0.72fr)_minmax(520px,1.28fr)]">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {ENGINEERING_ROLES.map(role => {
                  const active = engineeringRoles.includes(role.value);
                  return (
                    <button
                      key={role.value}
                      onClick={() => toggleRole(role.value)}
                      className={`h-8 rounded border px-3 text-xs font-medium ${
                        active
                          ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100'
                          : 'border-white/[0.08] bg-black/30 text-gray-500 hover:text-gray-200'
                      }`}
                    >
                      {role.label}
                    </button>
                  );
                })}
              </div>
              <textarea
                value={engineeringQuestion}
                onChange={event => setEngineeringQuestion(event.target.value)}
                placeholder="Optional instruction, e.g. review selected FCVs for IO, line, and sizing handoff."
                rows={2}
                className="w-full resize-none rounded border border-white/[0.08] bg-black px-3 py-2 text-xs text-gray-200 outline-none placeholder:text-gray-700 focus:border-cyan-300/35"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void runEngineeringReview()}
                  disabled={engineeringLoading || (!selectedRows.length && !activeRows.length)}
                  className="flex h-8 items-center gap-1.5 rounded bg-white px-3 text-xs font-semibold text-black hover:bg-gray-200 disabled:opacity-40"
                >
                  <Sparkles className={`h-3.5 w-3.5 ${engineeringLoading ? 'animate-pulse' : ''}`} />
                  Review {selectedRows.length ? `${selectedRows.length} selected` : 'visible rows'}
                </button>
                <button
                  onClick={applyHighConfidenceSuggestions}
                  disabled={!highConfCount}
                  title="Stage all suggestions with ≥85% confidence"
                  className="flex h-8 items-center gap-1.5 rounded border border-cyan-400/30 bg-cyan-400/10 px-3 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/15 disabled:opacity-40"
                >
                  <Check className="h-3.5 w-3.5" />
                  Stage ≥85%
                  {highConfCount > 0 && (
                    <span className="ml-0.5 rounded-full bg-cyan-400/20 px-1.5 py-px font-mono text-[10px] text-cyan-300">
                      {highConfCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={applyAllSuggestions}
                  disabled={!engineeringSuggestions.length}
                  className="flex h-8 items-center gap-1.5 rounded border border-emerald-400/30 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/15 disabled:opacity-40"
                >
                  <Check className="h-3.5 w-3.5" />
                  Stage all
                </button>
                <span className="text-[11px] text-gray-600">
                  {engineeringSuggestions.length} suggestion{engineeringSuggestions.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto rounded border border-white/[0.08] bg-black/40 xyra-scroll-contained">
              {engineeringSuggestions.map(suggestion => {
                const key = suggestionKey(suggestion);
                const applied = appliedSuggestionKeys.has(key);
                return (
                  <div key={key} className="grid grid-cols-[118px_110px_minmax(0,1fr)_82px] gap-2 border-b border-white/[0.05] px-3 py-2 text-xs last:border-b-0">
                    <div>
                      <div className="font-semibold text-white">{suggestion.tag_number || '-'}</div>
                      <div className="text-[10px] uppercase tracking-wide text-cyan-300/80">{suggestion.engineer}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">{String(suggestion.field)}</div>
                      <div className="font-mono text-[10px] text-gray-600">{Math.round(suggestion.confidence * 100)}% confidence</div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-gray-200">
                        <span className="text-gray-600">Set to </span>
                        <span className="font-semibold text-emerald-200">{String(suggestion.suggested_value)}</span>
                      </div>
                      <div className="truncate text-[11px] text-gray-500" title={suggestion.reason}>{suggestion.reason}</div>
                    </div>
                    <button
                      onClick={() => applySuggestion(suggestion)}
                      disabled={applied}
                      className={`h-7 rounded border px-2 text-[11px] font-semibold ${
                        applied
                          ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                          : 'border-white/[0.08] bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]'
                      }`}
                    >
                      {applied ? 'Staged' : 'Stage'}
                    </button>
                  </div>
                );
              })}
              {!engineeringSuggestions.length && (
                <div className="flex h-24 items-center justify-center text-xs text-gray-600">
                  Select rows, choose engineer roles, then run Review.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="xyra-scroll-contained min-h-0 flex-1 overflow-auto pb-8">
        <div className="min-w-[1550px]">
          <div
            className="sticky top-0 z-10 grid border-b border-white/[0.08] bg-[#0b0b0d] text-[10px] font-semibold uppercase tracking-wider text-gray-500"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <button
              onClick={toggleVisibleRows}
              className="sticky left-0 z-30 flex items-center justify-center border-r border-white/[0.05] bg-[#0b0b0d] px-1 py-2 hover:bg-white/[0.04]"
              title="Select visible rows for engineering review"
            >
              <Check className="h-3 w-3" />
            </button>
            {orderedColumns.map((column, index) => {
              const active = sortBy === column.key;
              const SortIcon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
              <button
                key={column.key}
                onClick={() => handleSort(column.key)}
                className={`flex items-center justify-between gap-1 border-r border-white/[0.05] px-2 py-2 text-left hover:bg-white/[0.04] ${
                  active ? 'text-white' : ''
                } ${index === 0 ? 'sticky z-20 bg-[#0b0b0d]' : ''}`}
                style={index === 0 ? { left: 36 } : undefined}
              >
                <span className="truncate">{column.label}</span>
                <SortIcon className={`h-3 w-3 shrink-0 ${active ? 'text-white' : 'text-gray-700'}`} />
              </button>
              );
            })}
            <div className="px-2 py-2 text-center">Del</div>
          </div>

          {activeRows.map(row => (
            <div
              key={row.id}
              className={`grid min-h-9 border-b border-white/[0.045] hover:bg-white/[0.025] ${
                selectedRowIds.has(row.id)
                  ? 'bg-cyan-300/[0.045]'
                  : row._isNew
                    ? 'bg-emerald-400/[0.045]'
                    : 'bg-black/40'
              }`}
              style={{ gridTemplateColumns: gridTemplate }}
            >
              <div className="sticky left-0 z-20 flex items-center justify-center border-r border-white/[0.05] bg-[#09090b] px-1 py-1">
                <button
                  onClick={() => toggleSelectedRow(row.id)}
                  disabled={row._isNew}
                  title={selectedRowIds.has(row.id) ? 'Remove from engineering review' : 'Select for engineering review'}
                  className={`flex h-6 w-6 items-center justify-center rounded border disabled:opacity-25 ${
                    selectedRowIds.has(row.id)
                      ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100'
                      : 'border-white/[0.08] text-gray-600 hover:text-gray-300'
                  }`}
                >
                  {selectedRowIds.has(row.id) && <Check className="h-3.5 w-3.5" />}
                </button>
              </div>
              {orderedColumns.map((column, index) => (
                <div
                  key={column.key}
                  className={`flex items-center border-r border-white/[0.04] px-1 py-1 ${index === 0 ? 'sticky z-10 bg-[#09090b]' : ''}`}
                  style={index === 0 ? { left: 36 } : undefined}
                >
                  {renderCell(row, column)}
                </div>
              ))}
              <div className="flex items-center justify-center px-1">
                <button
                  onClick={() => markDelete(row.id)}
                  title="Mark row for delete"
                  className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {!loading && !activeRows.length && (
            <div className="flex h-48 items-center justify-center text-sm text-gray-600">
              No instruments in this project database yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AiGridPage;
