import api from './api';
import type { InstrumentRow } from './instruments';

export type EngineeringRole = 'instrumentation' | 'process' | 'piping';

export interface EngineeringSuggestion {
  id: string;
  tag_number: string;
  engineer: EngineeringRole;
  field: keyof InstrumentRow;
  current_value?: unknown;
  suggested_value?: unknown;
  confidence: number;
  reason: string;
}

export interface EngineeringReviewResponse {
  project_id: string;
  mode: string;
  summary: {
    rows_reviewed: number;
    suggestions: number;
    by_engineer: Record<string, number>;
    by_field: Record<string, number>;
  };
  model_status?: Record<string, {
    model: string;
    status: string;
    suggestions: number;
  }>;
  suggestions: EngineeringSuggestion[];
}

export const EngineeringTeamService = {
  async review(payload: {
    project_id: string;
    roles: EngineeringRole[];
    rows: InstrumentRow[];
    question?: string;
  }): Promise<EngineeringReviewResponse> {
    const res = await api.post<EngineeringReviewResponse>('/api/v1/engineering-team/review', payload, {
      timeout: 90000,
    });
    return res.data;
  },
};
