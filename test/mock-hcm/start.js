import http from 'http';
import { createServer } from './server.js';

let _server = null;
let _cleanup = null;

/**
 * Starts the mock HCM server on the given port.
 * Call in beforeAll of integration test suites.
 *
 * @param {number} [port=3099]
 * @returns {Promise<http.Server>}
 */
export async function startMockHcm(port = 3099) {
  const { app, cleanup } = createServer();
  _cleanup = cleanup;
  _server = http.createServer(app);

  await new Promise((resolve, reject) => {
    _server.once('error', reject);
    _server.listen(port, () => resolve());
  });

  return _server;
}

/**
 * Stops the mock HCM server and cleans up hanging connections.
 * Call in afterAll of integration test suites.
 *
 * @returns {Promise<void>}
 */
export async function stopMockHcm() {
  if (_cleanup) {
    _cleanup();
    _cleanup = null;
  }
  if (_server) {
    // Force-close any keep-alive / hanging connections (Node 18.2+)
    if (typeof _server.closeAllConnections === 'function') {
      _server.closeAllConnections();
    }
    await new Promise((resolve) => _server.close(resolve));
    _server = null;
  }
}
