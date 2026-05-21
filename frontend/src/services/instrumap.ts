import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30000,
});

// ── Types ──────────────────────────────────────────────────────────────────

export interface AsyncJobResponse {
  status: 'queued';
  job_id: string;
  batch_id: string;
  message: string;
}

export interface JobStatusResponse {
  job_id: string;
  status: 'queued' | 'started' | 'finished' | 'failed';
  position_in_queue?: number;
  progress?: {
    stage: string;
    message: string;
    estimated_seconds_remaining: number;
  };
  download_ready?: boolean;
  download_endpoint?: string;
  result?: {
    status: string;
    instrument_count: number;
    results_table: any[];
    detected_radius?: number;
    batch_id?: string;
  };
  error?: string;
}

export interface ProjectInfo {
  project_name: string;
  project_no: string;
  client_name: string;
  contractor_name: string;
  location: string;
}

// ── API calls ──────────────────────────────────────────────────────────────

export const generateInstruMapPreview = async (pidFile: File): Promise<{ image: string; pageCount: number }> => {
  const form = new FormData();
  form.append('pid_file', pidFile);
  const resp = await api.post('/api/v1/instrumap/preview', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  if (resp.data.status === 'SUCCESS' && resp.data.base64_image) {
    return {
      image: `data:image/jpeg;base64,${resp.data.base64_image}`,
      pageCount: resp.data.page_count || 1,
    };
  }
  throw new Error('Failed to retrieve preview image.');
};

export const processInstruMapFilesAsync = async ({
  pidFile,
  calibration_x,
  calibration_y,
  user_selected_radius,
  area_code,
  batch_id,
  project,
}: {
  pidFile: File;
  calibration_x?: number;
  calibration_y?: number;
  user_selected_radius?: number;
  area_code?: string;
  batch_id?: string;
  project?: ProjectInfo;
}): Promise<AsyncJobResponse> => {
  const form = new FormData();
  form.append('pid_file', pidFile);
  if (calibration_x !== undefined) form.append('calibration_x', String(calibration_x));
  if (calibration_y !== undefined) form.append('calibration_y', String(calibration_y));
  if (user_selected_radius !== undefined) form.append('user_selected_radius', String(user_selected_radius));
  if (area_code) form.append('area_code', area_code);
  if (batch_id) form.append('batch_id', batch_id);
  if (project?.project_name) form.append('project_name', project.project_name);
  if (project?.project_no) form.append('project_no', project.project_no);
  if (project?.client_name) form.append('client_name', project.client_name);
  if (project?.contractor_name) form.append('contractor_name', project.contractor_name);
  if (project?.location) form.append('location', project.location);

  const resp = await api.post('/api/v1/instrumap/process-async', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
  });
  return resp.data;
};

export const getJobStatus = async (jobId: string): Promise<JobStatusResponse> => {
  const resp = await api.get(`/api/v1/instrumap/job/${jobId}`);
  return resp.data;
};

// ── Piping MTO ─────────────────────────────────────────────────────────────

export interface MtoPipingDetectResponse {
  status: string;
  count: number;
  label: string;
  threshold: number;
  matches: { x1: number; y1: number; x2: number; y2: number; score: number }[];
  annotated_image: string;
  image_width: number;
  image_height: number;
}

