import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { catchError, EMPTY, pipe, switchMap, tap } from 'rxjs';
import type { ArtworkSummary, FeedMode } from '../../../../shared/contracts';
import { ApiService } from './api.service';
import { errorMessage } from './errors';
interface FeedRequest {
  mode: FeedMode;
  cursor?: string;
}
export const FeedStore = signalStore(
  withState({
    items: [] as ArtworkSummary[],
    mode: 'explore' as FeedMode,
    source: 'explore' as FeedMode,
    followingCount: 0,
    nextCursor: null as string | null,
    loading: false,
    error: '',
    request: { mode: 'explore' } as FeedRequest,
  }),
  withMethods((store, api = inject(ApiService)) => ({
    load: rxMethod<FeedRequest>(
      pipe(
        tap((request) =>
          patchState(store, {
            request,
            mode: request.mode,
            loading: true,
            error: '',
            ...(!request.cursor
              ? {
                  items: [],
                  nextCursor: null,
                  followingCount: 0,
                  source: request.mode,
                }
              : {}),
          }),
        ),
        switchMap((request) =>
          api.feed(request.mode, request.cursor).pipe(
            tap((result) => {
              const items = request.cursor
                ? [...store.items(), ...result.items]
                : result.items;
              patchState(store, {
                ...result,
                items: [...new Map(items.map((art) => [art.id, art])).values()],
                loading: false,
              });
            }),
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
