import type { McpServer } from '@modelcontextprotocol/server';

/** Minimal Phase 1 resources: a static capability/status document. */
export function registerMinimalResources(server: McpServer): void {
  server.registerResource(
    'server-info',
    'wikimedia://server/info',
    {
      title: 'Wikimedia MCP server information',
      description: 'Static read-only information about this server.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          name: 'wikimedia-mcp',
          version: '1.0.0',
          protocolVersion: '2026-07-28',
          tools: 9,
          readOnly: true,
        }),
      }],
    }),
  );
}
