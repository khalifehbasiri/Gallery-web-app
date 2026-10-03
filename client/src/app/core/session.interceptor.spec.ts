import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { sessionInterceptor } from './session.interceptor';
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
describe('browser session integration', () => {
  let http: HttpTestingController, client: HttpClient;
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; Path=/';
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([sessionInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });
  afterEach(() => {
    http.verify();
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; Path=/';
  });
  it('bootstraps CSRF once for concurrent mutations and sends the current cookie token', async () => {
    const a = firstValueFrom(client.post('/api/workshops', {})),
      b = firstValueFrom(client.put('/api/artworks/a/like', {}));
    http
      .expectOne('/api/auth/csrf')
      .flush('', { status: 204, statusText: 'No Content' });
    document.cookie = 'XSRF-TOKEN=csrf-one; Path=/';
    await tick();
    for (const url of ['/api/workshops', '/api/artworks/a/like']) {
      const r = http.expectOne(url);
      expect(r.request.headers.get('X-XSRF-TOKEN')).toBe('csrf-one');
      r.flush({});
    }
    await Promise.all([a, b]);
  });
  it('coalesces concurrent expired requests into one refresh and retries each exactly once', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-two; Path=/';
    const a = firstValueFrom(client.get('/api/account')),
      b = firstValueFrom(client.get('/api/auth/sessions'));
    await tick();
    for (const url of ['/api/account', '/api/auth/sessions'])
      http
        .expectOne(url)
        .flush({}, { status: 401, statusText: 'Unauthorized' });
    await tick();
    const refresh = http.expectOne('/api/auth/refresh');
    expect(refresh.request.headers.get('X-XSRF-TOKEN')).toBe('csrf-two');
    refresh.flush({});
    await tick();
    http.expectOne('/api/account').flush({ user: 'valid' });
    http.expectOne('/api/auth/sessions').flush([]);
    expect(await a).toEqual({ user: 'valid' });
    expect(await b).toEqual([]);
  });
  it('does not try to refresh rejected login credentials', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-three; Path=/';
    const rejected = expect(
      firstValueFrom(client.post('/api/auth/login', {})),
    ).rejects.toBeDefined();
    await tick();
    http
      .expectOne('/api/auth/login')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await rejected;
    http.expectNone('/api/auth/refresh');
  });
});
