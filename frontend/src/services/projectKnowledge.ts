import api from './api';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface KnowledgeDocument {
  id: string;
  project_id: string;
  folder_path?: string;
  file_path: string;
  file_name: string;
  file_hash?: string;
  file_size_bytes?: number;
  extension?: string;
  document_type?: string;
  status?: string;
  error_message?: string;
  chunk_count?: number;
  indexed_at?: string;
  updated_at?: string;
}

export interface KnowledgeCitation {
  chunk_id: string;
  document_id: string;
  file_name: string;
  file_path: string;
  document_type: string;
  page_number?: number | null;
  section_title?: string;
  score: number;
  matched_terms?: string[];
  excerpt: string;
}

export interface IndexFolderResult {
  project_id: string;
  folder_path: string;
  files_seen: number;
  indexed: number;
  skipped: number;
  failed: number;
  chunks: number;
  errors: Array<{ file: string; error: string }>;
}

export interface KnowledgeChatResult {
  project_id: string;
  question: string;
  answer: string;
  citations: KnowledgeCitation[];
  follow_up_questions?: string[];
  model_status: {
    model: string;
    status: string;
    confidence?: unknown;
  };
}

export interface SavedEvidenceItem {
  id: string;
  project_id: string;
  chunk_id?: string | null;
  document_id?: string | null;
  question?: string;
  note?: string;
  citation_snapshot: KnowledgeCitation;
  created_at?: string;
}

export const ProjectKnowledgeService = {
  async indexFolder(payload: {
    project_id: string;
    folder_path: string;
    force?: boolean;
    limit?: number;
  }): Promise<IndexFolderResult> {
    const res = await api.post<IndexFolderResult>('/api/v1/project-knowledge/index-folder', payload, {
      timeout: 300000,
    });
    return res.data;
  },

  async listDocuments(projectId: string): Promise<{ project_id: string; documents: KnowledgeDocument[]; total: number; chunks: number }> {
    const res = await api.get('/api/v1/project-knowledge/documents', {
      params: { project_id: projectId },
    });
    return res.data;
  },

  async search(payload: {
    project_id: string;
    query: string;
    limit?: number;
    document_type?: string;
  }): Promise<{ project_id: string; query: string; results: KnowledgeCitation[] }> {
    const res = await api.post('/api/v1/project-knowledge/search', payload, {
      timeout: 90000,
    });
    return res.data;
  },

  async chat(payload: {
    project_id: string;
    question: string;
    limit?: number;
    use_model?: boolean;
  }): Promise<KnowledgeChatResult> {
    const res = await api.post<KnowledgeChatResult>('/api/v1/project-knowledge/chat', payload, {
      timeout: 120000,
    });
    return res.data;
  },

  async listSavedEvidence(projectId: string): Promise<{ project_id: string; items: SavedEvidenceItem[]; total: number }> {
    const res = await api.get('/api/v1/project-knowledge/saved-evidence', {
      params: { project_id: projectId },
    });
    return res.data;
  },

  async saveEvidence(payload: {
    project_id: string;
    citation: KnowledgeCitation;
    question?: string;
    note?: string;
  }): Promise<SavedEvidenceItem> {
    const res = await api.post('/api/v1/project-knowledge/saved-evidence', payload);
    return res.data;
  },

  async deleteSavedEvidence(projectId: string, savedId: string): Promise<{ project_id: string; id: string; deleted: boolean }> {
    const res = await api.delete(`/api/v1/project-knowledge/saved-evidence/${savedId}`, {
      params: { project_id: projectId },
    });
    return res.data;
  },

  pageImageUrl(projectId: string, documentId: string, pageNumber = 1, zoom = 0.75): string {
    const params = new URLSearchParams({
      project_id: projectId,
      document_id: documentId,
      page_number: String(pageNumber || 1),
      zoom: String(zoom),
    });
    return `${API_BASE}/api/v1/project-knowledge/page-image?${params.toString()}`;
  },
};
