import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The store path is module state; import after choosing a temp location.
process.env.DSH_MCP_OAUTH_PATH = '';
const oauth = await import('../lib/oauth.js');
oauth.setStorePath(join(mkdtempSync(join(tmpdir(), 'mcp-oauth-')), 'oauth.json'));

function mockProvider() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}`;
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
      }));
      return;
    }
    if (url.pathname === '/register') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ client_id: 'test-client' }));
      return;
    }
    if (url.pathname === '/authorize') {
      const redirect = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      res.writeHead(302, { location: `${redirect}?code=test-code&state=${state}` });
      res.end();
      return;
    }
    if (url.pathname === '/token') {
      let body = '';
      req.on('data', (chunk) => { body += String(chunk); });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          access_token: params.get('grant_type') === 'refresh_token' ? 'access-2' : 'access-1',
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          expires_in: 3600,
        }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('oauth discovery, PKCE, registration, exchange and refresh', async () => {
  const server = await mockProvider();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const metadata = await oauth.discover(base);
    assert.equal(metadata.token_endpoint, `${base}/token`);

    const challenge = oauth.pkce();
    const state = 'state-1';
    const listener = oauth.loopback(state);
    const port = await listener.port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const registered = await oauth.register(metadata, redirectUri);
    assert.equal(registered.client_id, 'test-client');

    const url = oauth.authorizationUrl(metadata, registered.client_id, redirectUri, challenge.challenge, state);
    const response = await fetch(url, { redirect: 'follow' });
    assert.equal(response.status, 200);
    const code = await listener.code;
    assert.equal(code, 'test-code');

    const token = await oauth.exchange(metadata, registered.client_id, code, challenge.verifier, redirectUri);
    assert.equal(token.access_token, 'access-1');
    assert.equal(oauth.isExpired(token), false);
    oauth.saveOauth('demo', { ...token, metadata, client_id: registered.client_id });
    assert.equal(oauth.oauthRecord('demo').access_token, 'access-1');

    const refreshed = await oauth.refresh(metadata, registered.client_id, oauth.oauthRecord('demo'));
    assert.equal(refreshed.access_token, 'access-2');
    oauth.removeOauth('demo');
    assert.equal(oauth.oauthRecord('demo'), undefined);
  } finally {
    server.close();
  }
});
