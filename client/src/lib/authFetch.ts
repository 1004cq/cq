/**
 * authFetch — 自动携带 Bearer Token 的 fetch 封装
 *
 * 用法与原生 fetch 完全一致，只需将 `fetch(url, options)` 替换为
 * `authFetch(url, options)` 即可。
 *
 * - 自动从 localStorage 读取 `user_token` 并注入 Authorization 头
 * - 若 token 不存在则不注入（兼容公开接口）
 * - 支持自定义 headers，自定义 Authorization 优先级更高
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = localStorage.getItem('user_token');
  const headers = new Headers(init.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}

/**
 * authApi — 基于 authFetch 的 JSON API 快捷方法
 *
 * @param path  API 路径（相对或绝对）
 * @param body  若传入则使用 POST，否则使用 GET
 * @param method 可覆盖 HTTP 方法（如 'PUT', 'DELETE'）
 */
export async function authApi(
  path: string,
  body?: unknown,
  method?: string
): Promise<any> {
  const resolvedMethod = method ?? (body !== undefined ? 'POST' : 'GET');
  const res = await authFetch(path, {
    method: resolvedMethod,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}
