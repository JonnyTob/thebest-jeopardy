import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandingSchema } from '../shared/protocol.js';
import { renderBrandingHtml } from './branding.js';

const template = '<title>__APP_NAME__</title><script id="app-branding" type="application/json">__APP_BRANDING_JSON__</script><h1>Loading __APP_NAME__</h1>';

test('branding renders title, loading screen and browser configuration from the same values', () => {
  const branding = { name: 'Custom Quiz', logoText: 'CQ', tagline: 'A different game.' };
  const html = renderBrandingHtml(template, branding);
  assert.match(html, /<title>Custom Quiz<\/title>/);
  assert.match(html, /<h1>Loading Custom Quiz<\/h1>/);
  assert.equal(html.includes('__APP_'), false);
  const json = html.match(/type="application\/json">([^]*?)<\/script>/)?.[1];
  assert.ok(json);
  assert.deepEqual(JSON.parse(json), branding);
});

test('branding escapes HTML and script-breaking text without changing the configured strings', () => {
  const branding = {
    name: '<b>Quiz & "Friends"</b>',
    logoText: '<K>',
    tagline: '</script><script>alert("not executed")</script>',
  };
  const html = renderBrandingHtml(template, branding);
  assert.match(html, /<title>&lt;b&gt;Quiz &amp; &quot;Friends&quot;&lt;\/b&gt;<\/title>/);
  assert.equal(html.includes('<b>'), false);
  assert.equal(html.includes('<script>alert'), false);
  const json = html.match(/type="application\/json">([^]*?)<\/script>/)?.[1];
  assert.ok(json);
  assert.deepEqual(JSON.parse(json), branding);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
});

test('placeholder-like branding strings are not replaced a second time', () => {
  const branding = { name: '__APP_BRANDING_JSON__', logoText: 'K', tagline: '__APP_NAME__' };
  const html = renderBrandingHtml(template, branding);
  assert.ok(html.startsWith('<title>__APP_BRANDING_JSON__</title>'));
  const json = html.match(/type="application\/json">([^]*?)<\/script>/)?.[1];
  assert.ok(json);
  assert.deepEqual(JSON.parse(json), branding);
});

test('branding validates names, short text logos and optional empty taglines', () => {
  const branding = { name: 'Kaboot', logoText: 'K', tagline: '' };
  assert.deepEqual(brandingSchema.parse(branding), branding);
  for (const invalid of [
    { ...branding, name: ' ' }, { ...branding, name: 'x'.repeat(101) },
    { ...branding, logoText: '' }, { ...branding, logoText: '12345' },
    { ...branding, tagline: 'x'.repeat(161) }, { ...branding, unknown: true },
  ]) {
    assert.equal(brandingSchema.safeParse(invalid).success, false);
  }
});
