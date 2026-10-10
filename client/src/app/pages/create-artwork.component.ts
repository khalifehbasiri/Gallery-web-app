import { IconComponent } from '../shared/icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { errorMessage } from '../core/errors';
import { artForms, artFormForCategory } from '../../../../shared/art-forms';

@Component({
  selector: 'app-create-artwork',
  imports: [IconComponent, RouterLink, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    'fieldset { border: 0; padding: 0; margin: 0 0 1.5rem; } legend { font-weight: 600; margin-bottom: 1rem; }',
  ],
  template: `
    <section class="page-width inner-page">
      <a class="back-link" routerLink="/account"
        ><app-icon name="arrow-left" /> Back to your studio</a
      >
      <div class="section-heading">
        <div>
          <p class="eyebrow">FROM YOUR STUDIO TO THE WORLD</p>
          <h1>Share your <em>perspective.</em></h1>
          <p class="lead">Every work has a story. Tell us yours.</p>
        </div>
      </div>
      <form class="editor-form" [formGroup]="form" (ngSubmit)="submit()">
        <div class="upload-panel">
          <label for="image">Your artwork image</label>
          <div class="upload-preview">
            @if (preview()) {
              <img [src]="preview()" alt="Preview of your uploaded artwork" />
            } @else {
              <span class="empty-mark"><app-icon name="arrow-up-right" /></span>
              <p>A new perspective belongs here.</p>
            }
          </div>
          <input
            id="image"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            (change)="selectImage($event)"
          />
          <p class="field-hint">PNG, JPEG, GIF, or WebP · Up to 5 MB</p>
        </div>
        <div class="form-panel">
          <label for="title">Title</label
          ><input
            id="title"
            formControlName="title"
            maxlength="200"
            placeholder="What do you call this work?"
          />
          <div class="form-row">
            <div>
              <label for="year">Year</label
              ><input
                id="year"
                type="number"
                formControlName="year"
                min="0"
                max="9999"
              />
            </div>
            <div>
              <label for="category">Category</label
              ><input
                id="category"
                formControlName="category"
                maxlength="200"
                list="art-categories"
                placeholder="Painting, sculpture…"
              />
              <datalist id="art-categories">
                @for (category of categories; track category) {
                  <option [value]="category"></option>
                }
              </datalist>
            </div>
          </div>
          @if (selectedForm(); as type) {
            <fieldset>
              <legend>{{ artForms[type].category }} details</legend>
              @for (
                field of artForms[type].fields;
                track field.key;
                let index = $index
              ) {
                <label [for]="field.key">{{ field.label }}</label>
                <input
                  [id]="field.key"
                  [formControlName]="index === 0 ? 'detailOne' : 'detailTwo'"
                  maxlength="200"
                  [placeholder]="field.placeholder"
                />
              }
            </fieldset>
          }
          <label for="medium">Medium</label
          ><input
            id="medium"
            formControlName="medium"
            maxlength="200"
            placeholder="Oil on canvas, digital…"
          /><label for="description">The story behind it</label
          ><textarea
            id="description"
            formControlName="description"
            maxlength="10000"
            placeholder="Share your process, inspiration, or a little context."
          ></textarea>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          <button class="button full-width" [disabled]="busy()">
            {{ busy() ? 'Publishing…' : 'Publish artwork' }}
            @if (!busy()) {
              <app-icon name="arrow-up-right" />
            }
          </button>
        </div>
      </form>
    </section>
  `,
})
export class CreateArtworkComponent {
  readonly artForms = artForms;
  readonly categories = Object.values(artForms).map((form) => form.category);
  selectedForm() {
    return artFormForCategory(this.form.controls.category.value.trim());
  }
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', Validators.required],
    year: [
      new Date().getFullYear(),
      [Validators.required, Validators.min(0), Validators.max(9999)],
    ],
    category: ['', Validators.required],
    medium: ['', Validators.required],
    description: ['', Validators.required],
    detailOne: [''],
    detailTwo: [''],
  });
  readonly preview = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  private image: File | null = null;
  constructor() {
    this.form.controls.category.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.form.controls.detailOne.reset();
        this.form.controls.detailTwo.reset();
      });
  }
  selectImage(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    this.image = null;
    this.preview.set('');
    this.error.set('');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      this.error.set('Images must be 5 MB or smaller.');
      return;
    }
    if (
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
        file.type,
      )
    ) {
      this.error.set('Choose a PNG, JPEG, GIF, or WebP image.');
      return;
    }
    this.image = file;
    const reader = new FileReader();
    reader.onload = () => this.preview.set(String(reader.result));
    reader.readAsDataURL(file);
  }
  async submit() {
    if (this.form.invalid || !this.image) {
      this.error.set('Complete every field and choose an image.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const body = new FormData();
      const { detailOne, detailTwo, ...values } = this.form.getRawValue();
      const type = this.selectedForm();
      if (type) {
        if (!detailOne.trim() || !detailTwo.trim()) {
          this.error.set('Complete the art form details.');
          return;
        }
        body.append(
          'artDetails',
          JSON.stringify({
            type,
            [artForms[type].fields[0].key]: detailOne.trim(),
            [artForms[type].fields[1].key]: detailTwo.trim(),
          }),
        );
      }
      for (const [key, value] of Object.entries(values))
        body.append(key, String(value).trim());
      body.append('image', this.image);
      const art = await firstValueFrom(this.api.createArtwork(body));
      await this.router.navigate(['/artworks', art.id]);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
