import { featuredImage } from '../../../../shared/collection-images';
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
      <div class="hero-copy">
        <p class="eyebrow">
          <span class="status-dot"></span> A SPACE FOR ART & THE PEOPLE BEHIND
          IT
        </p>
        <h1>Find something<br />that <em>moves you.</em></h1>
        <p class="hero-description">
          A gallery without walls. Discover independent artists, save the works
          you love, and make room for a little more creativity.
        </p>
        <div class="hero-actions">
          <a class="button" href="#collection"
            >Explore the collection
            <span><app-icon name="arrow-up-right" /></span></a
          ><a class="text-link" routerLink="/workshops"
            >Learn with an artist <app-icon name="arrow-right"
          /></a>
        </div>
        <div class="hero-stats">
          <div>
            <strong>{{ stats()?.artworks ?? '—' }}</strong
            ><span>works to discover</span>
          </div>
          <div>
            <strong>{{ stats()?.artists ?? '—' }}</strong
            ><span>creative voices</span>
          </div>
          <div>
            <strong>{{ stats()?.workshops ?? '—' }}</strong
            ><span>ways to learn</span>
          </div>
        </div>
      </div>
      <div class="hero-art">
        <div class="hero-image-frame">
          <img
            [src]="'/artworks/' + featured.file"
            [alt]="featured.alt"
            [width]="featured.width"
            [height]="featured.height"
            fetchpriority="high"
            decoding="async"
          />
          <div class="hero-art-caption">
            <span>{{ featured.title }} · {{ featured.creator }}</span
            ><a
              [href]="featured.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              >The Met, CC0 <app-icon name="arrow-up-right"
            /></a>
          </div>
        </div>
      </div>
    </section>
    <section id="collection" class="collection page-width">
      <div class="section-heading">
        <div>
          <p class="eyebrow">THE COLLECTION</p>
          <h2>Good art. <em>Great company.</em></h2>
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
            placeholder="Search art, artists, and ideas…"
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
        ><button class="text-button" type="button" (click)="reset()">
          Reset filters
        </button>
      </form>
      <div class="results-heading">
        <p>
          {{
            store.loading()
              ? 'Finding your next favorite…'
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
          <h3>A little room for possibility.</h3>
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
      <div>
        <p class="eyebrow">MAKE YOURSELF AT HOME</p>
        <h2>A place for your<br /><em>creative side.</em></h2>
      </div>
      <div>
        <p>
          Keep a collection of favorites. Meet the people who made them. Learn
          something you didn’t know you could do.
        </p>
        <a
          class="button button-light"
          [routerLink]="auth.signedIn() ? '/account' : '/register'"
          >{{ auth.signedIn() ? 'Open your collection' : 'Find your people' }}
          <app-icon name="arrow-up-right"
        /></a>
      </div>
    </section>
  `,
})
export class GalleryComponent {
  readonly featured = featuredImage;
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
  private navigate(params: Record<string, string | number>) {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
    });
  }
  reset() {
    this.filters.reset({ search: '', category: '' }, { emitEvent: false });
    void this.navigate({ page: 1 });
  }
  page(change: number) {
    void this.navigate({
      ...this.store.query(),
      page: this.store.query().page + change,
    });
  }
}
