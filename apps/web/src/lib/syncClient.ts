import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { SyncService } from '@trip/proto';

/**
 * The trip sync service, as this browser talks to it.
 *
 * One transport for the whole app: it holds no per-trip state, and a client
 * made from it is a set of typed functions over ordinary fetch calls. Which
 * person is asking is decided by the session cookie the browser attaches, the
 * same as every other call to this origin.
 */
const transport = createConnectTransport({
  baseUrl: '/api/rpc',
  /*
   * Binary rather than JSON. Every message here carries an Automerge sync
   * message, which is bytes; the JSON format would base64 it and add a third to
   * the size of the traffic this app makes most of.
   */
  useBinaryFormat: true,
});

export const syncClient = createClient(SyncService, transport);
