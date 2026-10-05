import type { BeforeSendEvent } from '@vercel/analytics';

export function redactAnalyticsUrl(event: BeforeSendEvent): BeforeSendEvent {
  // Recovery links carry secrets; search queries can contain personal data.
  const url = new URL(event.url);
  url.search = '';
  url.hash = '';
  return { ...event, url: url.toString() };
}
