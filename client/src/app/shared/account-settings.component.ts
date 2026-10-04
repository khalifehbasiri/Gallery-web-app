import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type {
  AccountIdentity,
  NotificationPreferences,
} from '../../../../shared/contracts';
import { ApiService } from '../core/api.service';
import { AuthStore } from '../core/auth.store';
import { errorMessage } from '../core/errors';
@Component({
  selector: 'app-account-settings',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (identity(); as user) {
      <section class="form-panel" aria-label="Account email and privacy">
        <h2>Account email and privacy</h2>
        @if (user.publicDemo) {
          <p>
            Shared demo accounts cannot store personal emails, reset their
            password, or be deleted. Create your own account to use these
            controls.
          </p>
        } @else {
          <p>
            {{ user.email || 'No account email saved.' }} ·
            {{ user.verified ? 'Verified' : 'Verification needed' }}
          </p>
          @if (!user.deliveryAvailable) {
            <p>
              Email delivery is awaiting sender configuration. You can save your
              address, but verification and recovery emails cannot be delivered
              yet.
            </p>
          }
          <form [formGroup]="emailForm" (ngSubmit)="saveEmail()">
            <label for="account-email">Account email</label
            ><input
              id="account-email"
              type="email"
              autocomplete="email"
              formControlName="email"
              maxlength="254"
            />
            <label for="email-password">Current password</label
            ><input
              id="email-password"
              type="password"
              autocomplete="current-password"
              formControlName="password"
              maxlength="256"
            />
            <button
              class="button button-outline"
              [disabled]="busy() || emailForm.invalid"
            >
              Save email / request verification
            </button>
          </form>
          <h3>Optional email notifications</h3>
          <p>
            Appreciation emails are {{ preferences()?.enabled ? 'on' : 'off' }}.
            Password recovery and verification emails are separate.
          </p>
          <button
            class="button button-outline"
            type="button"
            [disabled]="busy() || (!preferences()?.enabled && !user.verified)"
            (click)="toggleNotifications()"
          >
            {{
              preferences()?.enabled
                ? 'Disable notifications'
                : 'Enable notifications'
            }}
          </button>
          <p>
            You can also unsubscribe using the link in an appreciation email.
          </p>
          <h3>Export or delete your account</h3>
          <p>
            Export downloads your account data and artwork text as JSON with
            image links. Deletion removes your activity, artwork and workshops;
            access is revoked immediately and provider cleanup may finish later.
          </p>
          <form [formGroup]="privacyForm" (ngSubmit)="deleteAccount()">
            <label for="privacy-password">Confirm current password</label
            ><input
              id="privacy-password"
              type="password"
              autocomplete="current-password"
              formControlName="password"
              maxlength="256"
            />
            <button
              class="button button-outline"
              type="button"
              [disabled]="busy() || privacyForm.controls.password.invalid"
              (click)="exportAccount()"
            >
              Download my data
            </button>
            <label for="delete-confirm"
              >Type DELETE for permanent deletion</label
            ><input
              id="delete-confirm"
              formControlName="confirmation"
              autocomplete="off"
            />
            <button class="button" [disabled]="busy() || privacyForm.invalid">
              Permanently delete my account
            </button>
          </form>
        }
        <p>
          <a routerLink="/privacy">Privacy and retention</a> ·
          <a routerLink="/terms">Terms</a>
        </p>
      </section>
    }
    @if (message()) {
      <p role="status">{{ message() }}</p>
    }
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
  `,
})
export class AccountSettingsComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  readonly identity = signal<AccountIdentity | null>(null);
  readonly preferences = signal<NotificationPreferences | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly emailForm = inject(FormBuilder).nonNullable.group({
    email: [
      '',
      [Validators.required, Validators.email, Validators.maxLength(254)],
    ],
    password: ['', [Validators.required, Validators.maxLength(256)]],
  });
  readonly privacyForm = inject(FormBuilder).nonNullable.group({
    password: ['', [Validators.required, Validators.maxLength(256)]],
    confirmation: ['', [Validators.required, Validators.pattern(/^DELETE$/)]],
  });
  constructor() {
    void this.load().catch((e) => this.error.set(errorMessage(e)));
  }
  private async load() {
    this.identity.set(await firstValueFrom(this.api.identity()));
    this.preferences.set(
      await firstValueFrom(this.api.notificationPreferences()),
    );
    this.emailForm.controls.email.setValue(this.identity()!.email);
  }
  private async perform(work: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await work();
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  saveEmail() {
    return this.perform(async () => {
      const v = this.emailForm.getRawValue();
      const r = await firstValueFrom(
        this.api.saveAccountEmail(v.email, v.password),
      );
      this.emailForm.controls.password.reset();
      this.message.set(r.message);
      await this.load();
    });
  }
  toggleNotifications() {
    return this.perform(async () => {
      const enabled = !this.preferences()?.enabled;
      await firstValueFrom(this.api.setNotifications(enabled));
      this.message.set(
        enabled ? 'Notifications enabled.' : 'Notifications disabled.',
      );
      await this.load();
    });
  }
  exportAccount() {
    return this.perform(async () => {
      const data = await firstValueFrom(
        this.api.exportAccount(this.privacyForm.controls.password.value),
      );
      const url = URL.createObjectURL(data),
        a = document.createElement('a');
      a.href = url;
      a.download = 'atelier-account.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.privacyForm.controls.password.reset();
      this.message.set('Account export downloaded. Keep it private.');
    });
  }
  deleteAccount() {
    return this.perform(async () => {
      if (this.privacyForm.invalid) return;
      const v = this.privacyForm.getRawValue();
      const result = await firstValueFrom(
        this.api.deleteAccount(v.password, v.confirmation),
      );
      this.auth.setUser(null);
      this.message.set(result.message);
      await this.router.navigate(['/account-deleted']);
    });
  }
}
