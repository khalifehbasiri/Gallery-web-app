import { IconComponent } from '../shared/icon.component';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import type { FeedMode } from '../../../../shared/contracts';
import { FeedStore } from '../core/feed.store';
import { AuthStore } from '../core/auth.store';
import { ArtCardComponent } from '../shared/art-card.component';
@Component({
  selector: 'app-feed',
  imports: [IconComponent, RouterLink, RouterLinkActive, ArtCardComponent],
  providers: [FeedStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-width inner-page">
      <div class="section-heading">
        <div>
          <p class="eyebrow">YOUR DAILY INSPIRATION</p>
          <h1>
            {{ store.mode() === 'following' ? 'Following' : 'Explore' }}
            <em>art.</em>
          </h1>
          <p>
            {{
              store.mode() === 'following'
                ? 'The newest work from your creative connections.'
                : 'A fresh starting point in the gallery, every time you refresh.'
            }}
          </p>
        </div>
        <button
          class="button button-outline"
          (click)="refresh()"
          [disabled]="store.loading()"
        >
          Refresh feed <app-icon name="refresh" />
        </button>
      </div>
      <nav class="feed-tabs" aria-label="Artwork feeds">
        <a routerLink="/explore" routerLinkActive="active">Explore</a>
        @if (auth.signedIn()) {
          <a routerLink="/following" routerLinkActive="active">Following</a>
        }
        <a routerLink="/people"
          >Find people <app-icon name="arrow-up-right" /></a
        ><a routerLink="/">Search the collection</a>
      </nav>
      @if (
        store.mode() === 'following' &&
        store.source() === 'explore' &&
        !store.loading()
      ) {
        <p class="feed-notice">
          You’re not following anyone yet. Here are some random discoveries to
          start with.
          <a routerLink="/people"
            >Find your people <app-icon name="arrow-right"
          /></a>
        </p>
      }
      @if (store.error()) {
        <div role="alert" class="feed-notice error">
          <p>{{ store.error() }}</p>
          <button
            class="button button-outline"
            (click)="store.load(store.request())"
            [disabled]="store.loading()"
          >
            Try again</button
          ><button
            class="text-button"
            (click)="refresh()"
            [disabled]="store.loading()"
          >
            Start a fresh feed
          </button>
        </div>
      }
      @if (store.loading() && !store.items().length) {
        <div class="art-grid" aria-busy="true" aria-label="Loading feed">
          @for (item of [1, 2, 3, 4, 5, 6]; track item) {
            <div class="skeleton-card">
              <div></div>
              <span></span><span></span>
            </div>
          }
        </div>
      } @else if (!store.items().length && !store.error()) {
        <div class="empty-state">
          <h2>Room for something new.</h2>
          <p>
            {{
              store.source() === 'following'
                ? 'The people you follow haven’t shared any artwork yet.'
                : 'No artwork has been shared yet.'
            }}
          </p>
          <a routerLink="/explore" class="button button-outline"
            >Explore the gallery</a
          >
        </div>
      } @else {
        <div class="art-grid" [attr.aria-busy]="store.loading()">
          @for (art of store.items(); track art.id) {
            <app-art-card [art]="art" />
          }
        </div>
      }
      @if (store.nextCursor()) {
        <div class="feed-more">
          <button
            class="button button-outline"
            (click)="more()"
            [disabled]="store.loading()"
          >
            {{ store.loading() ? 'Loading…' : 'Load more artwork' }}
            @if (!store.loading()) {
              <app-icon name="arrow-down" />
            }
          </button>
        </div>
      }
    </section>
  `,
})
export class FeedComponent {
  readonly store = inject(FeedStore);
  readonly auth = inject(AuthStore);
  constructor() {
    this.store.load(
      combineLatest([
        inject(ActivatedRoute).data,
        toObservable(this.auth.user),
      ]).pipe(map(([data]) => ({ mode: data['mode'] as FeedMode }))),
    );
  }
  refresh() {
    this.store.load({ mode: this.store.mode() });
  }
  more() {
    const cursor = this.store.nextCursor();
    if (cursor && !this.store.loading())
      this.store.load({ mode: this.store.mode(), cursor });
  }
}
