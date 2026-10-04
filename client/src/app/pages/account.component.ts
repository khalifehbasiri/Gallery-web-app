import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import type { Account, Workshop } from '../../../../shared/contracts';
import { AuthStore } from '../core/auth.store';
import { ApiService } from '../core/api.service';
import { errorMessage } from '../core/errors';
import { ArtCardComponent } from '../shared/art-card.component';
import { WorkshopCardComponent } from '../shared/workshop-card.component';
import { AccountSettingsComponent } from '../shared/account-settings.component';

@Component({
  selector: 'app-account',
  imports: [
    RouterLink,
    ArtCardComponent,
    WorkshopCardComponent,
    AccountSettingsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-width inner-page">
      <div class="section-heading">
        <div>
          <p class="eyebrow">YOUR LITTLE CORNER OF THE GALLERY</p>
          <h1>
            Hello, {{ auth.user()?.username }}<span class="brand-dot">.</span>
          </h1>
          <p class="lead">A collection of things that speak to you.</p>
        </div>
        <span class="role-badge">{{
          auth.user()?.role === 'artist' ? 'Artist account' : 'Art enthusiast'
        }}</span>
      </div>
      <div class="account-tools">
        <div>
          <h3>Active sessions</h3>
          <p>Sign out a device if you lose access to it.</p>
        </div>
        <button class="text-button" [disabled]="busy()" (click)="logoutAll()">
          Sign out all devices
        </button>
      </div>
      @for (session of sessions(); track session.id) {
        <div class="account-tools">
          <p>
            {{ session.current ? 'This browser' : 'Another browser' }} · Signed
            in {{ session.createdAt.slice(0, 10) }}
          </p>
          <button
            class="text-button"
            [disabled]="busy()"
            (click)="revoke(session.id, session.current)"
          >
            Sign out
          </button>
        </div>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <app-account-settings />
      <div class="account-tools">
        <div>
          <h3>
            {{
              auth.isArtist()
                ? 'Your creative studio'
                : 'Have something to share?'
            }}
          </h3>
          <p>
            {{
              auth.isArtist()
                ? 'Share your latest work or invite the community into your process.'
                : 'Switch to an artist account to publish artwork and host workshops.'
            }}
          </p>
        </div>
        <div class="account-tool-actions">
          @if (auth.isArtist()) {
            <a class="button" routerLink="/artworks/new">Publish artwork ↗</a
            ><a class="button button-outline" routerLink="/workshops/new"
              >Host a workshop</a
            >
          }
          @if (!publicDemo()) {
            <button
              class="text-button"
              [disabled]="busy()"
              (click)="changeRole()"
            >
              {{ auth.isArtist() ? 'Switch to patron' : 'Become an artist ↗' }}
            </button>
          }
        </div>
      </div>
      @if (account(); as data) {
        <div class="section-heading">
          <h2>Your <em>favorites.</em></h2>
          <span
            >{{ data.likes.length }} saved
            {{ data.likes.length === 1 ? 'work' : 'works' }}</span
          >
        </div>
        <div class="art-grid">
          @for (art of data.likes; track art.id) {
            <app-art-card [art]="art" />
          }
        </div>
        @if (!data.likes.length) {
          <div class="empty-state">
            <h3>Start with something you love.</h3>
            <p>Save an artwork to find it here.</p>
            <a routerLink="/" class="text-link">Explore the collection →</a>
          </div>
        }
        <div class="section-heading">
          <h2>Creative <em>connections.</em></h2>
        </div>
        <div class="following-list">
          @for (person of data.following; track person.id) {
            <a [routerLink]="['/artists', person.id]"
              ><span class="avatar">{{
                person.username.charAt(0).toUpperCase()
              }}</span
              >{{ person.username }}<span>↗</span></a
            >
          }
        </div>
        @if (!data.following.length) {
          <p class="muted">Follow an artist to keep their profile close.</p>
        }
        @if (data.reviews.length) {
          <div class="section-heading">
            <h2>Your <em>point of view.</em></h2>
          </div>
          @for (review of data.reviews; track $index) {
            <a
              class="account-review"
              [routerLink]="['/artworks', review.artworkId]"
              >“{{ review.text }}” <span>View artwork ↗</span></a
            >
          }
        }
        @if (auth.isArtist()) {
          <div class="section-heading">
            <h2>From <em>your studio.</em></h2>
          </div>
          <div class="art-grid">
            @for (art of data.artworks; track art.id) {
              <app-art-card [art]="art" />
            }
          </div>
          @if (!data.artworks.length) {
            <p class="muted">Your first artwork is waiting to be shared.</p>
          }
          <div class="section-heading">
            <h2>Your <em>workshops.</em></h2>
          </div>
          <div class="workshop-grid">
            @for (workshop of data.workshops; track workshop.id) {
              <app-workshop-card
                [workshop]="workshop"
                (changed)="updateWorkshop($event)"
              />
            }
          </div>
        }
      } @else if (!error()) {
        <div class="empty-state" aria-busy="true">Opening your collection…</div>
      }
    </section>
  `,
})
export class AccountComponent {
  readonly auth = inject(AuthStore);
  readonly publicDemo = computed(() =>
    ['demo', 'Maya Laurent'].includes(this.auth.user()?.username || ''),
  );
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly sessions = signal<
    { id: string; createdAt: string; current: boolean }[]
  >([]);
  readonly account = signal<Account | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  constructor() {
    void this.load();
  }
  private async load() {
    try {
      this.account.set(await firstValueFrom(this.api.account()));
      this.sessions.set(await firstValueFrom(this.api.sessions()));
    } catch (error) {
      this.error.set(errorMessage(error));
    }
  }
  async changeRole() {
    this.busy.set(true);
    this.error.set('');
    try {
      const { user } = await firstValueFrom(
        this.api.updateRole(this.auth.isArtist() ? 'patron' : 'artist'),
      );
      this.auth.setUser(user);
      await this.load();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  async revoke(id: string, current: boolean) {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.revokeSession(id));
      if (current) {
        this.auth.setUser(null);
        await this.router.navigate(['/']);
      } else
        this.sessions.update((items) => items.filter((item) => item.id !== id));
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  async logoutAll() {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.logoutAll());
      this.auth.setUser(null);
      await this.router.navigate(['/']);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
  updateWorkshop(workshop: Workshop) {
    this.account.update((account) =>
      account
        ? {
            ...account,
            workshops: account.workshops.map((entry) =>
              entry.id === workshop.id ? workshop : entry,
            ),
          }
        : account,
    );
  }
}
