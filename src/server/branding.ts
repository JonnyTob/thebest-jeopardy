import type { Branding } from '../shared/protocol.js';

export function renderBrandingHtml(html: string, branding: Branding): string {
  const name = branding.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const json = JSON.stringify(branding).replace(/</g, '\\u003c');
  return html.replace(/__APP_NAME__|__APP_BRANDING_JSON__/g,
    (placeholder) => placeholder === '__APP_NAME__' ? name : json);
}
