import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FeedStore } from './feed.store';
const art = (id: string) => ({
  id,
  title: id,
  artist: 'Artist',
  year: '2026',
  category: 'Test',
  medium: 'PNG',
  description: '',
  imageUrl: '/test.png',
  liked: false,
  likeCount: 0,
  reviewCount: 0,
});
describe('FeedStore', () => {
  let store: InstanceType<typeof FeedStore>, http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), FeedStore],
    });
    store = TestBed.inject(FeedStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('cancels stale/account-switched requests and clears the previous personalized results', () => {
    store.load({ mode: 'following' });
    const stale = http.expectOne((r) => r.url === '/api/feeds/following');
    store.load({ mode: 'explore' });
    expect(stale.cancelled).toBe(true);
    http
      .expectOne((r) => r.url === '/api/feeds/explore')
      .flush({
        items: [art('a')],
        source: 'explore',
        followingCount: 0,
        nextCursor: 'next',
      });
    expect(store.items()).toHaveLength(1);
    store.load({ mode: 'following' });
    expect(store.items()).toEqual([]);
    expect(store.nextCursor()).toBeNull();
    http
      .expectOne((r) => r.url === '/api/feeds/following')
      .flush({
        items: [],
        source: 'following',
        followingCount: 1,
        nextCursor: null,
      });
    expect(store.source()).toBe('following');
  });
  it('appends cursor pages without duplicate cards and preserves retry state after an error', () => {
    store.load({ mode: 'explore' });
    http
      .expectOne((r) => !r.params.has('cursor'))
      .flush({
        items: [art('a')],
        source: 'explore',
        followingCount: 0,
        nextCursor: 'next',
      });
    store.load({ mode: 'explore', cursor: 'next' });
    http
      .expectOne((r) => r.params.get('cursor') === 'next')
      .flush(
        { error: 'Try again.' },
        { status: 503, statusText: 'Unavailable' },
      );
    expect(store.items().map((a) => a.id)).toEqual(['a']);
    expect(store.request().cursor).toBe('next');
    expect(store.loading()).toBe(false);
    store.load(store.request());
    http
      .expectOne((r) => r.params.get('cursor') === 'next')
      .flush({
        items: [art('a'), art('b')],
        source: 'explore',
        followingCount: 0,
        nextCursor: null,
      });
    expect(store.items().map((a) => a.id)).toEqual(['a', 'b']);
    expect(store.error()).toBe('');
  });
});
