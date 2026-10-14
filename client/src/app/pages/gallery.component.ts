import { IconComponent } from '../shared/icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, debounceTime, firstValueFrom, map, tap } from 'rxjs';
import type { GalleryQuery, GalleryStats } from '../../../../shared/contracts';
import { GalleryStore } from '../core/gallery.store';
import { ApiService } from '../core/api.service';
import { AuthStore } from '../core/auth.store';
import { ArtCardComponent } from '../shared/art-card.component';

@Component({
  selector: 'app-gallery',
  imports: [IconComponent, ReactiveFormsModule, RouterLink, ArtCardComponent],
  providers: [GalleryStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero page-width">
      <h1>A closer look at art.</h1>
      <div class="hero-intro">
        <p class="hero-description">
          A collection of museum works and shared discoveries. Find your next
          favorite.
        </p>
        <nav class="hero-actions" aria-label="Collection shortcut">
          <a class="button" href="#collection"
            >Browse artworks <app-icon name="arrow-down"
          /></a>
        </nav>
      </div>
    </section>
    <section id="collection" class="collection page-width">
      <div class="section-heading">
        <div>
          <h2>The collection</h2>
        </div>
        @if (auth.isArtist()) {
          <a class="button button-outline" routerLink="/artworks/new"
            >Publish your work <app-icon name="arrow-up-right"
          /></a>
        }
      </div>
      <form
        class="filter-bar"
        [formGroup]="filters"
        aria-label="Filter artworks"
      >
        <label class="search-field"
          ><span aria-hidden="true"><app-icon name="search" /></span
          ><span class="sr-only">Search artworks</span
          ><input
            formControlName="search"
            placeholder="Search the collection…"
            type="search"
            maxlength="120" /></label
        ><label class="category-field"
          ><span class="sr-only">Category</span
          ><select formControlName="category">
            <option value="">All categories</option>
            @for (category of stats()?.categories ?? []; track category) {
              <option [value]="category">{{ category }}</option>
            }
          </select></label
        >
        @if (
          store.query().search || store.query().category || store.query().artist
        ) {
          <button class="text-button" type="button" (click)="reset()">
            Reset filters
          </button>
        }
      </form>
      <div class="results-heading">
        <p role="status" aria-live="polite" aria-atomic="true">
          {{
            store.loading()
              ? 'Searching the collection…'
              : store.total() +
                (store.total() === 1 ? ' work to explore' : ' works to explore')
          }}
        </p>
        <span>Newest first</span>
      </div>
      @if (store.error()) {
        <div class="empty-state" role="alert">
          <h3>We couldn’t load the collection.</h3>
          <p>{{ store.error() }}</p>
          <button class="button" (click)="store.load(store.query())">
            Try again
          </button>
        </div>
      } @else if (store.loading()) {
        <div class="art-grid" aria-label="Loading artworks" aria-busy="true">
          @for (item of [1, 2, 3, 4, 5, 6]; track item) {
            <div class="skeleton-card">
              <div></div>
              <span></span><span></span>
            </div>
          }
        </div>
      } @else if (!store.items().length) {
        <div class="empty-state">
          <span class="empty-mark"><app-icon name="arrow-up-right" /></span>
          <h3>No matching artworks</h3>
          <p>
            No artworks match these filters. Try another search or share the
            first work.
          </p>
          <button class="button button-outline" (click)="reset()">
            Clear filters
          </button>
        </div>
      } @else {
        <div class="art-grid">
          @for (art of store.items(); track art.id) {
            <app-art-card [art]="art" />
          }
        </div>
      }
      @if (store.pages() > 1) {
        <nav class="pagination" aria-label="Gallery pagination">
          <span
            >Showing {{ store.rangeStart() }}–{{ store.rangeEnd() }} of
            {{ store.total() }}</span
          >
          <div>
            <button
              class="button button-outline button-small"
              [disabled]="store.query().page <= 1 || store.loading()"
              (click)="page(-1)"
            >
              <app-icon name="arrow-left" /> Previous</button
            ><span>{{ store.query().page }} / {{ store.pages() }}</span
            ><button
              class="button button-outline button-small"
              [disabled]="
                store.query().page >= store.pages() || store.loading()
              "
              (click)="page(1)"
            >
              Next <app-icon name="arrow-right" />
            </button>
          </div>
        </nav>
      }
    </section>
    <section class="community-banner page-width">
      <p>Keep the works you love.<br />Make a collection of your own.</p>
      <a
        class="button"
        [routerLink]="auth.signedIn() ? '/account' : '/register'"
        >{{
          auth.signedIn() ? 'Open your collection' : 'Start your collection'
        }}
        <app-icon name="arrow-up-right"
      /></a>
    </section>
  `,
})
export class GalleryComponent {
  readonly store = inject(GalleryStore);
  readonly auth = inject(AuthStore);
  readonly stats = signal<GalleryStats | null>(null);
  readonly filters = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    category: new FormControl('', { nonNullable: true }),
  });
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  constructor() {
    this.store.load(
      combineLatest([
        this.route.queryParamMap,
        toObservable(this.auth.user),
      ]).pipe(
        map(([params]): GalleryQuery => ({
          search: params.get('search') || '',
          category: params.get('category') || '',
          artist: params.get('artist') || '',
          page: Math.max(1, Number(params.get('page')) || 1),
        })),
        tap((query) =>
          this.filters.patchValue(
            { search: query.search, category: query.category },
            { emitEvent: false },
          ),
        ),
      ),
    );
    this.filters.valueChanges
      .pipe(debounceTime(250), takeUntilDestroyed())
      .subscribe(() =>
        this.navigate({ ...this.filters.getRawValue(), page: 1 }),
      );
    firstValueFrom(inject(ApiService).stats())
      .then((stats) => this.stats.set(stats))
      .catch(() => undefined);
  }
  private navigate(
    params: Record<string, string | number>,
    preserveScroll = true,
  ) {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      // Filtering updates this view; it must not trigger the global scroll-to-top.
      scroll: preserveScroll ? 'manual' : undefined,
    });
  }
  reset() {
    this.filters.reset({ search: '', category: '' }, { emitEvent: false });
    void this.navigate({ page: 1 });
  }
  page(change: number) {
    void this.navigate(
      {
        ...this.store.query(),
        page: this.store.query().page + change,
      },
      false,
    );
  }
}
