import api from './api';
import type { EngineeringRole } from './engineeringTeam';

export interface ProjectMemory {
  project: Record<string, unknown>;
  counts: Record<string, number>;
  quality_gaps: Record<string, number>;
  breakdown: Record<string, Array<{ key: string; count: number }>>;
  recent_sessions: Array<Record<string, unknown>>;
  evidence_samples: ProjectEvidence[];
}

export interface ProjectEvidence {
  table: string;
  id: string;
  tag_number: string;
  instrument_type: string;
  service: string;
  line_tag: string;
  pid_number: string;
  status: string;
  review_required: boolean;
  reason: string;
}

export interface ProjectAction {
  label: string;
  count: number;
  severity: 'ok' | 'medium' | 'high' | string;
}

export interface ProjectQueryResponse {
  project_id: string;
  engineer: EngineeringRole;
  mode: string;
  answer: string;
  actions: ProjectAction[];
  evidence: ProjectEvidence[];
  memory: ProjectMemory;
  model_status: {
    model: string;
    status: string;
  };
}

export const ProjectIntelligenceService = {
  async getMemory(projectId: string): Promise<ProjectMemory> {
    const res = await api.get<ProjectMemory>('/api/v1/project-intelligence/memory', {
      params: { project_id: projectId },
    });
    return res.data;
  },

  async query(payload: {
    project_id: string;
    engineer: EngineeringRole;
    question: string;
    limit?: number;
    use_model?: boolean;
  }): Promise<ProjectQueryResponse> {
    const res = await api.post<ProjectQueryResponse>('/api/v1/project-intelligence/query', payload, {
      timeout: 90000,
    });
    return res.data;
  },
};
