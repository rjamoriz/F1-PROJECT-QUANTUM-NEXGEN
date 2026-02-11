import axios from 'axios';
import { BACKEND_API_BASE, LOCALHOST_URL_MAP } from './endpoints';

let configured = false;

function rewriteAbsoluteUrl(url) {
  if (typeof url !== 'string' || !url) return url;

  for (const [source, target] of Object.entries(LOCALHOST_URL_MAP)) {
    if (url.startsWith(source) && target && source !== target) {
      return `${target}${url.slice(source.length)}`;
    }
  }

  return url;
}

export function configureHttpClient() {
  if (configured) return;

  configured = true;
  const timeoutMs = Number(process.env.REACT_APP_HTTP_TIMEOUT_MS || 30000);
  axios.defaults.timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;

  axios.interceptors.request.use((config) => {
    const nextConfig = { ...config };
    const rawUrl = nextConfig.url;
    const rewritten = rewriteAbsoluteUrl(rawUrl);

    if (typeof rewritten === 'string' && rewritten.startsWith('/api/')) {
      nextConfig.url = `${BACKEND_API_BASE}${rewritten}`;
    } else {
      nextConfig.url = rewritten;
    }

    return nextConfig;
  });
}
