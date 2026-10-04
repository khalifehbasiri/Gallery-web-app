import { IconComponent } from './shared/icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { AuthStore } from './core/auth.store';
import { errorMessage } from './core/errors';
import { DOCUMENT } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [IconComponent, RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main" (click)="skipToContent($event)"
      >Skip to content</a
    >
    <header class="site-header">
      <a class="brand" routerLink="/" aria-label="Atelier home"
        ><span class="brand-mark">A</span>atelier<span class="brand-dot"
          >.</span
        ></a
      >
      <nav aria-label="Main navigation">
        <a
          routerLink="/"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          >Discover</a
        >
        <a routerLink="/workshops" routerLinkActive="active">Workshops</a>
        <a routerLink="/explore" routerLinkActive="active">Explore</a>
        <a routerLink="/people" routerLinkActive="active">People</a>
        @if (auth.signedIn()) {
          <a routerLink="/following" routerLinkActive="active">Following</a>
          <a routerLink="/account" routerLinkActive="active">Your collection</a>
        }
      </nav>
      <div class="header-actions">
        @if (auth.signedIn()) {
          <span class="user-chip"
            ><span class="avatar">{{
              auth.user()?.username?.charAt(0)?.toUpperCase()
            }}</span
            ><span>{{ auth.user()?.username }}</span></span
          >
          <button class="text-button" (click)="logout()" [disabled]="busy()">
            Sign out
          </button>
        } @else {
          <a class="text-button" routerLink="/login">Sign in</a
          ><a class="button button-small" routerLink="/register"
            >Join the community <app-icon name="arrow-up-right"
          /></a>
        }
      </div>
    </header>
    @if (error()) {
      <p class="global-error" role="alert">{{ error() }}</p>
    }
    <main id="main" tabindex="-1"><router-outlet /></main>
    <footer class="site-footer">
      <a class="brand" routerLink="/">atelier.</a>
      <p>Art is better when it brings us together.</p>
      <nav aria-label="Legal">
        <a routerLink="/privacy">Privacy</a> · <a routerLink="/terms">Terms</a>
      </nav>
      <span>Discover · Collect · Create</span>
    </footer>
  `,
})
export class AppComponent {
  readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  readonly error = signal('');
  readonly busy = signal(false);
  skipToContent(event: Event) {
    event.preventDefault();
    this.document.getElementById('main')?.focus();
  }
  async logout() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.logout();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
