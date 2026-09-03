import api from './api';

export interface InstrumentRow {
  id: string;
  tag_number: string;
  instrument_type?: string;
  type_description?: string;
  suffix?: string;
  service?: string;
  category?: string;
  io_type?: string;
  signal_type?: string;
  loop_number?: string;
  area_code?: string;
  unit_code?: string;
  line_tag?: string;
  line_confidence?: number;
  line_association_method?: string;
  line_association_reason?: string;
  line_candidates?: Array<Record<string, unknown>>;
  geometry_evidence?: Record<string, unknown> | string;
  pid_number?: string;
  location?: string;
  elevation_m?: number;
  range_min?: number;
  range_max?: number;
  range_unit?: string;
  calib_min?: number;
  calib_max?: number;
  calib_unit?: string;
  supply_voltage?: string;
  hazardous_area?: boolean;
  area_class?: string;
  enclosure_class?: string;
  status?: string;
  review_required?: boolean;
  notes?: string;
  flowsizing_type?: string;
  source?: string;
  field_confidence?: Record<string, number>;
  active_on_pid?: boolean;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  updated_by?: string;
}

export interface InstrumentListResult {
  data: InstrumentRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface InstrumentLookupOptions {
  instrument_types: { value: string; label: string }[];
  areas: { value: string; label: string }[];
  units: { value: string; label: string }[];
  status_options: string[];
  category_options: string[];
  io_type_options: string[];
  signal_type_options: string[];
}

export interface InstrumentProject {
  project_id: string;
  name?: string;
  project_no?: string;
  instrument_count: number;
}

export interface SavedGridView {
  name: string;
  visibleColumns: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
  pinnedColumns: string[];
}

export interface GridPreferences {
  visible_columns: string[];
  column_order: string[];
  column_widths: Record<string, number>;
  pinned_columns: string[];
  saved_views: SavedGridView[];
}

const BASE = '/api/v1/instruments';

export const InstrumentsService = {
  async list(
    projectId: string,
    params?: {
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
      search?: string;
      status?: string;
      reviewRequired?: boolean;
      activeOnPid?: boolean;
    },
  ): Promise<InstrumentListResult> {
    const res = await api.get(BASE, {
      params: {
        project_id: projectId,
        page: params?.page ?? 1,
        page_size: params?.pageSize ?? 500,
        sort_by: params?.sortBy ?? 'tag_number',
        sort_dir: params?.sortDir ?? 'asc',
        ...(params?.search ? { search: params.search } : {}),
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.reviewRequired !== undefined ? { review_required: params.reviewRequired } : {}),
        ...(params?.activeOnPid !== undefined ? { active_on_pid: params.activeOnPid } : {}),
      },
    });
    return res.data;
  },

  async getLookups(projectId: string): Promise<InstrumentLookupOptions> {
    const res = await api.get(`${BASE}/lookups`, {
      params: { project_id: projectId },
    });
    return res.data;
  },

  async listProjects(): Promise<InstrumentProject[]> {
    const res = await api.get(`${BASE}/projects`);
    return res.data;
  },

  async create(projectId: string, row: Partial<InstrumentRow>): Promise<InstrumentRow> {
    const res = await api.post(BASE, { ...row, project_id: projectId });
    return res.data;
  },

  async update(id: string, changes: Partial<InstrumentRow>): Promise<InstrumentRow> {
    const res = await api.patch(`${BASE}/${id}`, changes);
    return res.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`${BASE}/${id}`);
  },
};

export const GridPreferencesService = {
  async get(datasourceId: string): Promise<GridPreferences> {
    const res = await api.get(`/api/v1/data-editor/preferences/${datasourceId}`);
    return res.data;
  },

  async save(datasourceId: string, prefs: GridPreferences): Promise<GridPreferences> {
    const res = await api.put(`/api/v1/data-editor/preferences/${datasourceId}`, prefs);
    return res.data;
  },
};
