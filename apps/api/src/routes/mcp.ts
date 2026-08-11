import { Hono } from 'hono';
import { config } from '../config';
import type { AppEnv } from '../context';
import { renderItinerary, runTool, TOOL_DEFINITIONS, toolSchemas, type ToolName } from '../mcp/server';
import { verifyAccessToken, type AccessContext } from './oauth';
import { trips } from '@trip/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

const ok = (id: JsonRpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const fail = (id: JsonRpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id,
  error: { code, message },
});

/**
 * The MCP server, reached over HTTP by any client that can get a token.
 *
 * JSON-RPC is handled directly rather than through the SDK's transport: every
 * piece of the SDK's server side is written against Express request and
 * response objects, and this is a Hono app. The wire format is small and fixed,
 * and the schemas the tools validate against are the same ones the app uses.
 */
export function mcpRoutes() {
  const app = new Hono<AppEnv>();

  app.all('/', async (c) => {
    const header = c.req.header('authorization') ?? '';
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;

    if (!bearer) {
      /*
       * The challenge is how a client discovers where to get a token. Without
       * the resource_metadata hint it would have nothing to go on but a 401.
       */
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': `Bearer resource_metadata="${config.PUBLIC_URL}/.well-known/oauth-protected-resource"`,
      });
    }

    const access = verifyAccessToken(c.var.services.db, bearer);
    if (!access) {
      return c.json({ error: 'invalid_token' }, 401, {
        'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${config.PUBLIC_URL}/.well-known/oauth-protected-resource"`,
      });
    }

    if (c.req.method === 'GET') {
      // No server-initiated stream. Everything these tools do is a reply to a
      // request, so there is nothing to push.
      return c.body(null, 405);
    }

    const body = (await c.req.json().catch(() => null)) as JsonRpcRequest | null;
    if (!body || body.jsonrpc !== '2.0') return c.json(fail(null, -32600, 'Invalid request'), 400);

    return c.json(await handle(c, body, access));
  });

  return app;
}

async function handle(
  c: { var: AppEnv['Variables'] },
  request: JsonRpcRequest,
  access: AccessContext,
): Promise<unknown> {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'trip-planner', version: '0.1.0' },
      });

    case 'notifications/initialized':
      return ok(id, {});

    case 'tools/list':
      return ok(id, {
        tools: TOOL_DEFINITIONS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: z.toJSONSchema(toolSchemas[tool.name as ToolName], { io: 'input' }),
        })),
      });

    case 'tools/call': {
      const call = params as { name?: string; arguments?: unknown } | undefined;
      const name = call?.name as ToolName | undefined;

      if (!name || !(name in toolSchemas)) {
        return fail(id, -32602, `No tool called ${String(call?.name)}`);
      }

      try {
        const result = await runTool({ services: c.var.services, access }, name, call?.arguments);
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (error) {
        /*
         * Returned as a tool result rather than a protocol error. A refusal or
         * a missing event is something the model should read and act on, not a
         * transport failure it cannot see.
         */
        return ok(id, {
          isError: true,
          content: [{ type: 'text', text: (error as Error).message }],
        });
      }
    }

    case 'resources/list':
      return ok(id, {
        resources: access.grantedTripIds.map((tripId) => ({
          uri: `trip://${tripId}/itinerary`,
          name: 'Itinerary',
          mimeType: 'text/markdown',
        })),
      });

    case 'resources/read': {
      const uri = (params as { uri?: string } | undefined)?.uri ?? '';
      const tripId = /^trip:\/\/([^/]+)\/itinerary$/.exec(uri)?.[1];

      if (!tripId || !access.grantedTripIds.includes(tripId)) {
        return fail(id, -32602, 'No such resource');
      }

      const doc = c.var.services.docs.load(tripId);
      const trip = c.var.services.db.select().from(trips).where(eq(trips.id, tripId)).get();
      if (!doc || !trip) return fail(id, -32602, 'No such resource');

      return ok(id, {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: renderItinerary(doc as never, trip.name),
          },
        ],
      });
    }

    default:
      return fail(id, -32601, `Unknown method ${method}`);
  }
}
