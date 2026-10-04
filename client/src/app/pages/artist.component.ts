import { IconComponent } from '../shared/icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { Artist, Workshop } from '../../../../shared/contracts';
import { ApiService } from '../core/api.service';
import { AuthStore } from '../core/auth.store';
import { errorMessage } from '../core/errors';
import { ArtCardComponent } from '../shared/art-card.component';
import { WorkshopCardComponent } from '../shared/workshop-card.component';

@Component({
  selector: 'app-artist',
  imports: [IconComponent, RouterLink, ArtCardComponent, WorkshopCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-width inner-page">
      <a routerLink="/" class="back-link"
        ><app-icon name="arrow-left" /> Back to the collection</a
      >
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (artist(); as person) {
        <div class="profile-header">
          <span class="profile-avatar">{{
            person.username.charAt(0).toUpperCase()
          }}</span>
          <div>
            <p class="eyebrow">
              {{
                person.role === 'artist'
                  ? 'MEET THE ARTIST'
                  : 'PART OF THE COMMUNITY'
              }}
            </p>
            <h1>{{ person.username }}</h1>
            <p>
              {{ person.artworks.length }}
              {{ person.artworks.length === 1 ? 'work' : 'works' }} ·
              {{ person.workshops.length }}
              {{ person.workshops.length === 1 ? 'workshop' : 'workshops' }}
            </p>
          </div>
          @if (person.id !== auth.user()?.id) {
            <button
              class="button button-outline"
              [disabled]="busy()"
              (click)="follow()"
            >
              {{ person.following ? 'Following' : 'Follow' }}
              <app-icon
                [name]="person.following ? 'check' : 'arrow-up-right'"
              />
            </button>
          }
        </div>
        <div class="section-heading">
          <h2>A creative <em>perspective.</em></h2>
        </div>
        <div class="art-grid">
          @for (art of person.artworks; track art.id) {
            <app-art-card [art]="art" />
          }
        </div>
        @if (!person.artworks.length) {
          <div class="empty-state"><p>No artworks shared yet.</p></div>
        }
        @if (person.workshops.length) {
          <div class="section-heading">
            <h2>Learn <em>together.</em></h2>
          </div>
          <div class="workshop-grid">
            @for (workshop of person.workshops; track workshop.id) {
              <app-workshop-card
                [workshop]="workshop"
                (changed)="updateWorkshop($event)"
              />
            }
          </div>
        }
      } @else if (!error()) {
        <div class="empty-state" aria-busy="true">
          Getting to know this person…
        </div>
      }
    </section>
  `,
})
export class ArtistComponent {
  readonly id = input.required<string>();
  readonly auth = inject(AuthStore);
  readonly artist = signal<Artist | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  constructor() {
    effect((onCleanup) => {
      const id = this.id();
      this.auth.user();
      this.artist.set(null);
      this.error.set('');
      const request = this.api.artist(id).subscribe({
        next: (artist) => this.artist.set(artist),
        error: (error: unknown) => this.error.set(errorMessage(error)),
      });
      onCleanup(() => request.unsubscribe());
    });
  }
  async follow() {
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/login'], {
        queryParams: { returnUrl: `/people/${this.id()}` },
      });
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const response = await firstValueFrom(
        this.api.follow(this.id(), !this.artist()?.following),
      );
      this.artist.update((artist) =>
        artist ? { ...artist, ...response } : artist,
      );
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  updateWorkshop(workshop: Workshop) {
    this.artist.update((artist) =>
      artist
        ? {
            ...artist,
            workshops: artist.workshops.map((entry) =>
              entry.id === workshop.id ? workshop : entry,
            ),
          }
        : artist,
    );
  }
}
