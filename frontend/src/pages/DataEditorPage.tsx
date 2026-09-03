import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
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
  Trash2,
  X,
} from 'lucide-react';
import { useDomain } from '../contexts/DomainContext';
import {
  GridPreferencesService,
  InstrumentsService,
  type InstrumentLookupOptions,
  type InstrumentRow,
} from '../services/instruments';

type ColumnKey = keyof InstrumentRow;
type GridRow = InstrumentRow & { _isNew?: boolean };
type DraftChanges = Record<string, Partial<InstrumentRow>>;
type SortDir = 'asc' | 'desc';
type SortRule = { key: ColumnKey; dir: SortDir };

interface Column {
  key: ColumnKey;
  label: string;
  width: string;
  kind?: 'text' | 'select' | 'bool';
  optionsKey?: keyof InstrumentLookupOptions;
  readOnly?: boolean;
}

const DATASOURCE_ID = 'instruments';

const COLUMNS: Column[] = [
  { key: 'tag_number', label: 'Instrument', width: 'minmax(160px, 1.1fr)' },
  { key: 'loop_number', label: 'Loop', width: '130px' },
  { key: 'instrument_type', label: 'Type', width: '86px', kind: 'select', optionsKey: 'instrument_types' },
  { key: 'type_description', label: 'Type Description', width: 'minmax(190px, 1.1fr)', readOnly: true },
  { key: 'service', label: 'Service', width: 'minmax(280px, 1.8fr)' },
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

const normalizeColumnOrder = (order: ColumnKey[]) => {
  const core: ColumnKey[] = ['tag_number', 'loop_number', 'instrument_type', 'type_description'];
  const withoutCore = order.filter(key => !core.includes(key));
  return [...core, ...withoutCore] as ColumnKey[];
};

const emptyLookups: InstrumentLookupOptions = {
  instrument_types: [],
  areas: [],
  units: [],
  status_options: [],
  category_options: [],
  io_type_options: [],
  signal_type_options: [],
};

const valueToText = (value: unknown) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const evidenceSummary = (value: unknown) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
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

const typeLabelToDescription = (label: string, value: string) => {
  const prefix = `${value} - `;
  return label.startsWith(prefix) ? label.slice(prefix.length).trim() : label;
};

const valuesEqual = (a: unknown, b: unknown) => {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return valueToText(a) === valueToText(b);
};

const backendChanges = (changes: Partial<InstrumentRow>) => {
  const { type_description: _typeDescription, ...rest } = changes;
  return rest;
};

const compareValues = (a: unknown, b: unknown, dir: SortDir) => {
  const av = typeof a === 'boolean' ? (a ? 1 : 0) : valueToText(a).toLowerCase();
  const bv = typeof b === 'boolean' ? (b ? 1 : 0) : valueToText(b).toLowerCase();
  const result = typeof av === 'number' && typeof bv === 'number'
    ? av - bv
    : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? result : -result;
};

const DataEditorPage: React.FC = () => {
  const { selected } = useDomain();
  const projectId = selected.projectId || 'default';

  const [rows, setRows] = useState<GridRow[]>([]);
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
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [sourceFilter, setSourceFilter] = useState('');
  const [lineFilter, setLineFilter] = useState('');
  const [sortBy, setSortBy] = useState<ColumnKey>('tag_number');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [customSortOpen, setCustomSortOpen] = useState(false);
  const [customSorts, setCustomSorts] = useState<SortRule[]>([]);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [columnPanelOpen, setColumnPanelOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(DEFAULT_COLUMN_ORDER);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [pinnedColumns, setPinnedColumns] = useState<ColumnKey[]>(['tag_number']);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const effectiveProjectId = projectId;

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
      const [list, lookupData, prefs] = await Promise.all([
        InstrumentsService.list(effectiveProjectId, {
          pageSize: 2000,
          activeOnPid: activeFilter === 'all' ? undefined : activeFilter === 'active',
        }),
        InstrumentsService.getLookups(effectiveProjectId),
        GridPreferencesService.get(DATASOURCE_ID).catch(() => null),
      ]);
      const typeDescriptionByCode = Object.fromEntries(
        lookupData.instrument_types.map(item => [
          item.value,
          typeLabelToDescription(item.label, item.value),
        ]),
      );
      const rowsWithDescriptions = list.data.map(row => ({
        ...row,
        type_description: typeDescriptionByCode[valueToText(row.instrument_type)] || '',
      }));
      setRows(rowsWithDescriptions);
      setOriginalRows(Object.fromEntries(rowsWithDescriptions.map(row => [row.id, row])));
      setDraftChanges({});
      setDeletedIds(new Set());
      setSelectedRowIds(new Set());
      setLookups(lookupData);
      if (prefs) {
        const savedVisible = (prefs.visible_columns || []).filter((key): key is ColumnKey => key in COLUMN_BY_KEY);
        const savedOrder = (prefs.column_order || []).filter((key): key is ColumnKey => key in COLUMN_BY_KEY);
        const savedPinned = (prefs.pinned_columns || []).filter((key): key is ColumnKey => key in COLUMN_BY_KEY);
        if (savedVisible.length) {
          const withRequired = new Set<ColumnKey>(savedVisible);
          withRequired.add('tag_number');
          withRequired.add('loop_number');
          withRequired.add('instrument_type');
          withRequired.add('type_description');
          setVisibleColumns(DEFAULT_COLUMN_ORDER.filter(key => withRequired.has(key)));
        }
        if (savedOrder.length) setColumnOrder(normalizeColumnOrder(savedOrder));
        if (savedPinned.length) setPinnedColumns(savedPinned);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not load Data Editor.');
    } finally {
      setLoading(false);
    }
  }, [activeFilter, effectiveProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

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
        if (customSorts.length) {
          for (const rule of customSorts) {
            const result = compareValues(a[rule.key], b[rule.key], rule.dir);
            if (result !== 0) return result;
          }
          return compareValues(a.tag_number, b.tag_number, 'asc');
        }
        return compareValues(a[sortBy], b[sortBy], sortDir);
      }),
    [customSorts, deletedIds, ioFilter, lineFilter, quickFilter, reviewFilter, rows, search, sortBy, sortDir, sourceFilter, statusFilter, typeFilter],
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
    activeFilter !== 'active' ? activeFilter : '',
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

  const handleSort = (key: ColumnKey) => {
    setCustomSorts([]);
    if (sortBy === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const addSortRule = () => {
    const used = new Set(customSorts.map(rule => rule.key));
    const nextColumn = DEFAULT_COLUMN_ORDER.find(key => !used.has(key)) || 'tag_number';
    setCustomSorts(prev => [...prev, { key: nextColumn, dir: 'asc' }]);
    setCustomSortOpen(true);
  };

  const updateSortRule = (index: number, patch: Partial<SortRule>) => {
    setCustomSorts(prev => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const removeSortRule = (index: number) => {
    setCustomSorts(prev => prev.filter((_, i) => i !== index));
  };

  const moveSortRule = (index: number, delta: -1 | 1) => {
    setCustomSorts(prev => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setQuickFilter('');
    setStatusFilter('');
    setTypeFilter('');
    setIoFilter('');
    setReviewFilter('');
    setActiveFilter('active');
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
    const typeDescriptionByCode = Object.fromEntries(
      lookups.instrument_types.map(item => [
        item.value,
        typeLabelToDescription(item.label, item.value),
      ]),
    );
    const extra = key === 'instrument_type'
      ? { type_description: typeDescriptionByCode[valueToText(value)] || '' }
      : {};
    setRows(prev => prev.map(row => (row.id === id ? { ...row, [key]: value, ...extra } : row)));
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
      type_description: lookups.instrument_types[0]
        ? typeLabelToDescription(lookups.instrument_types[0].label, lookups.instrument_types[0].value)
        : '',
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
        await InstrumentsService.update(id, backendChanges(changes));
      }

      for (const id of deletedIds) {
        if (!id.startsWith('new-')) await InstrumentsService.delete(id);
      }

      setMessage(`Saved ${pendingTotal} change${pendingTotal === 1 ? '' : 's'} to SQLite.`);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not save Data Editor changes.');
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
            const label = column.key === 'instrument_type'
              ? value
              : typeof option === 'string' ? option : option.label;
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
    <div className="tpi-data-editor flex h-full flex-col overflow-hidden bg-[#070709] text-gray-200">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Database className="h-4 w-4 text-gray-500" strokeWidth={1.7} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Data Editor</div>
            <div className="truncate font-mono text-[10px] uppercase tracking-wider text-gray-600">
              Unit DB: {effectiveProjectId}
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
        <div className="flex h-8 max-w-[28rem] items-center gap-2 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-300">
          <span className="text-gray-600">Project</span>
          <span className="truncate font-mono text-[11px] font-semibold text-gray-100" title={selected.displayPath}>
            {selected.displayPath}
          </span>
        </div>
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
        <select
          value={activeFilter}
          onChange={event => setActiveFilter(event.target.value as 'active' | 'inactive' | 'all')}
          disabled={saving}
          className="h-8 w-36 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-300 outline-none focus:border-white/25 disabled:opacity-40"
          title="Noise visibility"
        >
          <option value="active">Active only</option>
          <option value="inactive">Noise audit</option>
          <option value="all">All rows</option>
        </select>
        <button
          onClick={() => {
            if (!customSorts.length) addSortRule();
            else setCustomSortOpen(prev => !prev);
          }}
          disabled={saving}
          className={`flex h-8 items-center gap-1.5 rounded border px-3 text-xs font-medium disabled:opacity-40 ${
            customSortOpen || customSorts.length
              ? 'border-white/20 bg-white/[0.08] text-white'
              : 'border-white/[0.08] bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]'
          }`}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          Sort{customSorts.length ? ` ${customSorts.length}` : ''}
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

      {customSortOpen && (
        <div className="shrink-0 border-b border-white/[0.06] bg-[#050507] px-4 py-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <ArrowUpDown className="h-3.5 w-3.5" />
              Custom Sort
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={addSortRule}
                className="flex h-7 items-center gap-1.5 rounded border border-white/[0.08] px-2.5 text-xs text-gray-300 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Level
              </button>
              <button
                onClick={() => setCustomSorts([])}
                disabled={!customSorts.length}
                className="h-7 rounded border border-white/[0.08] px-2.5 text-xs text-gray-400 hover:text-white disabled:opacity-30"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {customSorts.map((rule, index) => (
              <div
                key={`${rule.key}-${index}`}
                className="flex h-9 items-center gap-2 rounded border border-white/[0.08] bg-black/60 px-2 text-xs text-gray-300"
              >
                <span className="w-5 text-center font-mono text-gray-600">{index + 1}</span>
                <select
                  value={rule.key}
                  onChange={event => updateSortRule(index, { key: event.target.value as ColumnKey })}
                  className="h-7 w-40 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-200 outline-none focus:border-white/25"
                >
                  {DEFAULT_COLUMN_ORDER.map(key => (
                    <option key={key} value={key}>{COLUMN_BY_KEY[key].label}</option>
                  ))}
                </select>
                <select
                  value={rule.dir}
                  onChange={event => updateSortRule(index, { dir: event.target.value as SortDir })}
                  className="h-7 w-28 rounded border border-white/[0.08] bg-black px-2 text-xs text-gray-200 outline-none focus:border-white/25"
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <button
                  onClick={() => moveSortRule(index, -1)}
                  disabled={index === 0}
                  title="Move sort level up"
                  className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:text-gray-300 disabled:opacity-25"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveSortRule(index, 1)}
                  disabled={index === customSorts.length - 1}
                  title="Move sort level down"
                  className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:text-gray-300 disabled:opacity-25"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => removeSortRule(index)}
                  title="Remove sort level"
                  className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-red-500/10 hover:text-red-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {!customSorts.length && (
              <div className="flex h-9 items-center text-xs text-gray-600">
                Header sort is active: {COLUMN_BY_KEY[sortBy].label} {sortDir === 'asc' ? 'ascending' : 'descending'}.
              </div>
            )}
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

      <div className="tpi-scroll-contained min-h-0 flex-1 overflow-auto pb-8">
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
              const customIndex = customSorts.findIndex(rule => rule.key === column.key);
              const customRule = customIndex >= 0 ? customSorts[customIndex] : null;
              const SortIcon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
              <button
                key={column.key}
                onClick={() => handleSort(column.key)}
                className={`flex items-center justify-between gap-1 border-r border-white/[0.05] px-2 py-2 text-left hover:bg-white/[0.04] ${
                  active || customRule ? 'text-white' : ''
                } ${index === 0 ? 'sticky z-20 bg-[#0b0b0d]' : ''}`}
                style={index === 0 ? { left: 36 } : undefined}
              >
                <span className="truncate">{column.label}</span>
                {customRule ? (
                  <span className="flex items-center gap-1 text-[10px] text-white">
                    {customRule.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {customIndex + 1}
                  </span>
                ) : (
                  <SortIcon className={`h-3 w-3 shrink-0 ${active ? 'text-white' : 'text-gray-700'}`} />
                )}
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

export default DataEditorPage;