export const detectPipingSymbol = async ({
  pidFile,
  templateBox,
  searchBox,
  threshold = 0.70,
  label = 'Symbol',
}: {
  pidFile: File;
  templateBox: { x1: number; y1: number; x2: number; y2: number };
  searchBox?: { x1: number; y1: number; x2: number; y2: number };
  threshold?: number;
  label?: string;
}): Promise<MtoPipingDetectResponse> => {
  const form = new FormData();
  form.append('pid_file', pidFile);
  form.append('template_x1', String(templateBox.x1));
  form.append('template_y1', String(templateBox.y1));
  form.append('template_x2', String(templateBox.x2));
  form.append('template_y2', String(templateBox.y2));
  if (searchBox) {
    form.append('search_x1', String(searchBox.x1));
    form.append('search_y1', String(searchBox.y1));
    form.append('search_x2', String(searchBox.x2));
    form.append('search_y2', String(searchBox.y2));
  }
  form.append('threshold', String(threshold));
  form.append('label', label);
  const resp = await api.post('/api/v1/instrumap/piping-mto/detect', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return resp.data;
};

export interface PageResult {
  page: number;
  count: number;
  matches: { x1: number; y1: number; x2: number; y2: number; score: number }[];
}

export interface MtoPipingAllPagesResponse {
  status: string;
  count: number;
  label: string;
  threshold: number;
  matches: { x1: number; y1: number; x2: number; y2: number; score: number }[];
  total_count: number;
  pages: PageResult[];
  annotated_image: string;
  image_width: number;
  image_height: number;
}

export const detectPipingSymbolAllPages = async ({
  pidFile,
  templateBox,
  threshold = 0.70,
  label = 'Symbol',
}: {
  pidFile: File;
  templateBox: { x1: number; y1: number; x2: number; y2: number };
  threshold?: number;
  label?: string;
}): Promise<MtoPipingAllPagesResponse> => {
  const form = new FormData();
  form.append('pid_file', pidFile);
  form.append('template_x1', String(templateBox.x1));
  form.append('template_y1', String(templateBox.y1));
  form.append('template_x2', String(templateBox.x2));
  form.append('template_y2', String(templateBox.y2));
  form.append('threshold', String(threshold));
  form.append('label', label);
  const resp = await api.post('/api/v1/instrumap/piping-mto/detect-all-pages', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  });
  return resp.data;
};

// ── Symbol Library ─────────────────────────────────────────────────────────

export interface LibrarySymbolRecord {
  id: string;
  name: string;
  thumbnail: string;
  templateImage: string;
  createdAt: string;
}

export const fetchLibrary = async (): Promise<LibrarySymbolRecord[]> => {
  const resp = await api.get('/api/v1/instrumap/library');
  return resp.data;
};

export const saveLibrarySymbol = async (entry: LibrarySymbolRecord): Promise<LibrarySymbolRecord> => {
  const resp = await api.post('/api/v1/instrumap/library', entry);
  return resp.data;
};

export const deleteLibrarySymbol = async (id: string): Promise<void> => {
  await api.delete(`/api/v1/instrumap/library/${id}`);
};

export const detectFromLibraryTemplate = async ({
  pidFile,
  templateImageBase64,
  threshold = 0.70,
  label = 'Symbol',
}: {
  pidFile: File;
  templateImageBase64: string;
  threshold?: number;
  label?: string;
}): Promise<MtoPipingAllPagesResponse> => {
  const form = new FormData();
  form.append('pid_file', pidFile);
  // Convert base64 PNG back to a File blob
  const byteArr = Uint8Array.from(atob(templateImageBase64), c => c.charCodeAt(0));
  form.append('template_image', new Blob([byteArr], { type: 'image/png' }), 'template.png');
  form.append('threshold', String(threshold));
  form.append('label', label);
  const resp = await api.post('/api/v1/instrumap/piping-mto/detect-from-library', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  });
  return resp.data;
};

export const downloadHighlightedImage = async (batchId: string): Promise<void> => {
  const resp = await api.get(`/api/v1/instrumap/highlighted/${batchId}`, { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([resp.data], { type: 'image/jpeg' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `highlighted_${batchId}.jpg`;
  a.click();
  URL.revokeObjectURL(url);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const downloadBatchResults = async (batchId: string): Promise<void> => {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const resp = await api.get(`/api/v1/instrumap/download/${batchId}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([resp.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `InstruMap_Results_${batchId}.zip`);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
      return;
    } catch (err: any) {
      const status = err?.response?.status;
      if (attempt < 6 && [404, 409, 425, 500, 503].includes(status)) {
        await sleep(1500 * attempt);
        continue;
      }
      throw err;
    }
  }
};
