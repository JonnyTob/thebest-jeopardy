import { brandingSchema } from '../shared/protocol';

const element = document.getElementById('app-branding');
if (!element?.textContent) throw new Error('Branding configuration is missing. Reload the page or ask the host to restart the server.');
export const branding = brandingSchema.parse(JSON.parse(element.textContent));
