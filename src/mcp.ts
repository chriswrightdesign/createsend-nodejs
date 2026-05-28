#!/usr/bin/env node
/**
 * Stdio MCP server entrypoint. Bundled into `dist/mcp.mjs` and exposed via the
 * `createsend-mcp` bin. Reads CREATESEND_API_KEY from the environment.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './mcp/server.js';

export { createServer } from './mcp/server.js';
export type { CreatesendMcpOptions } from './mcp/server.js';
export { tools, type CreatesendToolDef } from './mcp/tools.generated.js';

async function run() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run when invoked as a script, not when imported.
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('mcp.mjs') ||
    process.argv[1].endsWith('mcp.cjs') ||
    process.argv[1].endsWith('mcp.ts') ||
    process.argv[1].endsWith('createsend-mcp'));

if (invokedDirectly) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
