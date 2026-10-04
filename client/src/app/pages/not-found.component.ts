import { IconComponent } from '../shared/icon.component';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="page-width empty-state inner-page">
    <p class="eyebrow">404 · A DIFFERENT DIRECTION</p>
    <h1>This wall is <em>still blank.</em></h1>
    <p>
      We couldn’t find that page. There’s plenty to discover in the collection.
    </p>
    <a class="button" routerLink="/"
      >Back to the gallery <app-icon name="arrow-up-right"
    /></a>
  </section>`,
})
export class NotFoundComponent {}
