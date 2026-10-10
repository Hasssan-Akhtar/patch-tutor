import * as assert from 'node:assert';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as vscode from 'vscode';
import type { PatchTutorTestApi } from '../../src/extension';

const KEY = 'test-secret-key-123';

interface Seen {
  method: string;
  path: string;
  auth: string | undefined;
  body: string;
}

suite('providers through the settings screen', () => {
  let api: PatchTutorTestApi;
  let server: http.Server;
  let baseUrl: string;
  const seen: Seen[] = [];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<PatchTutorTestApi>('patch-tutor.patch-tutor');
    assert.ok(extension);
    api = await extension.activate();
    api.setProviderOverride(undefined);

    // A minimal OpenAI-compatible server on localhost; no real network is used.
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          path: req.url ?? '',
          auth: req.headers.authorization,
          body,
        });
        res.setHeader('content-type', 'application/json');
        if (req.headers.authorization !== `Bearer ${KEY}`) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
        } else if (req.method === 'GET' && req.url === '/v1/models') {
          res.end(JSON.stringify({ data: [{ id: 'tiny-model' }, { id: 'big-model' }] }));
        } else if (req.method === 'POST' && req.url === '/v1/chat/completions') {
          res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: { message: 'no such route' } }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  suiteTeardown(async () => {
    const config = vscode.workspace.getConfiguration('patchTutor');
    for (const key of ['provider', 'model', 'baseUrl']) {
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
    await api.providers.deleteKey('openaiCompatible');
    await new Promise((resolve) => server.close(resolve));
  });

  test('a wrong key is reported, models load, and saving keeps the key out of settings', async () => {
    const form = { provider: 'openaiCompatible' as const, model: 'tiny-model', baseUrl };

    const wrong = await api.chat.testSettings({ ...form, key: 'wrong-key' });
    assert.strictEqual(wrong.ok, false);
    assert.match(wrong.text, /rejected the API key \(Incorrect API key provided\)/);

    const loaded = await api.chat.loadModels({ ...form, key: KEY });
    assert.deepStrictEqual(
      loaded.models.map((m) => m.id),
      ['big-model', 'tiny-model'],
    );

    const tested = await api.chat.testSettings({ ...form, key: KEY });
    assert.strictEqual(tested.ok, true, tested.text);

    const saved = await api.chat.saveSettings({ ...form, key: KEY });
    assert.strictEqual(saved.ok, true, saved.text);

    // Provider, model and URL are settings; the key is only in secret storage.
    const config = vscode.workspace.getConfiguration('patchTutor');
    assert.strictEqual(config.get('provider'), 'openaiCompatible');
    assert.strictEqual(config.get('model'), 'tiny-model');
    assert.strictEqual(config.get('baseUrl'), baseUrl);
    assert.ok(!JSON.stringify(config).includes(KEY), 'API key leaked into settings');
    assert.strictEqual(await api.providers.hasKey('openaiCompatible'), true);

    const state = api.chat.state();
    assert.match(state.modelLabel, /OpenAI-compatible · tiny-model/);
    assert.ok(!JSON.stringify(state).includes(KEY), 'API key sent to the webview state');
    assert.strictEqual(
      state.settings.providers.find((p) => p.id === 'openaiCompatible')?.keySaved,
      true,
    );
  });

  test('the saved provider is used for real requests, reading the key from secret storage', async () => {
    seen.length = 0;

    const reply = await api.providers.create().complete({
      system: 'You are a test.',
      user: 'Say OK.',
      maxTokens: 10,
    });

    assert.strictEqual(reply, 'OK');
    const request = seen.find((s) => s.path === '/v1/chat/completions');
    assert.strictEqual(request?.auth, `Bearer ${KEY}`);
    assert.strictEqual(JSON.parse(request.body).model, 'tiny-model');
  });

  test('rejects malformed base URLs before making any request', async () => {
    seen.length = 0;

    const result = await api.chat.testSettings({
      provider: 'openaiCompatible',
      model: 'm',
      baseUrl: 'ftp://example.com',
    });

    assert.strictEqual(result.ok, false);
    assert.match(result.text, /http:\/\/ or https:\/\//);
    assert.strictEqual(seen.length, 0);
  });
});
