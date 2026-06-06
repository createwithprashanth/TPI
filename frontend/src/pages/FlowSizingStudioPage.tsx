import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Calculator,
  CheckCircle2,
  Database,
  Gauge,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { FlowSizingService, type FlowSizingResultRow, type FlowSizingTag, type FlowSizingType } from '../services/flowsizing';
import { InstrumentsService, type InstrumentProject } from '../services/instruments';

type FieldSpec = {
  key: string;
  label: string;
  unit?: string;
  defaultValue: number | string;
};

const normalizeProjectId = (projectNo?: string, projectName?: string) => {
  const value = (projectNo || projectName || 'default').trim();
  return value || 'default';
};

const TYPE_LABELS: Record<string, string> = {
  'control-valve': 'Control Valve',
  'flow-element': 'Flow Element',
  'relief-valve': 'Relief Valve',
  pump: 'Pump',
  'storage-tank': 'Storage Tank',
  separator: 'Separator',
  'heat-exchanger': 'Heat Exchanger',
};

const FIELD_SPECS: Record<string, FieldSpec[]> = {
  'control-valve': [
    { key: 'fluidName', label: 'Fluid', defaultValue: 'Water' },
    { key: 'densityKgm3', label: 'Density', unit: 'kg/m3', defaultValue: 1000 },
    { key: 'lineSizeIn', label: 'Line size', unit: 'in', defaultValue: 2 },
    { key: 'valveSizeIn', label: 'Valve size', unit: 'in', defaultValue: 2 },
    { key: 'ratedCv', label: 'Rated Cv', defaultValue: 100 },
    { key: 'minFlowM3h', label: 'Min flow', unit: 'm3/h', defaultValue: 10 },
    { key: 'normalFlowM3h', label: 'Normal flow', unit: 'm3/h', defaultValue: 25 },
    { key: 'maxFlowM3h', label: 'Max flow', unit: 'm3/h', defaultValue: 40 },
    { key: 'inletPressureBarg', label: 'Inlet pressure', unit: 'barg', defaultValue: 6 },
    { key: 'outletPressureBarg', label: 'Outlet pressure', unit: 'barg', defaultValue: 4 },
  ],
  'flow-element': [
    { key: 'fluidName', label: 'Fluid', defaultValue: 'Water' },
    { key: 'flowM3h', label: 'Design flow', unit: 'm3/h', defaultValue: 25 },
    { key: 'densityKgm3', label: 'Density', unit: 'kg/m3', defaultValue: 1000 },
    { key: 'pipeSizeIn', label: 'Pipe size', unit: 'in', defaultValue: 2 },
    { key: 'pipeIdMm', label: 'Pipe ID', unit: 'mm', defaultValue: 52.5 },
    { key: 'designDPmbar', label: 'Design DP', unit: 'mbar', defaultValue: 250 },
    { key: 'betaRatio', label: 'Beta ratio', defaultValue: 0.62 },
  ],
  'relief-valve': [
    { key: 'fluidName', label: 'Fluid', defaultValue: 'Gas' },
    { key: 'flowKgh', label: 'Relieving flow', unit: 'kg/h', defaultValue: 1200 },
    { key: 'setPressureBarg', label: 'Set pressure', unit: 'barg', defaultValue: 8 },
    { key: 'relievingTempC', label: 'Relieving temp', unit: 'C', defaultValue: 40 },
    { key: 'molecularWeight', label: 'Molecular weight', defaultValue: 28.97 },
    { key: 'dischargeCoefficient', label: 'Kd', defaultValue: 0.975 },
  ],
  pump: [
    { key: 'fluidName', label: 'Fluid', defaultValue: 'Water' },
    { key: 'ratedFlowM3h', label: 'Rated flow', unit: 'm3/h', defaultValue: 50 },
    { key: 'densityKgm3', label: 'Density', unit: 'kg/m3', defaultValue: 1000 },
    { key: 'suctionPressureBarg', label: 'Suction pressure', unit: 'barg', defaultValue: 0 },
    { key: 'dischargePressureBarg', label: 'Discharge pressure', unit: 'barg', defaultValue: 6 },
    { key: 'staticHeadM', label: 'Static head', unit: 'm', defaultValue: 5 },
    { key: 'lineLossM', label: 'Line loss', unit: 'm', defaultValue: 4 },
    { key: 'efficiencyPct', label: 'Efficiency', unit: '%', defaultValue: 70 },
    { key: 'motorMarginPct', label: 'Motor margin', unit: '%', defaultValue: 15 },
  ],
  'storage-tank': [
    { key: 'fluidName', label: 'Fluid', defaultValue: 'Process liquid' },
    { key: 'workingVolumeM3', label: 'Working volume', unit: 'm3', defaultValue: 120 },
    { key: 'designMarginPct', label: 'Design margin', unit: '%', defaultValue: 10 },
    { key: 'heightDiameterRatio', label: 'H/D ratio', defaultValue: 1.2 },
  ],
  separator: [
    { key: 'fluidName', label: 'Service', defaultValue: 'Two phase' },
    { key: 'gasFlowM3h', label: 'Gas flow', unit: 'm3/h', defaultValue: 1500 },
    { key: 'gasDensityKgm3', label: 'Gas density', unit: 'kg/m3', defaultValue: 12 },
    { key: 'liquidDensityKgm3', label: 'Liquid density', unit: 'kg/m3', defaultValue: 780 },
    { key: 'kValue', label: 'K value', defaultValue: 0.107 },
    { key: 'lengthDiameterRatio', label: 'L/D ratio', defaultValue: 3 },
  ],
  'heat-exchanger': [
    { key: 'hotFluidName', label: 'Hot fluid', defaultValue: 'Hot oil' },
    { key: 'coldFluidName', label: 'Cold fluid', defaultValue: 'Cooling water' },
    { key: 'heatDutyKw', label: 'Heat duty', unit: 'kW', defaultValue: 500 },
    { key: 'hotInletTempC', label: 'Hot in', unit: 'C', defaultValue: 120 },
    { key: 'hotOutletTempC', label: 'Hot out', unit: 'C', defaultValue: 80 },
    { key: 'coldInletTempC', label: 'Cold in', unit: 'C', defaultValue: 30 },
    { key: 'coldOutletTempC', label: 'Cold out', unit: 'C', defaultValue: 60 },
    { key: 'overallUWM2K', label: 'Overall U', unit: 'W/m2K', defaultValue: 500 },
    { key: 'correctionFactor', label: 'F factor', defaultValue: 0.9 },
    { key: 'foulingMarginPct', label: 'Margin', unit: '%', defaultValue: 10 },
  ],
};

