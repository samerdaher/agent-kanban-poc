import { listAllMcpResources, setResourceHealth, getResourceSecret } from './store';

/**
 * Resource health: MCP initialize handshake against every registered server
 * using its vaulted token. Sets health to 'ok' | 'auth' | 'error'.
 * Best-effort, sequential, never throws.
 */
export async function checkResourceHealth(): Promise<void> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agentboard-health', version: '1.0' } },
  });

  for (const r of listAllMcpResources()) {
    try {
      const token = getResourceSecret(r.workspaceId, r.name);
      const res = await fetch(r.url as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(12000),
      });
      const ok = res.status === 200;
      setResourceHealth(r.id, ok ? 'ok' : res.status === 401 || res.status === 403 ? 'auth' : 'error');
    } catch {
      setResourceHealth(r.id, 'error');
    }
  }
}
