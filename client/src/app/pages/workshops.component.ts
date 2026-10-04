import { IconComponent } from '../shared/icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { Page, Workshop } from '../../../../shared/contracts';
import { ApiService } from '../core/api.service';
import { AuthStore } from '../core/auth.store';
import { errorMessage } from '../core/errors';
import { WorkshopCardComponent } from '../shared/workshop-card.component';

@Component({
  selector: 'app-workshops',
  imports: [IconComponent, RouterLink, WorkshopCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-width inner-page">
      <div class="section-heading">
        <div>
          <p class="eyebrow">MAKE SOMETHING OF YOUR CURIOSITY</p>
          <h1>Creative company.<br /><em>New possibilities.</em></h1>
          <p class="lead">
            Get closer to the process. Learn from the artists who bring it to
            life.
          </p>
        </div>
        @if (auth.isArtist()) {
          <a class="button" routerLink="/workshops/new"
            >Host a workshop <app-icon name="arrow-up-right"
          /></a>
        }
      </div>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (loading()) {
        <div class="empty-state" aria-busy="true">
          Finding creative opportunities…
        </div>
      } @else if (!result()?.items?.length) {
        <div class="empty-state">
          <span class="empty-mark">✳</span>
          <h2>The next chapter is unwritten.</h2>
          <p>
            No workshops have been shared yet. Artists can host one from their
            collection.
          </p>
        </div>
      } @else {
        <div class="workshop-grid">
          @for (workshop of result()!.items; track workshop.id) {
            <app-workshop-card
              [workshop]="workshop"
              (changed)="update($event)"
            />
          }
        </div>
      }
      @if ((result()?.pages ?? 0) > 1) {
        <nav class="pagination" aria-label="Workshop pagination">
          <button
            class="button button-outline"
            [disabled]="page() <= 1 || loading()"
            (click)="load(page() - 1)"
          >
            <app-icon name="arrow-left" /> Previous</button
          ><span>{{ page() }} / {{ result()?.pages }}</span
          ><button
            class="button button-outline"
            [disabled]="page() >= (result()?.pages ?? 0) || loading()"
            (click)="load(page() + 1)"
          >
            Next <app-icon name="arrow-right" />
          </button>
        </nav>
      }
    </section>
  `,
})
export class WorkshopsComponent {
  readonly auth = inject(AuthStore);
  private readonly api = inject(ApiService);
  readonly result = signal<Page<Workshop> | null>(null);
  readonly error = signal('');
  readonly loading = signal(true);
  readonly page = signal(1);
  constructor() {
    void this.load(1);
  }
  async load(page: number) {
    this.page.set(page);
    this.loading.set(true);
    this.error.set('');
    try {
      this.result.set(await firstValueFrom(this.api.workshops(page)));
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
  update(workshop: Workshop) {
    this.result.update((result) =>
      result
        ? {
            ...result,
            items: result.items.map((entry) =>
              entry.id === workshop.id ? workshop : entry,
            ),
          }
        : result,
    );
  }
}
