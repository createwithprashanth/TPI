import api from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface MatchBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

export interface DetectResponse {
  status: string;
  count: number;
  label: string;
  threshold: number;
  matches: MatchBox[];
  annotated_image: string;
  image_width: number;
  image_height: number;
}

export interface PageResult {
  page: number;
  count: number;
  matches: MatchBox[];
}

export interface AllPagesDetectResponse {
  status: string;
  total_count: number;
  pages: PageResult[];
  annotated_image: string;
  image_width: number;
  image_height: number;
}

export interface LibrarySymbol {
  id: string;
  name: string;
  thumbnail: string;
  templateImage: string;
  createdAt: string;
}

// ── Symbol Library ─────────────────────────────────────────────────────────

export const fetchLibrary = async (): Promise<LibrarySymbol[]> => {
  const resp = await api.get('/api/v1/mto/library');
  return resp.data;
};

export const saveLibrarySymbol = async (entry: LibrarySymbol): Promise<LibrarySymbol> => {
  const resp = await api.post('/api/v1/mto/library', entry);
  return resp.data;
};

export const updateLibrarySymbol = async (
  id: string,
  patch: Partial<LibrarySymbol>,
): Promise<LibrarySymbol> => {
  const resp = await api.put(`/api/v1/mto/library/${id}`, patch);
  return resp.data;
};

export const deleteLibrarySymbol = async (id: string): Promise<void> => {
  await api.delete(`/api/v1/mto/library/${id}`);
};

// ── Detection ──────────────────────────────────────────────────────────────

export const detectSymbol = async ({
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
}): Promise<DetectResponse> => {
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
  form.append('coord_dpi', '300');
  const resp = await api.post('/api/v1/mto/detect', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
  return resp.data;
};

export const detectSymbolAllPages = async ({
  pidFile,
  templateBox,
  threshold = 0.70,
  label = 'Symbol',
}: {
  pidFile: File;
  templateBox: { x1: number; y1: number; x2: number; y2: number };
  threshold?: number;
  label?: string;
}): Promise<AllPagesDetectResponse> => {
  const form = new FormData();
  form.append('pid_file', pidFile);
  form.append('template_x1', String(templateBox.x1));
  form.append('template_y1', String(templateBox.y1));
  form.append('template_x2', String(templateBox.x2));
  form.append('template_y2', String(templateBox.y2));
  form.append('threshold', String(threshold));
  form.append('label', label);
  form.append('coord_dpi', '300');
  const resp = await api.post('/api/v1/mto/detect-all-pages', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  });
  return resp.data;
};

export const detectFromLibrary = async ({
  pidFile,
  templateImageBase64,
  threshold = 0.70,
  label = 'Symbol',
}: {
  pidFile: File;
  templateImageBase64: string;
  threshold?: number;
  label?: string;
}): Promise<AllPagesDetectResponse> => {
  const form = new FormData();
  form.append('pid_file', pidFile);
  const byteArr = Uint8Array.from(atob(templateImageBase64), c => c.charCodeAt(0));
  form.append('template_image', new Blob([byteArr], { type: 'image/png' }), 'template.png');
  form.append('threshold', String(threshold));
  form.append('label', label);
  form.append('template_dpi', '300');
  const resp = await api.post('/api/v1/mto/detect-from-library', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  });
  return resp.data;
};
