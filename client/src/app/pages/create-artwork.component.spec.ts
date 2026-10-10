import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CreateArtworkComponent } from './create-artwork.component';
import { ApiService } from '../core/api.service';

describe('Art form publishing', () => {
  it('offers sculpture fields, requires their values and submits nested metadata with the image', async () => {
    const createArtwork = vi.fn((_body: FormData) => of({ id: 'saved' }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { createArtwork } },
      ],
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const fixture = TestBed.createComponent(CreateArtworkComponent),
      component = fixture.componentInstance;
    component.form.patchValue({
      category: 'Sculpture',
      title: 'Study',
      medium: 'Bronze',
      description: 'A sculpture.',
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('label[for=material]').textContent,
    ).toContain('Material');
    expect(
      fixture.nativeElement.querySelector('label[for=dimensions]').textContent,
    ).toContain('Dimensions');
    const image = new File(['image'], 'sculpture.png', { type: 'image/png' });
    component.selectImage({ target: { files: [image] } } as unknown as Event);
    await component.submit();
    expect(createArtwork).not.toHaveBeenCalled();
    expect(component.error()).toContain('art form details');
    expect(component.busy()).toBe(false);
    component.form.patchValue({ detailOne: 'Bronze', detailTwo: '25 cm' });
    await component.submit();
    const body = createArtwork.mock.calls[0]![0] as unknown as FormData;
    expect(JSON.parse(String(body.get('artDetails')))).toEqual({
      type: 'sculpture',
      material: 'Bronze',
      dimensions: '25 cm',
    });
    expect(body.get('image')).toBe(image);
    expect(body.has('detailOne')).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/artworks', 'saved']);
    component.form.controls.category.setValue('Photography');
    fixture.detectChanges();
    expect(component.form.controls.detailOne.value).toBe('');
    expect(
      fixture.nativeElement.querySelector('label[for=process]'),
    ).not.toBeNull();
  });
});
