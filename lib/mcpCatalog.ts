import { ResourceKind } from './types';

/**
 * Curated catalog of MCP servers & credentials, used by the Resources UI for
 * one-click registration. Pure data — safe to import from client components.
 *
 * Note: hosted MCP servers authenticate with OAuth bearer tokens (or, for
 * some, static API tokens) — NOT the service's normal REST API key. The
 * tokenHint says what to paste.
 */

export interface McpCatalogEntry {
  name: string;
  kind: ResourceKind;
  url: string | null;
  description: string;
  tokenHint: string;
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    name: 'github-mcp',
    kind: 'mcp',
    url: 'https://api.githubcopilot.com/mcp/',
    description: 'Repos, issues, PRs, code review',
    tokenHint: 'GitHub personal access token (fine-grained, repo scope) — works as bearer token',
  },
  {
    name: 'vercel-mcp',
    kind: 'mcp',
    url: 'https://mcp.vercel.com',
    description: 'Deployments, build logs, projects, rollbacks',
    tokenHint: 'Vercel OAuth access token (the server uses OAuth; a Vercel dashboard API token may not work)',
  },
  {
    name: 'linear-mcp',
    kind: 'mcp',
    url: 'https://mcp.linear.app/mcp',
    description: 'Issues, projects, cycles — two-way task sync',
    tokenHint: 'Linear OAuth access token (MCP server is OAuth-only; Linear API keys are not accepted)',
  },
  {
    name: 'sentry-mcp',
    kind: 'mcp',
    url: 'https://mcp.sentry.dev/mcp',
    description: 'Errors, issues, traces — incident-investigation tasks',
    tokenHint: 'Sentry OAuth access token (via the MCP OAuth flow) — org auth tokens may work as bearer',
  },
  {
    name: 'notion-mcp',
    kind: 'mcp',
    url: 'https://mcp.notion.com/mcp',
    description: 'Docs & knowledge base as agent context',
    tokenHint: 'Notion MCP OAuth token — NOT an ntn_… integration key (different auth system)',
  },
  {
    name: 'figma-mcp',
    kind: 'mcp',
    url: 'https://mcp.figma.com/mcp',
    description: 'Design files & Dev Mode context for design-to-code tasks',
    tokenHint: 'Figma OAuth access token (remote MCP server; the local Dev Mode server needs no token)',
  },
  {
    name: 'stripe-mcp',
    kind: 'mcp',
    url: 'https://mcp.stripe.com',
    description: 'Customers, invoices, payments',
    tokenHint: 'Stripe restricted API key (rk_…) or secret key — sent as bearer token',
  },
  {
    name: 'slack-webhook',
    kind: 'credential',
    url: null,
    description: 'Posts a Slack message when a task completes or blocks',
    tokenHint: 'Slack incoming-webhook URL (https://hooks.slack.com/services/…) — paste it as the secret',
  },
];
