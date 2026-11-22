import type { Attribution, License, ToolPayload } from '../types.js';

function byteLength(payload: ToolPayload): number {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

/**
 * Enforce `MAX_RESULT_BYTES` centrally (finding M3). Bulky text is clipped
 * first, then long arrays; provenance (license/attribution/source) is never
 * dropped. `truncated` is set whenever clipping occurred.
 */
export function enforceResultLimit(payload: ToolPayload, maxBytes: number): ToolPayload {
  if (byteLength(payload) <= maxBytes) return payload;
  const result: ToolPayload = { ...payload, truncated: true };

  for (const key of ['content', 'extract', 'description'] as const) {
    const value = result[key];
    if (typeof value !== 'string') continue;
    const overhead = byteLength(result) - Buffer.byteLength(value, 'utf8');
    const allowance = Math.max(0, maxBytes - overhead - 64);
    result[key] = value.slice(0, allowance);
    if (byteLength(result) <= maxBytes) return result;
  }

  for (const key of ['items', 'media', 'results', 'related', 'languages', 'sections', 'pages'] as const) {
    const value = result[key];
    if (!Array.isArray(value)) continue;
    while (value.length > 0 && byteLength(result) > maxBytes) value.pop();
    if (byteLength(result) <= maxBytes) return result;
  }

  // Last resort: retain only provenance and a title, never a licence claim loss.
  return {
    truncated: true,
    ...(typeof result['title'] === 'string' ? { title: result['title'] } : {}),
    ...(typeof result['source'] === 'string' ? { source: result['source'] } : {}),
    ...(result['license'] !== undefined ? { license: result['license'] as License } : {}),
    ...(result['attribution'] !== undefined ? { attribution: result['attribution'] as Attribution } : {}),
  };
}
