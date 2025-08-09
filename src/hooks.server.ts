import type { Handle } from '@sveltejs/kit';
import { initWSSOnPort } from '$lib/server/ws';

export const handle: Handle = async ({ event, resolve }) => {
  // start once in dev; in prod you can keep this too
  if (process.env.NODE_ENV !== 'test') initWSSOnPort(3000);
  return resolve(event);
};