const RESULT_KEYS: Record<string, { key: keyof FlowSizingResultRow; label: string; unit?: string }[]> = {
  'control-valve': [
    { key: 'selected_cv', label: 'Selected Cv' },
    { key: 'valve_opening_pct', label: 'Opening', unit: '%' },
    { key: 'governing_case', label: 'Case' },
  ],
  'flow-element': [
    { key: 'beta_ratio', label: 'Beta' },
    { key: 'orifice_bore_mm', label: 'Bore', unit: 'mm' },
  ],
  'relief-valve': [
    { key: 'required_area_cm2', label: 'Area', unit: 'cm2' },
    { key: 'selected_api_orifice', label: 'API orifice' },
  ],
  pump: [
    { key: 'tdh_m', label: 'TDH', unit: 'm' },
    { key: 'motor_power_kw', label: 'Motor', unit: 'kW' },
  ],
  'storage-tank': [
    { key: 'vessel_id_mm', label: 'Diameter', unit: 'mm' },
    { key: 'vessel_tangential_length_mm', label: 'Height', unit: 'mm' },
  ],
  separator: [
    { key: 'vessel_id_mm', label: 'Diameter', unit: 'mm' },
    { key: 'vessel_tangential_length_mm', label: 'Length', unit: 'mm' },
  ],
  'heat-exchanger': [
    { key: 'duty_kw', label: 'Duty', unit: 'kW' },
    { key: 'lmtd_c', label: 'LMTD', unit: 'C' },
    { key: 'heat_area_m2', label: 'Area', unit: 'm2' },
  ],
};

