import axios from 'axios';
import { reportClientError } from './clientLogger';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30000,
});

api.interceptors.response.use(
  response => response,
  error => {
    const status = error?.response?.status as number | undefined;
    if (!status || status >= 500) {
      reportClientError(error?.message || 'API request failed', {
        source: `${error?.config?.method?.toUpperCase() || 'API'} ${error?.config?.url || ''}`,
        status,
        stack: error?.stack,
      });
    }
    return Promise.reject(error);
  },
);

export default api;
