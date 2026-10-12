// @vitest-environment happy-dom
import type {
  Window as DomWindow,
  HTMLElement,
  HTMLInputElement,
  HTMLSelectElement,
} from 'happy-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { chatShellHtml, isSmallModel, type ChatState } from '../../src/ui/chat/chatHtml';

// DOM types come from happy-dom so the project itself stays without the DOM lib.
const window = globalThis as unknown as DomWindow;
const document = window.document;
const posted: Record<string, unknown>[] = [];

const state = (model: string): ChatState => ({
  tab: 'settings',
  modelLabel: 'Anthropic',
  settings: {
    active: { provider: 'anthropic', model, baseUrl: '' },
    providers: [
      {
        id: 'anthropic',
        label: 'Anthropic',
        detail: 'Claude models.',
        usesKey: true,
        usesBaseUrl: false,
        defaultBaseUrl: '',
        defaultModel: 'claude-opus-5-5',
        keySaved: true,
      },
    ],
    presets: [],
    version: 1,
  },
  history: [],
});

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

function send(data: unknown): void {
  window.dispatchEvent(new window.MessageEvent('message', { data }));
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Loads the real page and runs its script against a fake VS Code API. */
function openSettings(model: string): void {
  const html = chatShellHtml({ nonce: 'n', cspSource: 's', avatarUri: 'a' });
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  const script = document.querySelector('script')?.textContent ?? '';
  document.querySelector('script')?.remove();
  Object.assign(globalThis, {
    acquireVsCodeApi: () => ({ postMessage: (m: Record<string, unknown>) => posted.push(m) }),
  });
  new Function(script)();
  send({ type: 'state', state: state(model) });
  send({ type: 'models', provider: 'anthropic', models: MODELS });
}

/** Switches the open page to VS Code models with `models` listed. */
function openVscodeModels(models: { id: string; label: string }[]): void {
  openSettings('');
  const base = state('');
  send({
    type: 'state',
    state: {
      ...base,
      settings: {
        ...base.settings,
        active: { provider: 'vscodeLm', model: '', baseUrl: '' },
        providers: [
          {
            id: 'vscodeLm',
            label: 'VS Code models',
            detail: 'Copilot.',
            usesKey: false,
            usesBaseUrl: false,
            defaultBaseUrl: '',
            defaultModel: '',
            keySaved: false,
          },
        ],
        version: 2,
      },
    },
  });
  send({ type: 'models', provider: 'vscodeLm', models });
}

function lastForm(): Record<string, unknown> | undefined {
  return posted.filter((m) => m.action === 'saveSettings').at(-1)?.form as
    Record<string, unknown> | undefined;
}

beforeEach(() => {
  posted.length = 0;
});

describe('model picker', () => {
  it('lists every model even after one is chosen', () => {
    openSettings('claude-haiku-5-5');
    const select = $<HTMLSelectElement>('model-select');

    expect(select.hidden).toBe(false);
    expect(select.value).toBe('claude-haiku-5-5');
    expect([...select.options].map((o) => o.value)).toEqual([
      '',
      ...MODELS.map((m) => m.id),
      '__other__',
    ]);
    expect($('model').hidden).toBe(true);
  });

  it('saves the chosen model, or the default when none is chosen', () => {
    openSettings('');
    const select = $<HTMLSelectElement>('model-select');
    expect(select.value).toBe('');

    select.value = 'claude-haiku-4-5-20251001';
    select.dispatchEvent(new window.Event('change'));
    $('settings').querySelector<HTMLElement>('[data-action="saveSettings"]')?.click();

    expect(lastForm()).toMatchObject({ model: 'claude-haiku-4-5-20251001' });
  });

  it('keeps an unlisted model under "Other…" with its name editable', () => {
    openSettings('claude-custom-1');
    const select = $<HTMLSelectElement>('model-select');
    const input = $<HTMLInputElement>('model');

    expect(select.value).toBe('__other__');
    expect(input.hidden).toBe(false);
    expect(input.value).toBe('claude-custom-1');

    input.value = 'claude-custom-2';
    $('settings').querySelector<HTMLElement>('[data-action="saveSettings"]')?.click();
    expect(lastForm()).toMatchObject({ model: 'claude-custom-2' });
  });

  it('warns that a small model makes more mistakes, and only for small models', () => {
    openSettings('');
    const hint = $('model-small');
    expect(hint.hidden).toBe(true); // Default (claude-opus-5-5)

    const select = $<HTMLSelectElement>('model-select');
    select.value = 'claude-haiku-5-5';
    select.dispatchEvent(new window.Event('change'));
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toMatch(/Small models are fast but make more mistakes/);

    select.value = 'claude-opus-5-5';
    select.dispatchEvent(new window.Event('change'));
    expect(hint.hidden).toBe(true);
  });

  it('warns when the default VS Code model is a small one', () => {
    openVscodeModels([
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
    ]);
    expect($('model-small').hidden).toBe(false);
  });

  it('recognizes small model names without false alarms', () => {
    for (const name of [
      'GPT-4o mini',
      'gpt-4o-mini',
      'Claude Haiku 5.5',
      'Gemini 2.0 Flash',
      'gpt-5-nano',
      'Flash-Lite',
    ]) {
      expect(isSmallModel(name), name).toBe(true);
    }
    for (const name of ['GPT-4.1', 'Gemini 2.5 Pro', 'claude-opus-5-5', 'Choose a model', '']) {
      expect(isSmallModel(name), name).toBe(false);
    }
  });

  it('names the first listed model as the default for VS Code models', () => {
    openSettings('');
    const vscodeLm = {
      id: 'vscodeLm',
      label: 'VS Code models',
      detail: 'Copilot.',
      usesKey: false,
      usesBaseUrl: false,
      defaultBaseUrl: '',
      defaultModel: '',
      keySaved: false,
    };
    const base = state('');
    send({
      type: 'state',
      state: {
        ...base,
        settings: {
          ...base.settings,
          active: { provider: 'vscodeLm', model: '', baseUrl: '' },
          providers: [vscodeLm],
          version: 2,
        },
      },
    });
    send({ type: 'models', provider: 'vscodeLm', models: [{ id: 'gpt-x', label: 'GPT X' }] });

    const select = $<HTMLSelectElement>('model-select');
    expect(select.value).toBe('');
    expect(select.options[0]?.textContent).toBe('Default (GPT X)');
  });

  it('falls back to a text field when no models are listed', () => {
    openSettings('my-model');
    send({ type: 'models', provider: 'anthropic', models: [], error: 'HTTP 400' });

    expect($('model-select').hidden).toBe(true);
    expect($<HTMLInputElement>('model').value).toBe('my-model');
    expect($('model-status').textContent).toBe('HTTP 400');
  });

  it('shows the chosen model on a themed dropdown and picks from its list', () => {
    openSettings('claude-haiku-5-5');
    const button = $('model-select').parentElement?.querySelector<HTMLElement>('.dd-button');
    expect(button?.textContent).toContain('Claude Haiku 5.5');

    button?.click();
    const list = $('model-select').parentElement?.querySelector<HTMLElement>('.dd-list');
    expect(list?.hidden).toBe(false);
    const option = [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find((o) =>
      o.textContent?.includes('Claude Opus 5.5'),
    );
    option?.click();

    expect(list?.hidden).toBe(true);
    expect($<HTMLSelectElement>('model-select').value).toBe('claude-opus-5-5');
    $('settings').querySelector<HTMLElement>('[data-action="saveSettings"]')?.click();
    expect(lastForm()).toMatchObject({ model: 'claude-opus-5-5' });
  });

  it('hides the themed dropdown along with its list', () => {
    openSettings('my-model');
    send({ type: 'models', provider: 'anthropic', models: [] });

    expect(($('model-select').parentElement as HTMLElement).hidden).toBe(true);
  });
});
