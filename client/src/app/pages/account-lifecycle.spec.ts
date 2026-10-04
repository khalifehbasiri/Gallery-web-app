import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { AuthComponent } from './auth.component';
import { RecoveryComponent } from './recovery.component';
import { AccountSettingsComponent } from '../shared/account-settings.component';
import { AuthStore } from '../core/auth.store';
import { ApiService } from '../core/api.service';
@Component({ template: '' })
class EmptyPage {}
describe('Account lifecycle UI', () => {
  const auth = {
    register: vi.fn().mockResolvedValue(undefined),
    login: vi.fn(),
    setUser: vi.fn(),
  };
  const api = {
    verifyAccountEmail: vi.fn().mockReturnValue(of({ message: 'Verified' })),
    resetPassword: vi.fn().mockReturnValue(of({ message: 'Password reset' })),
    identity: vi.fn().mockReturnValue(
      of({
        email: 'private@example.com',
        verified: true,
        deliveryAvailable: false,
        publicDemo: false,
      }),
    ),
    notificationPreferences: vi.fn().mockReturnValue(of({ enabled: true })),
    setNotifications: vi.fn().mockReturnValue(of({ enabled: false })),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'register',
            component: AuthComponent,
            data: { mode: 'register' },
          },
          {
            path: 'verify-email',
            component: RecoveryComponent,
            data: { mode: 'verify' },
          },
          {
            path: 'reset-password',
            component: RecoveryComponent,
            data: { mode: 'reset' },
          },
          { path: 'account', component: EmptyPage },
        ]),
        { provide: AuthStore, useValue: auth },
        { provide: ApiService, useValue: api },
      ],
    });
    window.history.replaceState({}, '', '/');
  });
  it('requires an email and legal acknowledgement, leaving optional notifications unchecked', async () => {
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl('/register', AuthComponent);
    component.form.patchValue({
      username: 'New user',
      password: 'long-password',
    });
    await component.submit();
    expect(auth.register).not.toHaveBeenCalled();
    expect(component.form.controls.notifications.value).toBe(false);
    component.form.patchValue({
      email: 'person@example.com',
      acceptedTerms: true,
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await component.submit();
    expect(auth.register).toHaveBeenCalledWith({
      username: 'New user',
      password: 'long-password',
      email: 'person@example.com',
      acceptedTerms: true,
      notifications: false,
    });
  });
  it('removes the verification fragment and requires explicit confirmation before consuming it', async () => {
    const secret = 'a'.repeat(43);
    window.history.replaceState({}, '', '/verify-email#token=' + secret);
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl(
      '/verify-email',
      RecoveryComponent,
    );
    expect(window.location.hash).toBe('');
    expect(api.verifyAccountEmail).not.toHaveBeenCalled();
    await component.submit();
    expect(api.verifyAccountEmail).toHaveBeenCalledWith(secret);
  });
  it('rejects mismatched new passwords and clears frontend auth after a successful reset', async () => {
    const secret = 'b'.repeat(43);
    window.history.replaceState({}, '', '/reset-password#token=' + secret);
    const harness = await RouterTestingHarness.create();
    const component = await harness.navigateByUrl(
      '/reset-password',
      RecoveryComponent,
    );
    component.form.patchValue({
      password: 'new-long-password',
      confirm: 'different-password',
    });
    await component.submit();
    expect(api.resetPassword).not.toHaveBeenCalled();
    component.form.patchValue({ confirm: 'new-long-password' });
    await component.submit();
    expect(api.resetPassword).toHaveBeenCalledWith(secret, 'new-long-password');
    expect(auth.setUser).toHaveBeenCalledWith(null);
  });
  it('allows notification disabling even when the delivery provider is unavailable', async () => {
    const fixture = TestBed.createComponent(AccountSettingsComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Disable notifications',
    );
    await fixture.componentInstance.toggleNotifications();
    expect(api.setNotifications).toHaveBeenCalledWith(false);
  });
});
