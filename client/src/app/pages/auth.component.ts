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
  imports: [ReactiveFormsModule, RouterLink],
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
        <img src="/hero-art.svg" alt="Warm abstract geometric artwork" />
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
                  ? 'Join the community ↗'
                  : 'Sign in ↗'
            }}
          </button>
        </form>
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
  });
  readonly error = signal('');
  readonly busy = signal(false);
  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(
        this.registering
          ? 'Enter a username and a password with at least 8 characters.'
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
