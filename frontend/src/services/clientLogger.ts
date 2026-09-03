type ClientLogLevel = 'info' | 'warning' | 'error';

const sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export function reportClientError(
  message: string,
  details?: { level?: ClientLogLevel; stack?: string; source?: string; status?: number },
) {
  const body = JSON.stringify({
    level: details?.level || 'error',
    message: String(message).slice(0, 1000),
    stack: String(details?.stack || '').slice(0, 4000),
    source: String(details?.source || window.location.pathname).slice(0, 500),
    status: details?.status,
    session_id: sessionId,
    user_agent: navigator.userAgent.slice(0, 500),
  });
  try {
    fetch('/api/v1/system/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Diagnostic logging must never interfere with the UI.
  }
}

export function installGlobalErrorLogging() {
  window.addEventListener('error', event => {
    reportClientError(event.message || 'Uncaught browser error', {
      stack: event.error?.stack,
      source: `${event.filename || window.location.pathname}:${event.lineno || 0}`,
    });
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    reportClientError(reason?.message || String(reason || 'Unhandled promise rejection'), {
      stack: reason?.stack,
      source: window.location.pathname,
    });
  });
}

