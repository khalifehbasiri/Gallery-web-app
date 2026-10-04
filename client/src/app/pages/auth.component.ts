import { featuredImage } from '../../../../shared/collection-images';
import { IconComponent } from '../shared/icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthStore } from '../core/auth.store';
import { errorMessage } from '../core/errors';

@Component({
  selector: 'app-auth',
  imports: [IconComponent, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="auth-layout page-width">
      <div class="auth-story">
        <p class="eyebrow">YOUR NEXT CREATIVE CHAPTER</p>
        <h1>
          {{ registering ? 'Make room for' : 'A familiar place.' }}<br /><em>{{
            registering ? 'inspiration.' : 'A fresh perspective.'
          }}</em>
        </h1>
        <p>
          Discover art that speaks to you. Build your collection. Find a
          community that makes you want to create.
        </p>
        <figure class="auth-artwork">
          <img
            [src]="'/artworks/' + featured.file"
            [alt]="featured.alt"
            [width]="featured.width"
            [height]="featured.height"
            loading="lazy"
            decoding="async"
          />
          <figcaption class="image-credit">
            {{ featured.title }} · {{ featured.creator }}.
            <a
              [href]="featured.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              >The Met, CC0</a
            >
          </figcaption>
        </figure>
      </div>
      <div class="form-panel">
        <p class="eyebrow">
          {{ registering ? 'WELCOME TO ATELIER' : 'WELCOME BACK' }}
        </p>
        <h2>
          {{ registering ? 'Let’s get acquainted.' : 'Sign in to your space.' }}
        </h2>
        <p>
          {{
            registering
              ? 'Your collection starts with a little curiosity.'
              : 'Your favorite works are right where you left them.'
          }}
        </p>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <label for="username">Username</label
          ><input
            id="username"
            formControlName="username"
            autocomplete="username"
            maxlength="80"
            placeholder="Your name in the gallery"
          />
          <label for="password">Password</label
          ><input
            id="password"
            type="password"
            formControlName="password"
            [autocomplete]="registering ? 'new-password' : 'current-password'"
            maxlength="256"
            placeholder="Your password"
          />
          @if (registering) {
            <label for="signup-email">Email address</label>
            <input
              id="signup-email"
              type="email"
              autocomplete="email"
              formControlName="email"
              maxlength="254"
            />
            <p class="field-hint">
              Used for account verification and password recovery. Optional
              artwork notifications require your consent.
            </p>
            <label
              ><input type="checkbox" formControlName="notifications" /> Email
              me when someone likes my artwork. I can turn this off
              anytime.</label
            >
            <label
              ><input type="checkbox" formControlName="acceptedTerms" /> I
              accept the <a routerLink="/terms">terms</a> and acknowledge the
              <a routerLink="/privacy">privacy notice</a>.</label
            >
          }
          @if (registering) {
            <p class="field-hint">
              Use at least 8 characters. Your account starts as a patron; you
              can become an artist in your collection.
            </p>
          }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          <button class="button full-width" type="submit" [disabled]="busy()">
            {{
              busy()
                ? 'One moment…'
                : registering
                  ? 'Join the community'
                  : 'Sign in'
            }}
            @if (!busy()) {
              <app-icon name="arrow-up-right" />
            }
          </button>
        </form>
        @if (!registering) {
          <p><a routerLink="/forgot-password">Forgot your password?</a></p>
        }
        <p class="form-switch">
          {{
            registering ? 'Already part of the community?' : 'New around here?'
          }}
          <a [routerLink]="registering ? '/login' : '/register'">{{
            registering ? 'Sign in' : 'Create an account'
          }}</a>
        </p>
      </div>
    </section>
  `,
})
export class AuthComponent {
  readonly featured = featuredImage;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  readonly registering = this.route.snapshot.data['mode'] === 'register';
  readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', [Validators.required, Validators.maxLength(80)]],
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(this.registering ? 8 : 1),
        Validators.maxLength(256),
      ],
    ],
    email: [
      '',
      this.registering
        ? [Validators.required, Validators.email, Validators.maxLength(254)]
        : [],
    ],
    acceptedTerms: [false, this.registering ? [Validators.requiredTrue] : []],
    notifications: [false],
  });
  readonly error = signal('');
  readonly busy = signal(false);
  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(
        this.registering
          ? 'Enter a username, valid email and password of at least 8 characters, then accept the terms.'
          : 'Enter your username and password.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const values = this.form.getRawValue();
      values.username = values.username.trim();
      if (this.registering) await this.auth.register(values);
      else await this.auth.login(values);
      const destination = this.route.snapshot.queryParamMap.get('returnUrl');
      await this.router.navigateByUrl(
        destination?.startsWith('/') && !destination.startsWith('//')
          ? destination
          : '/account',
      );
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
