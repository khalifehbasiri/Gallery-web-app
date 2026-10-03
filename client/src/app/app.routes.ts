import type { Routes } from '@angular/router';
import { authGuard, artistGuard } from './core/guards';

export const routes: Routes = [
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
  { path: 'artwork', redirectTo: '', pathMatch: 'full' },
  {
    path: '**',
    loadComponent: () =>
      import('./pages/not-found.component').then((m) => m.NotFoundComponent),
    title: 'Page not found — Atelier',
  },
];
