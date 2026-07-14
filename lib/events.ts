import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub feeding the per-workspace SSE streams. Every store
 * mutation publishes to its workspace channel; connected clients refetch.
 * (Multi-instance deployments would swap this for Redis pub/sub.)
 */

const g = globalThis as unknown as { __agentboardEmitter?: EventEmitter };

function emitter(): EventEmitter {
  if (!g.__agentboardEmitter) {
    g.__agentboardEmitter = new EventEmitter();
    g.__agentboardEmitter.setMaxListeners(0);
  }
  return g.__agentboardEmitter;
}

export function publish(workspaceId: string) {
  emitter().emit(workspaceId);
}

export function subscribe(workspaceId: string, fn: () => void): () => void {
  emitter().on(workspaceId, fn);
  return () => emitter().off(workspaceId, fn);
}
