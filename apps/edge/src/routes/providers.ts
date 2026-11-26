import { Hono } from 'hono';
import type { EdgeBindings, EdgeVariables } from '../app.js';

export function createProvidersRouter() {
  const router = new Hono<{ Bindings: EdgeBindings; Variables: EdgeVariables }>();

  router.get('/status', (c) => {
    const ytStatus = c.env.YOUTUBE_API_KEY
      ? 'api_key_active'
      : 'public_feed_active';
    const twitchStatus =
      c.env.TWITCH_CLIENT_ID && c.env.TWITCH_CLIENT_SECRET
        ? 'ready'
        : 'credentials_missing';
    const kickStatus =
      c.env.KICK_CLIENT_ID && c.env.KICK_CLIENT_SECRET
        ? 'ready'
        : 'credentials_missing';

    return c.json({
      providers: {
        youtube: {
          status: ytStatus,
          label:
            ytStatus === 'api_key_active'
              ? 'YouTube API Key Active'
              : 'YouTube Public Feed Active',
        },
        twitch: {
          status: twitchStatus,
          label:
            twitchStatus === 'ready'
              ? 'Twitch Helix Ready'
              : 'Twitch Needs API Keys',
        },
        kick: {
          status: kickStatus,
          label:
            kickStatus === 'ready'
              ? 'Kick Public API Ready'
              : 'Kick Needs API Keys',
        },
      },
      source: 'edge',
      asOf: new Date().toISOString(),
    });
  });

  return router;
}
