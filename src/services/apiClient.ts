import type { FactSnapshot, Capabilities, CatalogResponse, PublicUser, ServerProduct, ServerTask } from '../../shared/contracts';
import type { ImportPreview, Listing, Platform, Task } from '../types';

export const SERVER_MODE = typeof window !== 'undefined' && import.meta.env?.MODE !== 'competition' && new URLSearchParams(window.location.search).get('mode') !== 'local';
export class ApiError extends Error { constructor(public code: string, message: string, public status = 0) { super(message); } }
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', signal: controller.signal, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('prismlaunch:unauthorized'));
      throw new ApiError(json?.error?.code ?? 'api_unavailable', json?.error?.message ?? 'The local API is unavailable.', response.status);
    }
    return (json?.data ?? json) as T;
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('api_unavailable', 'The local API is unavailable.'); }
  finally { clearTimeout(timer); }
}
const factPath = (taskId: string, productId: string) => `/tasks/${encodeURIComponent(taskId)}/products/${encodeURIComponent(productId)}`;
export const apiClient = {
  health: () => request<{ status: string; service: string }>('/health'),
  auth: {
    login: (email: string, password: string) => request<PublicUser>('/auth/login', 'POST', { email, password }),
    logout: () => request<{ ok: true }>('/auth/logout', 'POST', {}),
    me: () => request<PublicUser>('/auth/me'),
  },
  products: {
    list: () => request<CatalogResponse>('/products'),
    get: (id: string) => request<ServerProduct>(`/products/${encodeURIComponent(id)}`),
    import: (preview: ImportPreview, expectedRevision: number) => {
      const { products, ...report } = preview;
      return request<CatalogResponse>('/products/import', 'POST', { mode: preview.mode, products, expectedRevision, report });
    },
  },
  tasks: {
    list: () => request<ServerTask[]>('/tasks'),
    get: (id: string) => request<ServerTask>(`/tasks/${encodeURIComponent(id)}`),
    create: (task: Task) => request<ServerTask>('/tasks', 'POST', { code: task.id, platform: task.platform, market: task.market, category: task.category, requirements: task.requirements, minimumProfit: task.minProfit }),
    select: (taskId: string, sku: string, purpose: 'selected' | 'fact_review') => request<ServerTask>(`/tasks/${encodeURIComponent(taskId)}/selection`, 'POST', { productId: sku, purpose }),
  },
  facts: {
    list: (taskId: string) => request<FactSnapshot[]>(`/tasks/${encodeURIComponent(taskId)}/fact-snapshots`),
    getSnapshot: (taskId: string, productId: string) => request<FactSnapshot>(`${factPath(taskId, productId)}/fact-snapshot`),
    createV1: (taskId: string, productId: string) => request<FactSnapshot>(`${factPath(taskId, productId)}/fact-cards/v1`, 'POST', {}),
    analyze: (taskId: string, productId: string, expectedRevision: number) => request<FactSnapshot>(`${factPath(taskId, productId)}/analyze`, 'POST', { expectedRevision }),
    update: (id: string, value: string, expectedRevision: number) => request<FactSnapshot>(`/facts/${encodeURIComponent(id)}`, 'PATCH', { value, expectedRevision }),
    confirm: (id: string, expectedRevision: number) => request<FactSnapshot>(`/facts/${encodeURIComponent(id)}/confirm`, 'POST', { expectedRevision }),
    reject: (id: string, expectedRevision: number) => request<FactSnapshot>(`/facts/${encodeURIComponent(id)}/reject`, 'POST', { expectedRevision }),
    template: (taskId: string, productId: string, platform: Platform, revision: number, expectedRevision: number) => request<Listing>(`${factPath(taskId, productId)}/listing-template`, 'POST', { platform, revision, expectedRevision }),
  },
  capabilities: () => request<Capabilities>('/capabilities'),
  reset: () => request<CatalogResponse>('/demo/reset', 'POST', {}),
};
