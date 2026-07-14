import { getResourceSecret } from './store';
import { Task } from './types';

/**
 * Outbound notifications. If the workspace has a 'slack-webhook' resource
 * (secret = incoming-webhook URL), important task events are posted there.
 * Fire-and-forget: notification failures never affect task state.
 */
export function notifySlack(task: Task, text: string) {
  try {
    const url = getResourceSecret(task.workspaceId, 'slack-webhook');
    if (!url || !url.startsWith('https://hooks.slack.com/')) return;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => {});
  } catch {
    /* never let notifications break the pipeline */
  }
}
