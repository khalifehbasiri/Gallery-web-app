import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { inject, isDevMode, provideAppInitializer } from '@angular/core';
import { inject as injectAnalytics } from '@vercel/analytics';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { AuthStore } from './app/core/auth.store';
import { sessionInterceptor } from './app/core/session.interceptor';
import { redactAnalyticsUrl } from './app/core/analytics';

injectAnalytics({
  mode: isDevMode() ? 'development' : 'production',
  beforeSend: redactAnalyticsUrl,
});

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([sessionInterceptor])),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
    ),
    provideAppInitializer(() => inject(AuthStore).restore()),
  ],
}).catch((error: unknown) => console.error('Unable to start Atelier:', error));
