import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorMessage } from '../core/errors';

@Component({
  selector: 'app-create-workshop',
  imports: [RouterLink, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-width inner-page">
      <a class="back-link" routerLink="/account">← Back to your studio</a>
      <div class="section-heading">
        <div>
          <p class="eyebrow">INVITE A LITTLE CREATIVE COMPANY</p>
          <h1>Open up your <em>process.</em></h1>
          <p class="lead">Share what you know. Make something together.</p>
        </div>
      </div>
      <form
        class="form-panel narrow-panel"
        [formGroup]="form"
        (ngSubmit)="submit()"
      >
        <label for="name">Workshop name</label
        ><input
          id="name"
          formControlName="name"
          maxlength="200"
          placeholder="An introduction to your craft"
        /><label for="goal">What will participants learn?</label
        ><textarea
          id="goal"
          formControlName="goal"
          maxlength="2000"
          placeholder="Describe the creative journey."
        ></textarea
        ><label for="weeks">Duration in weeks</label
        ><input
          id="weeks"
          type="number"
          formControlName="weeks"
          min="1"
          max="9999"
        />
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <button class="button full-width" [disabled]="busy()">
          {{ busy() ? 'Creating…' : 'Create workshop ↗' }}
        </button>
      </form>
    </section>
  `,
})
export class CreateWorkshopComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    goal: ['', Validators.required],
    weeks: [2, [Validators.required, Validators.min(1), Validators.max(9999)]],
  });
  async submit() {
    if (this.form.invalid) {
      this.error.set('Complete all fields and choose a positive duration.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.api.createWorkshop(this.form.getRawValue()));
      await this.router.navigate(['/workshops']);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
