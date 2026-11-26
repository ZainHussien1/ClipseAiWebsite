import { describe, expect, it } from 'vitest';
import { parseSourceInput } from './source-parser.js';

describe('parseSourceInput', () => {
  it('parses YouTube channel IDs, handles, and URLs', () => {
    expect(parseSourceInput('https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw')).toEqual({
      ok: true,
      value: {
        platform: 'youtube',
        externalId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
        idKind: 'channel_id',
      },
    });
    expect(parseSourceInput('https://youtube.com/@ClipseCreator')).toEqual({
      ok: true,
      value: { platform: 'youtube', externalId: '@clipsecreator', idKind: 'handle' },
    });
    expect(parseSourceInput('UC_x5XG1OV2P6uZZ5FSM9Ttw')).toEqual({
      ok: true,
      value: {
        platform: 'youtube',
        externalId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
        idKind: 'channel_id',
      },
    });
    expect(parseSourceInput('@CreatorOne')).toEqual({
      ok: true,
      value: { platform: 'youtube', externalId: '@creatorone', idKind: 'handle' },
    });
  });

  it('parses Twitch and Kick URLs and prefixed IDs', () => {
    expect(parseSourceInput('https://www.twitch.tv/Shroud')).toEqual({
      ok: true,
      value: { platform: 'twitch', externalId: 'shroud', idKind: 'username' },
    });
    expect(parseSourceInput('twitch:xqc')).toEqual({
      ok: true,
      value: { platform: 'twitch', externalId: 'xqc', idKind: 'username' },
    });
    expect(parseSourceInput('https://kick.com/NickMercs')).toEqual({
      ok: true,
      value: { platform: 'kick', externalId: 'nickmercs', idKind: 'username' },
    });
    expect(parseSourceInput('kick:adin_ross')).toEqual({
      ok: true,
      value: { platform: 'kick', externalId: 'adin_ross', idKind: 'username' },
    });
  });

  it('rejects SSRF, internal IPs, non-https, credentials, and unknown hosts', () => {
    const ssrfInputs = [
      'http://169.254.169.254/latest/meta-data/',
      'https://127.0.0.1/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw',
      'http://www.youtube.com/@handle',
      'https://user:pass@www.youtube.com/@handle',
      'https://evil.example.com/@handle',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://www.twitch.tv/directory',
      'https://kick.com/browse',
      '   ',
    ];

    for (const input of ssrfInputs) {
      const res = parseSourceInput(input);
      expect(res.ok).toBe(false);
    }
  });
});
