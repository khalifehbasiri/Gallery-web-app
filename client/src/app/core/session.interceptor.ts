import { Injectable, inject } from '@angular/core';
import {
  HttpBackend,
  HttpClient,
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { firstValueFrom, from, switchMap, catchError, throwError } from 'rxjs';
function csrfCookie() {
  const cookie = document.cookie
    .split('; ')
    .find((v) => v.startsWith('XSRF-TOKEN='));
  return cookie ? decodeURIComponent(cookie.slice('XSRF-TOKEN='.length)) : '';
}
@Injectable({ providedIn: 'root' })
export class BrowserSession {
  private readonly raw = new HttpClient(inject(HttpBackend));
  private csrfTask?: Promise<void>;
  private refreshTask?: Promise<void>;
  async csrf() {
    if (csrfCookie()) return;
    this.csrfTask ??= firstValueFrom(
      this.raw.get('/api/auth/csrf', { responseType: 'text' }),
    )
      .then(() => {})
      .finally(() => {
        this.csrfTask = undefined;
      });
    await this.csrfTask;
  }
  refresh() {
    this.refreshTask ??= this.rotate().finally(() => {
      this.refreshTask = undefined;
    });
    return this.refreshTask;
  }
  private async rotate() {
    const work = async () => {
      await this.csrf();
      await firstValueFrom(
        this.raw.post(
          '/api/auth/refresh',
          {},
          { headers: { 'X-XSRF-TOKEN': csrfCookie() } },
        ),
      );
    };
    // The browser shares refresh cookies across tabs. Serialize rotation across those tabs.
    if (navigator.locks) await navigator.locks.request('gallery-refresh', work);
    else await work();
  }
}
export const sessionInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);
  const session = inject(BrowserSession),
    mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const send = () =>
    next(
      mutation
        ? req.clone({ setHeaders: { 'X-XSRF-TOKEN': csrfCookie() } })
        : req,
    );
  return from(mutation ? session.csrf() : Promise.resolve()).pipe(
    switchMap(send),
    catchError((error: unknown) => {
      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        [
          '/api/auth/login',
          '/api/auth/register',
          '/api/auth/refresh',
          '/api/auth/logout',
          '/api/auth/csrf',
        ].includes(req.url)
      )
        return throwError(() => error);
      return from(session.refresh()).pipe(switchMap(send));
    }),
  );
};
