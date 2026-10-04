import { IconComponent } from '../shared/icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  catchError,
  combineLatest,
  debounceTime,
  EMPTY,
  firstValueFrom,
  switchMap,
  tap,
} from 'rxjs';
import type { Page, Person } from '../../../../shared/contracts';
import { ApiService } from '../core/api.service';
import { AuthStore } from '../core/auth.store';
import { errorMessage } from '../core/errors';
@Component({
  selector: 'app-people',
  imports: [IconComponent, RouterLink, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="page-width inner-page">
    <p class="eyebrow">THE PEOPLE BEHIND THE GALLERY</p>
    <h1>Find your <em>people.</em></h1>
    <p>
      Follow artists and patrons. When they share artwork, you’ll find it in
      your Following feed.
    </p>
    <nav class="feed-tabs" aria-label="Community navigation">
      <a routerLink="/explore">Explore</a>
      @if (auth.signedIn()) {
        <a routerLink="/following"
          >Your Following feed <app-icon name="arrow-right"
        /></a>
      }
    </nav>
    <label class="people-search" for="people-search"
      >Search by username<input
        id="people-search"
        type="search"
        [formControl]="search"
        maxlength="120"
        placeholder="Find someone in the community…"
    /></label>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (loading()) {
      <p aria-busy="true">Finding creative connections…</p>
    } @else {
      <div class="people-grid">
        @for (person of result()?.items ?? []; track person.id) {
          <article class="form-panel person-card">
            <a [routerLink]="['/people', person.id]" class="person-name"
              ><span class="profile-avatar">{{
                person.username.charAt(0).toUpperCase()
              }}</span>
              <h2>{{ person.username }}</h2></a
            >
            <p>{{ person.role === 'artist' ? 'Artist' : 'Art patron' }}</p>
            @if (person.id !== auth.user()?.id) {
              <button
                class="button button-outline button-small"
                [disabled]="busy()"
                (click)="follow(person)"
              >
                {{ person.following ? 'Following' : 'Follow' }}
                <app-icon
                  [name]="person.following ? 'check' : 'arrow-up-right'"
                />
              </button>
            } @else {
              <a routerLink="/account"
                >Your account <app-icon name="arrow-right"
              /></a>
            }
          </article>
        }
      </div>
      @if (!result()?.items?.length) {
        <div class="empty-state"><p>No people match that username.</p></div>
      }
      @if ((result()?.pages ?? 0) > 1) {
        <nav class="pagination" aria-label="People pagination">
          <button
            class="button button-outline"
            [disabled]="page() <= 1"
            (click)="navigate(page() - 1)"
          >
            <app-icon name="arrow-left" /> Previous</button
          ><span>{{ page() }} / {{ result()?.pages }}</span
          ><button
            class="button button-outline"
            [disabled]="page() >= (result()?.pages ?? 0)"
            (click)="navigate(page() + 1)"
          >
            Next <app-icon name="arrow-right" />
          </button>
        </nav>
      }
    }
  </section>`,
})
export class PeopleComponent {
  readonly auth = inject(AuthStore);
  readonly search = new FormControl('', { nonNullable: true });
  readonly result = signal<Page<Person> | null>(null);
  readonly page = signal(1);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  constructor() {
    combineLatest([this.route.queryParamMap, toObservable(this.auth.user)])
      .pipe(
        tap(() => {
          this.loading.set(true);
          this.error.set('');
          this.result.set(null);
        }),
        switchMap(([params]) => {
          const search = params.get('search') || '',
            page = Math.max(1, Number(params.get('page')) || 1);
          this.page.set(page);
          this.search.setValue(search, { emitEvent: false });
          return this.api.people(search, page).pipe(
            tap((result) => {
              this.result.set(result);
              this.loading.set(false);
            }),
            catchError((error: unknown) => {
              this.loading.set(false);
              this.error.set(errorMessage(error));
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
    this.search.valueChanges
      .pipe(debounceTime(250), takeUntilDestroyed())
      .subscribe(() => void this.navigate(1));
  }
  navigate(page: number) {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { search: this.search.value, page },
    });
  }
  async follow(person: Person) {
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/login'], {
        queryParams: { returnUrl: '/people' },
      });
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.api.follow(person.id, !person.following),
      );
      this.result.update((result) =>
        result
          ? {
              ...result,
              items: result.items.map((p) =>
                p.id === person.id ? { ...p, ...response } : p,
              ),
            }
          : result,
      );
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
