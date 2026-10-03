import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type { Credentials, User } from '../../../../shared/contracts';
import { ApiService } from './api.service';

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState({ user: null as User | null, ready: false }),
  withComputed(({ user }) => ({
    signedIn: computed(() => !!user()),
    isArtist: computed(() => user()?.role === 'artist'),
  })),
  withMethods((store, api = inject(ApiService)) => ({
    async restore() {
      try {
        const { user } = await firstValueFrom(api.me());
        patchState(store, { user, ready: true });
      } catch {
        patchState(store, { user: null, ready: true });
      }
    },
    async login(credentials: Credentials) {
      const { user } = await firstValueFrom(api.login(credentials));
      patchState(store, { user });
    },
    async register(credentials: Credentials) {
      await firstValueFrom(api.register(credentials));
      await this.login(credentials);
    },
    async logout() {
      await firstValueFrom(api.logout());
      patchState(store, { user: null });
    },
    setUser(user: User | null) {
      patchState(store, { user });
    },
  })),
);
