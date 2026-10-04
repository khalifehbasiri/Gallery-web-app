import type { Routes } from '@angular/router';
import { authGuard, artistGuard } from './core/guards';

export const routes: Routes = [
  {
    path: 'explore',
    loadComponent: () =>
      import('./pages/feed.component').then((m) => m.FeedComponent),
    title: 'Explore — Atelier',
    data: { mode: 'explore' },
  },
  {
    path: 'following',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/feed.component').then((m) => m.FeedComponent),
    title: 'Following — Atelier',
    data: { mode: 'following' },
  },
  {
    path: 'people',
    loadComponent: () =>
      import('./pages/people.component').then((m) => m.PeopleComponent),
    title: 'People — Atelier',
  },
  {
    path: 'people/:id',
    loadComponent: () =>
      import('./pages/artist.component').then((m) => m.ArtistComponent),
    title: 'Profile — Atelier',
  },
  {
    path: '',
    loadComponent: () =>
      import('./pages/gallery.component').then((m) => m.GalleryComponent),
    title: 'Discover art — Atelier',
  },
  {
    path: 'artworks/new',
    canActivate: [authGuard, artistGuard],
    loadComponent: () =>
      import('./pages/create-artwork.component').then(
        (m) => m.CreateArtworkComponent,
      ),
    title: 'Publish artwork — Atelier',
  },
  {
    path: 'artworks/:id',
    loadComponent: () =>
      import('./pages/artwork.component').then((m) => m.ArtworkComponent),
    title: 'Artwork — Atelier',
  },
  {
    path: 'artists/:id',
    loadComponent: () =>
      import('./pages/artist.component').then((m) => m.ArtistComponent),
    title: 'Artist — Atelier',
  },
  {
    path: 'workshops',
    loadComponent: () =>
      import('./pages/workshops.component').then((m) => m.WorkshopsComponent),
    title: 'Workshops — Atelier',
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/auth.component').then((m) => m.AuthComponent),
    title: 'Sign in — Atelier',
    data: { mode: 'login' },
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./pages/auth.component').then((m) => m.AuthComponent),
    title: 'Join Atelier',
    data: { mode: 'register' },
  },
  {
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/account.component').then((m) => m.AccountComponent),
    title: 'Your collection — Atelier',
  },
  {
    path: 'workshops/new',
    canActivate: [authGuard, artistGuard],
    loadComponent: () =>
      import('./pages/create-workshop.component').then(
        (m) => m.CreateWorkshopComponent,
      ),
    title: 'Create workshop — Atelier',
  },
  { path: 'home', redirectTo: '', pathMatch: 'full' },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/recovery.component').then((m) => m.RecoveryComponent),
    title: 'Recover account — Atelier',
    data: { mode: 'forgot' },
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/recovery.component').then((m) => m.RecoveryComponent),
    title: 'Reset password — Atelier',
    data: { mode: 'reset' },
  },
  {
    path: 'verify-email',
    loadComponent: () =>
      import('./pages/recovery.component').then((m) => m.RecoveryComponent),
    title: 'Verify email — Atelier',
    data: { mode: 'verify' },
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./pages/legal.component').then((m) => m.LegalComponent),
    title: 'Privacy — Atelier',
    data: { mode: 'privacy' },
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./pages/legal.component').then((m) => m.LegalComponent),
    title: 'Terms — Atelier',
    data: { mode: 'terms' },
  },
  {
    path: 'account-deleted',
    loadComponent: () =>
      import('./pages/legal.component').then((m) => m.LegalComponent),
    title: 'Account deletion — Atelier',
    data: { mode: 'deleted' },
  },
  { path: 'artwork', redirectTo: '', pathMatch: 'full' },
  {
    path: '**',
    loadComponent: () =>
      import('./pages/not-found.component').then((m) => m.NotFoundComponent),
    title: 'Page not found — Atelier',
  },
];
