import api from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProjectInfo {
  project_name: string;
  project_no: string;
  client_name: string;
  contractor_name: string;
  location: string;
  project_legend_notes: string;
}

export interface ProcessResponse {
  status: 'queued';
  job_id: string;
  batch_id: string;
  message: string;
}

export interface JobProgress {
  stage: string;
  message: string;
  estimated_seconds_remaining: number;
}

export interface JobStatusResponse {
  job_id: string;
  status: 'queued' | 'started' | 'finished' | 'failed';
  position_in_queue?: number;
  progress?: JobProgress;
  download_ready?: boolean;
  download_endpoint?: string;
  result?: {
    status: string;
    instrument_count?: number;
    results_table?: any[];
    message?: string;
    error?: string;
    detected_radius?: number;
    batch_id?: string;
  };
  error?: string;
}

// ── API calls ──────────────────────────────────────────────────────────────

export const generatePreview = async (
  pidFile: File,
  page = 1,
): Promise<{ image: string; pageCount: number }> => {
  const form = new FormData();
  form.append('pid_file', pidFile);
  form.append('page', String(page));
  const resp = await api.post('/api/v1/pid/preview', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  const { status, base64_image, page_count } = resp.data;
  if (status === 'SUCCESS' && base64_image) {
    return { image: `data:image/jpeg;base64,${base64_image}`, pageCount: page_count || 1 };
  }
  throw new Error('Failed to retrieve preview image.');
};

export const processAsync = async ({
  pidFile,
  calibration_x,
  calibration_y,
  user_selected_radius,
  area_code,
  batch_id,
  german_pid,
  project,
}: {
  pidFile: File;
  calibration_x?: number;
  calibration_y?: number;
  user_selected_radius?: number;
  area_code?: string;
  batch_id?: string;
  german_pid?: boolean;
  project?: ProjectInfo;
}): Promise<ProcessResponse> => {
  const form = new FormData();
  form.append('pid_file', pidFile);
  if (calibration_x !== undefined) form.append('calibration_x', String(calibration_x));
  if (calibration_y !== undefined) form.append('calibration_y', String(calibration_y));
  if (user_selected_radius !== undefined) form.append('user_selected_radius', String(user_selected_radius));
  if (area_code) form.append('area_code', area_code);
  if (batch_id) form.append('batch_id', batch_id);
  if (german_pid) form.append('german_pid', 'true');
  if (project?.project_name) form.append('project_name', project.project_name);
  if (project?.project_no) form.append('project_no', project.project_no);
  if (project?.client_name) form.append('client_name', project.client_name);
  if (project?.contractor_name) form.append('contractor_name', project.contractor_name);
  if (project?.location) form.append('location', project.location);
  if (project?.project_legend_notes) form.append('project_legend_notes', project.project_legend_notes);

  const resp = await api.post('/api/v1/pid/process', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
  });
  return resp.data;
};

export const getJobStatus = async (jobId: string): Promise<JobStatusResponse> => {
  const resp = await api.get(`/api/v1/pid/job/${jobId}`);
  return resp.data;
};

export const downloadHighlightedImage = async (batchId: string): Promise<void> => {
  const resp = await api.get(`/api/v1/pid/highlighted/${batchId}`, { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([resp.data], { type: 'image/jpeg' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `highlighted_${batchId}.jpg`;
  a.click();
  URL.revokeObjectURL(url);
};

export const getCheckprintPreview = async (
  batchId: string,
  page = 1,
): Promise<{ image: string; pageCount: number }> => {
  const resp = await api.get(`/api/v1/pid/highlighted/${batchId}/preview`, {
    params: { page },
    timeout: 60000,
  });
  const { status, base64_image, page_count } = resp.data;
  if (status === 'SUCCESS' && base64_image) {
    return { image: `data:image/jpeg;base64,${base64_image}`, pageCount: page_count || 1 };
  }
  throw new Error('Failed to preview the extraction checkprint.');
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const downloadBatchResults = async (batchId: string): Promise<void> => {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const resp = await api.get(`/api/v1/pid/download/${batchId}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([resp.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Results_${batchId}.zip`);
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