const buildDefaults = (type: string) => Object.fromEntries(
  (FIELD_SPECS[type] || []).map(field => [field.key, field.defaultValue]),
);

const displayValue = (value: unknown, unit?: string) => {
  if (value === undefined || value === null || value === '') return '-';
  return `${value}${unit ? ` ${unit}` : ''}`;
};

const FlowSizingStudioPage: React.FC = () => {
  const { project } = useProject();
  const projectId = useMemo(
    () => normalizeProjectId(project.project_no, project.project_name),
    [project.project_no, project.project_name],
  );
  const [projects, setProjects] = useState<InstrumentProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  const [types, setTypes] = useState<FlowSizingType[]>([]);
  const [activeType, setActiveType] = useState('control-valve');
  const [tags, setTags] = useState<FlowSizingTag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [manualTag, setManualTag] = useState('');
  const [manualService, setManualService] = useState('');
  const [inputsByType, setInputsByType] = useState<Record<string, Record<string, unknown>>>({
    'control-valve': buildDefaults('control-valve'),
  });
  const [calculation, setCalculation] = useState<Record<string, unknown> | null>(null);
  const [promoted, setPromoted] = useState<Record<string, unknown>>({});
  const [results, setResults] = useState<FlowSizingResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveProjectId = selectedProjectId || projectId;
  const specs = FIELD_SPECS[activeType] || [];
  const currentInputs = inputsByType[activeType] || buildDefaults(activeType);
  const selectedTag = tags.find(tag => tag.id === selectedTagId);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [typeRows, projectRows, tagRows, resultRows] = await Promise.all([
        FlowSizingService.listTypes(),
        InstrumentsService.listProjects(),
        FlowSizingService.listTags(effectiveProjectId, activeType, tagSearch || undefined),
        FlowSizingService.listResults(effectiveProjectId, activeType),
      ]);
      setTypes(typeRows);
      setProjects(projectRows);
      setTags(tagRows);
      setResults(resultRows);
      if (!selectedTagId && tagRows.length) setSelectedTagId(tagRows[0].id);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Unable to load FlowSizing data.');
    } finally {
      setLoading(false);
    }
  }, [activeType, effectiveProjectId, selectedTagId, tagSearch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSelectedTagId('');
    setCalculation(null);
    setPromoted({});
    setInputsByType(current => ({
      ...current,
      [activeType]: current[activeType] || buildDefaults(activeType),
    }));
  }, [activeType]);

  useEffect(() => {
    if (!selectedProjectId) setSelectedProjectId(projectId);
  }, [projectId, selectedProjectId]);

  const updateInput = (key: string, value: string) => {
    const spec = specs.find(item => item.key === key);
    const parsed = typeof spec?.defaultValue === 'number' ? Number(value) : value;
    setInputsByType(current => ({
      ...current,
      [activeType]: {
        ...(current[activeType] || buildDefaults(activeType)),
        [key]: Number.isNaN(parsed) ? '' : parsed,
      },
    }));
  };

  const runCalculation = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await FlowSizingService.calculate(activeType, currentInputs);
      setCalculation(res.calculation);
      setPromoted(res.promoted);
      setMessage('Calculation complete.');
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Calculation failed.');
    } finally {
      setLoading(false);
    }
  };

  const addTag = async () => {
    const tag = manualTag.trim().toUpperCase();
    if (!tag) return;
    setLoading(true);
    setError(null);
    try {
      const created = await FlowSizingService.addInstrument(effectiveProjectId, tag, activeType, manualService.trim() || undefined);
      setManualTag('');
      setManualService('');
      setTags(current => [created, ...current.filter(item => item.id !== created.id)]);
      setSelectedTagId(created.id);
      setMessage('Sizing tag added to project DB.');
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not add instrument.');
    } finally {
      setLoading(false);
    }
  };

  const saveResult = async () => {
    if (!selectedTag || !calculation) {
      setError('Select a tag and run a calculation before saving.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await FlowSizingService.saveResult({
        project_id: effectiveProjectId,
        instrument_id: selectedTag.id,
        tag_number: selectedTag.tag_number,
        instrument_type: activeType,
        input_snapshot: currentInputs,
        result_snapshot: { calculation },
        report_revision: 'Rev 0',
      });
      const resultRows = await FlowSizingService.listResults(effectiveProjectId, activeType);
      setResults(resultRows);
      setMessage('Saved to sizing register and process DB.');
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Save failed.');
    } finally {
      setLoading(false);
    }
  };

  const reviewMessages = Array.isArray(calculation?.reviewMessages)
    ? calculation.reviewMessages as string[]
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090c] text-gray-200">
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-gray-400" />
              <h1 className="text-sm font-semibold text-white">FlowSizing</h1>
              <span className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gray-500">
                offline calculator
              </span>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              Project-linked sizing, process data capture, and local register storage.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={effectiveProjectId}
              onChange={event => setSelectedProjectId(event.target.value)}
              className="h-8 max-w-[240px] rounded-md border border-white/[0.08] bg-black px-2 text-xs text-gray-200 outline-none"
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
            <button
              onClick={refresh}
              className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs text-gray-300 hover:bg-white/[0.07]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-white/[0.06] bg-[#0a0a0d] p-3 xyra-scroll-contained">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-600">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Sizing tools
          </div>
          <div className="space-y-1">
            {(types.length ? types : Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))).map(type => (
              <button
                key={type.value}
                onClick={() => setActiveType(type.value)}
                className={`w-full rounded-md px-3 py-2 text-left text-xs transition-colors ${
                  activeType === type.value
                    ? 'bg-white text-black'
                    : 'border border-white/[0.06] bg-white/[0.02] text-gray-400 hover:bg-white/[0.06] hover:text-gray-200'
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>

          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-600">
              <Database className="h-3.5 w-3.5" />
              Project tags
            </div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600" />
              <input
                value={tagSearch}
                onChange={event => setTagSearch(event.target.value)}
                placeholder="Filter tags"
                className="h-8 w-full rounded-md border border-white/[0.08] bg-black pl-7 pr-2 text-xs text-gray-200 outline-none placeholder:text-gray-700"
              />
            </div>
            <select
              value={selectedTagId}
              onChange={event => setSelectedTagId(event.target.value)}
              className="h-8 w-full rounded-md border border-white/[0.08] bg-black px-2 text-xs text-gray-200 outline-none"
            >
              <option value="">Select tag</option>
              {tags.map(tag => (
                <option key={tag.id} value={tag.id}>
                  {tag.tag_number}{tag.service ? ` - ${tag.service}` : ''}
                </option>
              ))}
            </select>

            <div className="mt-3 space-y-2">
              <input
                value={manualTag}
                onChange={event => setManualTag(event.target.value)}
                placeholder="New tag"
                className="h-8 w-full rounded-md border border-white/[0.08] bg-black px-2 text-xs text-gray-200 outline-none placeholder:text-gray-700"
              />
              <input
                value={manualService}
                onChange={event => setManualService(event.target.value)}
                placeholder="Service"
                className="h-8 w-full rounded-md border border-white/[0.08] bg-black px-2 text-xs text-gray-200 outline-none placeholder:text-gray-700"
              />
              <button
                onClick={addTag}
                disabled={loading || !manualTag.trim()}
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-white/[0.1] bg-white/[0.04] text-xs font-semibold text-gray-200 hover:bg-white/[0.08] disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Tag
              </button>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="grid shrink-0 grid-cols-3 gap-3 border-b border-white/[0.06] p-4">
            <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Active tool</div>
              <div className="mt-1 text-sm font-semibold text-white">{TYPE_LABELS[activeType]}</div>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Selected tag</div>
              <div className="mt-1 truncate text-sm font-semibold text-white">{selectedTag?.tag_number || '-'}</div>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-white/[0.025] p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-gray-600">Register rows</div>
              <div className="mt-1 text-sm font-semibold text-white">{results.length}</div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 xyra-scroll-contained">
            {(error || message) && (
              <div className={`mb-3 rounded-md border px-3 py-2 text-xs ${
                error ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
              }`}>
                {error || message}
              </div>
            )}

            <section className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
              <div className="rounded-md border border-white/[0.08] bg-[#0d0d11]">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Sizing Inputs</h2>
                    <p className="text-[11px] text-gray-600">Values can be edited and saved against a project instrument.</p>
                  </div>
                  <button
                    onClick={runCalculation}
                    disabled={loading}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-xs font-semibold text-black hover:bg-gray-200 disabled:opacity-50"
                  >
                    <Calculator className="h-3.5 w-3.5" />
                    Calculate
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 p-4">
                  {specs.map(spec => (
                    <label key={spec.key} className="block">
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">
                        {spec.label}{spec.unit ? ` (${spec.unit})` : ''}
                      </span>
                      <input
                        type={typeof spec.defaultValue === 'number' ? 'number' : 'text'}
                        value={String(currentInputs[spec.key] ?? '')}
                        onChange={event => updateInput(spec.key, event.target.value)}
                        className="h-9 w-full rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-white outline-none focus:border-white/[0.18]"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-white/[0.08] bg-[#0d0d11]">
                <div className="border-b border-white/[0.06] px-4 py-3">
                  <h2 className="text-sm font-semibold text-white">Result</h2>
                  <p className="text-[11px] text-gray-600">Promoted values are saved to the register.</p>
                </div>
                <div className="space-y-3 p-4">
                  {(RESULT_KEYS[activeType] || []).map(item => (
                    <div key={String(item.key)} className="rounded-md border border-white/[0.07] bg-black p-3">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-gray-600">{item.label}</div>
                      <div className="mt-1 text-lg font-semibold text-white">
                        {displayValue(promoted[item.key as string], item.unit)}
                      </div>
                    </div>
                  ))}
                  {reviewMessages.length > 0 && (
                    <div className="rounded-md border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-100">
                      {reviewMessages.map(item => <div key={item}>{item}</div>)}
                    </div>
                  )}
                  {calculation && (
                    <button
                      onClick={saveResult}
                      disabled={loading || !selectedTag}
                      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/15 disabled:opacity-40"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save to Register
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section className="mt-4 rounded-md border border-white/[0.08] bg-[#0d0d11]">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Sizing Register</h2>
                  <p className="text-[11px] text-gray-600">Stored locally in the XYRA Studio SQLite project database.</p>
                </div>
                <Activity className="h-4 w-4 text-gray-600" />
              </div>
              <div className="overflow-x-auto xyra-scroll-contained">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.12em] text-gray-600">
                    <tr>
                      <th className="px-3 py-2">Tag</th>
                      <th className="px-3 py-2">Status</th>
                      {(RESULT_KEYS[activeType] || []).map(item => (
                        <th key={String(item.key)} className="px-3 py-2">{item.label}</th>
                      ))}
                      <th className="px-3 py-2">Revision</th>
                      <th className="px-3 py-2">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(row => (
                      <tr key={row.id} className="border-t border-white/[0.05] text-gray-300">
                        <td className="px-3 py-2 font-semibold text-white">{row.tag_number}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1 rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px]">
                            <CheckCircle2 className="h-3 w-3" />
                            {row.sizing_status || 'sized'}
                          </span>
                        </td>
                        {(RESULT_KEYS[activeType] || []).map(item => (
                          <td key={String(item.key)} className="px-3 py-2">
                            {displayValue(row[item.key], item.unit)}
                          </td>
                        ))}
                        <td className="px-3 py-2">{row.report_revision || 'Rev 0'}</td>
                        <td className="px-3 py-2 text-gray-500">{row.updated_at || row.calculated_at || '-'}</td>
                      </tr>
                    ))}
                    {!results.length && (
                      <tr>
                        <td colSpan={6 + (RESULT_KEYS[activeType] || []).length} className="px-3 py-8 text-center text-gray-600">
                          No saved sizing results for this project and tool.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
};

export default FlowSizingStudioPage;
