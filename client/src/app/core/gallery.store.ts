import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { catchError, debounceTime, EMPTY, pipe, switchMap, tap } from 'rxjs';
import type {
  ArtworkSummary,
  GalleryQuery,
} from '../../../../shared/contracts';
import { ApiService } from './api.service';
import { errorMessage } from './errors';

export const GalleryStore = signalStore(
  withState({
    items: [] as ArtworkSummary[],
    total: 0,
    pages: 0,
    loading: false,
    error: '',
    query: { search: '', category: '', artist: '', page: 1 } as GalleryQuery,
  }),
  withComputed(({ query, total }) => ({
    rangeStart: computed(() => (total() ? (query().page - 1) * 12 + 1 : 0)),
    rangeEnd: computed(() => Math.min(query().page * 12, total())),
  })),
  withMethods((store, api = inject(ApiService)) => ({
    // A new search cancels the previous HTTP request, preventing stale results.
    load: rxMethod<GalleryQuery>(
      pipe(
        tap((query) => patchState(store, { query, loading: true, error: '' })),
        debounceTime(200),
        switchMap((query) =>
          api.artworks(query).pipe(
            tap((result) =>
              patchState(store, {
                items: result.items,
                total: result.total,
                pages: result.pages,
                loading: false,
              }),
            ),
            catchError((error: unknown) => {
              patchState(store, { loading: false, error: errorMessage(error) });
              return EMPTY;
            }),
          ),
        ),
      ),
    ),
  })),
);
