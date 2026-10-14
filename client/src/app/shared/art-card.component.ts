import {
  collectionImage,
  isReferenceImage,
  isDemoCollection,
} from '../../../../shared/collection-images';
import { IconComponent } from './icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ArtworkSummary } from '../../../../shared/contracts';

@Component({
  selector: 'app-art-card',
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="art-card" [routerLink]="['/artworks', art().id]">
      <div class="art-card-image" [class.image-unavailable]="unavailable()">
        @if (!unavailable()) {
          <img
            [src]="art().imageUrl"
            [alt]="credit()?.alt ?? art().title"
            [attr.width]="credit()?.width"
            [attr.height]="credit()?.height"
            decoding="async"
            loading="lazy"
            (error)="unavailable.set(true)"
          />
        } @else {
          <span class="image-placeholder"
            ><app-icon name="image" /><span>Image unavailable</span></span
          >
        }
        <span class="art-card-arrow" aria-hidden="true"
          ><app-icon name="arrow-up-right"
        /></span>
      </div>
      @if (reference()) {
        <span class="reference-label">Reference image</span>
      }
      <div class="art-card-meta">
        <p>{{ art().category }}</p>
        <span>{{ art().year }}</span>
      </div>
      <p class="art-card-title">{{ art().title }}</p>
      <p class="art-card-author">
        {{ demoCollection() ? 'Shared by ' : '' }}{{ art().artist }}
      </p>
      <div class="art-card-bottom">
        <span>{{ art().medium }}</span
        ><span
          [attr.aria-label]="
            art().likeCount + (art().likeCount === 1 ? ' like' : ' likes')
          "
          ><app-icon name="heart" [filled]="art().liked" />
          {{ art().likeCount }}</span
        >
      </div>
      @if (credit(); as image) {
        <p class="image-credit">Image: {{ image.creator }} · The Met, CC0</p>
      }
    </a>
  `,
})
export class ArtCardComponent {
  readonly art = input.required<ArtworkSummary>();
  readonly unavailable = signal(false);
  readonly credit = computed(() => collectionImage(this.art().imageUrl));
  readonly reference = computed(() => isReferenceImage(this.art().description));
  readonly demoCollection = computed(() =>
    isDemoCollection(this.art().description),
  );
}
