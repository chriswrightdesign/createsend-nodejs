import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Createsend } from '../createsend.js';
import { tools as toolDefs, type CreatesendToolDef } from './tools.generated.js';

const SERVER_NAME = 'createsend';
const SERVER_VERSION = '0.1.0';

export type CreatesendMcpOptions = {
  apiKey?: string;
  baseUrl?: string;
  userAgent?: string;
};

/**
 * Construct an MCP server exposing every Campaign Monitor API operation as a tool.
 * The caller is responsible for connecting a transport (e.g. StdioServerTransport).
 */
export function createServer(options: CreatesendMcpOptions = {}): Server {
  const apiKey = options.apiKey ?? process.env.CREATESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing API key. Set CREATESEND_API_KEY or pass { apiKey } to createServer().',
    );
  }
  const cs = new Createsend(apiKey, {
    baseUrl: options.baseUrl,
    userAgent: options.userAgent ?? `${SERVER_NAME}-mcp/${SERVER_VERSION}`,
  });

  const byName = new Map<string, CreatesendToolDef>();
  for (const t of toolDefs) byName.set(t.name, t);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const list: Tool[] = toolDefs.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Tool['inputSchema'],
    }));
    return { tools: list };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
      };
    }

    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const resource = (cs as unknown as Record<string, Record<string, Function>>)[tool.accessor];
    const fn = resource?.[tool.method];
    if (typeof fn !== 'function') {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Tool ${tool.name} maps to cs.${tool.accessor}.${tool.method}() which is not callable.`,
          },
        ],
      };
    }

    try {
      const hasArgs = Object.keys(tool.inputSchema.properties ?? {}).length > 0;
      const result = hasArgs ? await fn.call(resource, args) : await fn.call(resource);
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.error, null, 2),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              result && typeof result === 'object' && 'data' in result ? result.data : result,
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      };
    }
  });

  return server;
}
