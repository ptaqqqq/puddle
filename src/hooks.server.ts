import type { Handle, HandleFetch } from '@sveltejs/kit';
import { initWSSOnPort } from '$lib/server/ws';

export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/ws')) {
    // rewrite to your upstream API
    url.hostname = 'localhost';
    url.port = '3001';
    url.protocol = 'ws:';
    return fetch(url, { headers: request.headers });
  }
  return fetch(request);
};

export const handle: Handle = async ({ event, resolve }) => {
  // start once in dev; in prod you can keep this too
  if (process.env.NODE_ENV !== 'test') initWSSOnPort(3001);
  return resolve(event);
};
