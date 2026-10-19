const API_BASE = '/api/v1';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody | null, fallback = 'Request failed') {
    super(body?.error.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error.code ?? 'REQUEST_FAILED';
    this.details = body?.error.details;
  }

  fieldErrors(): Record<string, string[]> {
    if (!this.details || typeof this.details !== 'object' || Array.isArray(this.details)) return {};
    const result: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(this.details as Record<string, unknown>)) {
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        result[key] = value as string[];
      }
    }
    return result;
  }
}

let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_BASE}/auth/csrf`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new ApiError(response.status, await readError(response));
        const body = (await response.json()) as { csrfToken: string };
        csrfToken = body.csrfToken;
        return body.csrfToken;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

async function readError(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type ApiInit = Omit<RequestInit, 'body'> & { body?: BodyInit | object | null };

export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  let body = init.body;
  if (body && !(body instanceof FormData) && typeof body !== 'string' && !(body instanceof Blob)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }

  if (MUTATING.has(method)) {
    headers.set('X-CSRF-Token', await ensureCsrf());
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    method,
    headers,
    body: body as BodyInit | null | undefined,
    credentials: 'include',
  });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('alche:session-expired'));
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const simple = /filename="?([^";]+)"?/i.exec(header);
  return simple?.[1] ?? fallback;
}

export async function apiDownload(path: string, fallbackFilename: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { Accept: 'text/csv' },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }

  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get('content-disposition'), fallbackFilename);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
