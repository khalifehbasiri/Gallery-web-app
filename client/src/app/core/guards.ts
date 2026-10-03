import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from './auth.store';

export const authGuard: CanActivateFn = (_route, state) =>
  inject(AuthStore).signedIn() ||
  inject(Router).createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
export const artistGuard: CanActivateFn = () =>
  inject(AuthStore).isArtist() || inject(Router).createUrlTree(['/account']);
