import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthStore } from './auth.store';

describe('AuthStore', () => {
  let store: InstanceType<typeof AuthStore>;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(AuthStore);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('restores signed-in state from the server without reading tokens from browser storage', async () => {
    const restoring = store.restore();
    http
      .expectOne('/api/auth/me')
      .flush({ user: { id: 'artist-id', username: 'Artist', role: 'artist' } });
    await restoring;
    expect(store.ready()).toBe(true);
    expect(store.signedIn()).toBe(true);
    expect(store.isArtist()).toBe(true);
  });
  it('keeps the signed-in state when logout fails and clears it after successful revocation', async () => {
    store.setUser({ id: 'user-id', username: 'Patron', role: 'patron' });
    const failure = store.logout();
    const rejection = expect(failure).rejects.toBeDefined();
    http
      .expectOne('/api/auth/logout')
      .flush(
        { error: 'Unavailable' },
        { status: 503, statusText: 'Unavailable' },
      );
    await rejection;
    expect(store.signedIn()).toBe(true);
    const success = store.logout();
    http.expectOne('/api/auth/logout').flush(null);
    await success;
    expect(store.signedIn()).toBe(false);
  });
});
