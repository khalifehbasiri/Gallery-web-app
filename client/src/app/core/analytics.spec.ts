import { describe, expect, it } from 'vitest';
import { redactAnalyticsUrl } from './analytics';

describe('analytics URL redaction', () => {
  it.each(['reset-password', 'verify-email'])(
    'removes secrets from %s links before sending a page view',
    (path) => {
      const event = {
        type: 'pageview' as const,
        url: `https://atelier.example/${path}?token=secret&email=patron%40example.com#secret`,
      };
      expect(redactAnalyticsUrl(event)).toEqual({
        type: 'pageview',
        url: `https://atelier.example/${path}`,
      });
      expect(event.url).toContain('token=secret');
    },
  );

  it('keeps the page path while removing gallery searches and fragments', () => {
    expect(
      redactAnalyticsUrl({
        type: 'pageview',
        url: 'https://atelier.example/artworks/123?q=personal%20query#reviews',
      }),
    ).toEqual({
      type: 'pageview',
      url: 'https://atelier.example/artworks/123',
    });
  });
});
