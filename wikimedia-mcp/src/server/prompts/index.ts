import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

/** Minimal Phase 1 prompt: guides a read-only research task. */
export function registerMinimalPrompts(server: McpServer): void {
  server.registerPrompt(
    'research-topic',
    {
      title: 'Research a Wikimedia topic',
      description: 'A short read-only research workflow for a topic.',
      argsSchema: z.object({ topic: z.string().min(1) }),
    },
    ({ topic }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Research '${topic}' using only read tools: search, then get_summary, then get_page/get_sections. Preserve licence and attribution in any answer.`,
        },
      }],
    }),
  );
}
