import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GalleryStore } from './gallery.store';

describe('GalleryStore', () => {
  let store: InstanceType<typeof GalleryStore>;
  let http: HttpTestingController;
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        GalleryStore,
      ],
    });
    store = TestBed.inject(GalleryStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });
  it('cancels stale search requests and commits the most recent results', async () => {
    store.load({ search: 'old', category: '', artist: '', page: 1 });
    await vi.advanceTimersByTimeAsync(200);
    const stale = http.expectOne((req) => req.params.get('search') === 'old');
    store.load({ search: 'new', category: '', artist: '', page: 1 });
    await vi.advanceTimersByTimeAsync(200);
    expect(stale.cancelled).toBe(true);
    http
      .expectOne((req) => req.params.get('search') === 'new')
      .flush({ items: [], total: 14, pages: 2, page: 1, limit: 12 });
    expect(store.total()).toBe(14);
    expect(store.pages()).toBe(2);
    expect(store.loading()).toBe(false);
  });
  it('keeps accepting new searches after an API error', async () => {
    store.load({ search: 'failed', category: '', artist: '', page: 1 });
    await vi.advanceTimersByTimeAsync(200);
    http
      .expectOne((req) => req.params.get('search') === 'failed')
      .flush(
        { error: 'Search unavailable.' },
        { status: 503, statusText: 'Unavailable' },
      );
    expect(store.error()).toBe('Search unavailable.');
    expect(store.loading()).toBe(false);
    store.load({ search: 'retry', category: '', artist: '', page: 2 });
    await vi.advanceTimersByTimeAsync(200);
    http
      .expectOne((req) => req.params.get('search') === 'retry')
      .flush({ items: [], total: 14, pages: 2, page: 2, limit: 12 });
    expect(store.error()).toBe('');
    expect(store.rangeStart()).toBe(13);
    expect(store.rangeEnd()).toBe(14);
  });
});
