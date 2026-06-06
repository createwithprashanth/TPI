import api from './api';

const BASE = '/api/v1/flowsizing';

export interface FlowSizingType {
  value: string;
  label: string;
}

export interface FlowSizingTag {
  id: string;
  tag_number: string;
  service?: string;
  instrument_type?: string;
  flowsizing_type?: string;
}

export interface FlowSizingResultRow {
  id: string;
  project_id: string;
  instrument_id?: string;
  tag_number: string;
  instrument_type: string;
  sizing_status?: string;
  governing_case?: string;
  selected_cv?: number;
  valve_opening_pct?: number;
  beta_ratio?: number;
  orifice_bore_mm?: number;
  required_area_cm2?: number;
  selected_api_orifice?: string;
  tdh_m?: number;
  hydraulic_power_kw?: number;
  motor_power_kw?: number;
  duty_kw?: number;
  lmtd_c?: number;
  heat_area_m2?: number;
  vessel_id_mm?: number;
  vessel_tangential_length_mm?: number;
  report_revision?: string;
  calculated_at?: string;
  updated_at?: string;
}

export interface FlowSizingCalculationResponse {
  status: string;
  instrument_type: string;
  calculation: Record<string, unknown>;
  promoted: Record<string, unknown>;
}

export const FlowSizingService = {
  async listTypes(): Promise<FlowSizingType[]> {
    const res = await api.get<{ types: FlowSizingType[] }>(`${BASE}/types`);
    return res.data.types;
  },

  async listTags(projectId: string, type: string, search?: string): Promise<FlowSizingTag[]> {
    const res = await api.get<{ tags: FlowSizingTag[] }>(`${BASE}/tags`, {
      params: { project_id: projectId, type, ...(search ? { search } : {}) },
    });
    return res.data.tags;
  },

  async addInstrument(projectId: string, tagNumber: string, flowsizingType: string, service?: string): Promise<FlowSizingTag> {
    const res = await api.post<FlowSizingTag>(`${BASE}/instruments`, {
      project_id: projectId,
      tag_number: tagNumber,
      flowsizing_type: flowsizingType,
      service,
    });
    return res.data;
  },

  async calculate(instrumentType: string, inputSnapshot: Record<string, unknown>): Promise<FlowSizingCalculationResponse> {
    const res = await api.post<FlowSizingCalculationResponse>(`${BASE}/calculate`, {
      instrument_type: instrumentType,
      input_snapshot: inputSnapshot,
    });
    return res.data;
  },

  async saveResult(payload: {
    project_id: string;
    instrument_id: string;
    tag_number: string;
    instrument_type: string;
    input_snapshot: Record<string, unknown>;
    result_snapshot: Record<string, unknown>;
    report_revision?: string;
  }): Promise<FlowSizingResultRow> {
    const res = await api.post<FlowSizingResultRow>(`${BASE}/results`, payload);
    return res.data;
  },

  async listResults(projectId: string, type: string): Promise<FlowSizingResultRow[]> {
    const res = await api.get<{ data: FlowSizingResultRow[] }>(`${BASE}/results`, {
      params: { project_id: projectId, type, page_size: 100 },
    });
    return res.data.data;
  },
};
