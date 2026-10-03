import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ArtworkSummary } from '../../../../shared/contracts';

@Component({
  selector: 'app-art-card',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="art-card" [routerLink]="['/artworks', art().id]">
      <div class="art-card-image" [class.image-unavailable]="unavailable()">
        @if (!unavailable()) {
          <img
            [src]="art().imageUrl"
            [alt]="art().title"
            loading="lazy"
            (error)="unavailable.set(true)"
          />
        } @else {
          <span class="image-placeholder">A<span>Image unavailable</span></span>
        }
        <span class="category-label">{{ art().category }}</span>
        <span class="art-card-arrow" aria-hidden="true">↗</span>
      </div>
      <div class="art-card-meta">
        <p>{{ art().artist }}</p>
        <span>{{ art().year }}</span>
      </div>
      <h3>{{ art().title }}</h3>
      <div class="art-card-bottom">
        <span>{{ art().medium }}</span
        ><span
          [attr.aria-label]="
            art().likeCount + (art().likeCount === 1 ? ' like' : ' likes')
          "
          >{{ art().liked ? '♥' : '♡' }} {{ art().likeCount }}</span
        >
      </div>
    </a>
  `,
})
export class ArtCardComponent {
  readonly art = input.required<ArtworkSummary>();
  readonly unavailable = signal(false);
}
