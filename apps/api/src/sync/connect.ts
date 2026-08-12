import { createConnectRouter, type ConnectRouter, type ContextValues } from '@connectrpc/connect';
import {
  universalServerRequestFromFetch,
  universalServerResponseToFetch,
} from '@connectrpc/connect/protocol';

/**
 * Runs Connect handlers as part of the Hono app rather than beside it.
 *
 * Connect ships adapters that take over a Node server, which would put these
 * calls outside everything the rest of the API relies on -- the session cookie
 * that decides who is asking, and the logging that says a request arrived at
 * all. Both sides speak in fetch Requests and Responses, so translating between
 * them is enough to keep one way in.
 */
export function connectHandler(
  register: (router: ConnectRouter) => void,
  options: { prefix: string },
) {
  /*
   * Only the Connect protocol. gRPC needs HTTP trailers and gRPC-web is for
   * clients we do not have; the browser this serves speaks Connect, and turning
   * the other two off means there is one way in rather than three.
   */
  const router = createConnectRouter({ grpc: false, grpcWeb: false });
  register(router);

  // Handlers know their own path as `/package.Service/Method`, without whatever
  // the app happens to be mounted under.
  const byPath = new Map(router.handlers.map((handler) => [handler.requestPath, handler]));

  return async (request: Request, values: ContextValues): Promise<Response> => {
    const path = new URL(request.url).pathname.slice(options.prefix.length);
    const handler = byPath.get(path);

    if (!handler) {
      return new Response(JSON.stringify({ error: 'no_such_method' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    // HTTP/1.1 because that is what @hono/node-server speaks. The protocol
    // handler reads it to decide what it may use to end a stream.
    const universal = universalServerRequestFromFetch(request, { httpVersion: '1.1' });

    return universalServerResponseToFetch(await handler({ ...universal, contextValues: values }));
  };
}
