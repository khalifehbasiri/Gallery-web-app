import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthStore } from '../core/auth.store';
import { errorMessage } from '../core/errors';

@Component({
  selector: 'app-recovery',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <section class="page-width inner-page">
    <div class="form-panel">
      <h1>
        {{
          mode === 'forgot'
            ? 'Recover your account'
            : mode === 'reset'
              ? 'Choose a new password'
              : 'Verify your email'
        }}
      </h1>
      @if (mode === 'forgot') {
        <p>
          Enter your verified account email. We use the same response whether an
          account exists or not.
        </p>
      }
      @if (mode === 'verify') {
        <p>
          Confirm your email ownership. This does not subscribe you to optional
          notifications.
        </p>
      }
      @if (!done()) {
        <form [formGroup]="form" (ngSubmit)="submit()">
          @if (mode === 'forgot') {
            <label for="recovery-email">Account email</label
            ><input
              id="recovery-email"
              type="email"
              formControlName="email"
              autocomplete="email"
              maxlength="254"
            />
          }
          @if (mode === 'reset') {
            <label for="new-password">New password</label
            ><input
              id="new-password"
              type="password"
              formControlName="password"
              autocomplete="new-password"
              maxlength="256"
            />
            <label for="repeat-password">Repeat password</label
            ><input
              id="repeat-password"
              type="password"
              formControlName="confirm"
              autocomplete="new-password"
              maxlength="256"
            />
            <p>
              Use at least 8 characters. Changing your password signs out every
              device.
            </p>
          }
          <button class="button" [disabled]="busy()">
            {{
              busy()
                ? 'Working…'
                : mode === 'forgot'
                  ? 'Request reset email'
                  : mode === 'reset'
                    ? 'Reset password'
                    : 'Verify email'
            }}
          </button>
        </form>
      }
      @if (message()) {
        <p role="status">{{ message() }}</p>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <p>
        <a routerLink="/login">Sign in</a> ·
        <a routerLink="/account">Account settings</a>
      </p>
    </div>
  </section>`,
})
export class RecoveryComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthStore);
  readonly mode = inject(ActivatedRoute).snapshot.data['mode'] as
    'forgot' | 'reset' | 'verify';
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly message = signal('');
  readonly error = signal('');
  private readonly location = inject(DOCUMENT).defaultView!.location;
  private readonly token =
    new URLSearchParams(this.location.hash.slice(1)).get('token') || '';
  readonly form = inject(FormBuilder).nonNullable.group({
    email: [
      '',
      this.mode === 'forgot' ? [Validators.required, Validators.email] : [],
    ],
    password: [
      '',
      this.mode === 'reset'
        ? [
            Validators.required,
            Validators.minLength(8),
            Validators.maxLength(256),
          ]
        : [],
    ],
    confirm: ['', this.mode === 'reset' ? [Validators.required] : []],
  });
  constructor() {
    const view = inject(DOCUMENT).defaultView!;
    view.history.replaceState(
      view.history.state,
      '',
      this.location.pathname + this.location.search,
    );
    if (this.mode !== 'forgot' && !/^[A-Za-z0-9_-]{43}$/.test(this.token))
      this.error.set(
        'This link is missing a valid token. Request a new email.',
      );
  }
  async submit() {
    if (this.busy()) return;
    const values = this.form.getRawValue();
    if (
      this.form.invalid ||
      (this.mode === 'reset' && values.password !== values.confirm)
    ) {
      this.form.markAllAsTouched();
      this.error.set(
        this.mode === 'forgot'
          ? 'Enter a valid email.'
          : 'Enter matching passwords with at least 8 characters.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(
        this.mode === 'forgot'
          ? this.api.forgotPassword(values.email)
          : this.mode === 'reset'
            ? this.api.resetPassword(this.token, values.password)
            : this.api.verifyAccountEmail(this.token),
      );
      this.message.set(result.message);
      this.done.set(true);
      this.form.reset();
      if (this.mode === 'reset') this.auth.setUser(null);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
