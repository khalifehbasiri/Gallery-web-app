import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { Workshop } from '../../../../shared/contracts';
import { ApiService } from '../core/api.service';
import { AuthStore } from '../core/auth.store';
import { errorMessage } from '../core/errors';

@Component({
  selector: 'app-workshop-card',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="workshop-card">
      <span class="eyebrow"
        >CREATIVE WORKSHOP · {{ workshop().weeks }} WEEKS</span
      >
      <h3>{{ workshop().name }}</h3>
      <p>{{ workshop().goal }}</p>
      <a [routerLink]="['/artists', workshop().artistId]"
        >Led by {{ workshop().artist }} ↗</a
      >
      <div class="workshop-card-bottom">
        <span
          >{{ workshop().attendeeCount }}
          {{
            workshop().attendeeCount === 1 ? 'participant' : 'participants'
          }}</span
        ><button
          class="button button-small"
          [disabled]="busy() || workshop().joined"
          (click)="join()"
        >
          {{ workshop().joined ? 'You’re on the list ✓' : 'Join workshop' }}
        </button>
      </div>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
    </article>
  `,
})
export class WorkshopCardComponent {
  readonly workshop = input.required<Workshop>();
  readonly changed = output<Workshop>();
  readonly busy = signal(false);
  readonly error = signal('');
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  async join() {
    if (!this.auth.signedIn()) {
      await this.router.navigate(['/login'], {
        queryParams: { returnUrl: '/workshops' },
      });
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      this.changed.emit(
        await firstValueFrom(this.api.joinWorkshop(this.workshop())),
      );
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
