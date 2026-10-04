import { ChangeDetectionStrategy, Component, input } from '@angular/core';

const paths = {
  'arrow-up-right': 'M7 17 17 7M7 7h10v10',
  'arrow-right': 'M4 12h16m-7-7 7 7-7 7',
  'arrow-left': 'M20 12H4m7-7-7 7 7 7',
  'arrow-down': 'M12 4v16m-7-7 7 7 7-7',
  refresh:
    'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3a7 7 0 0 0 11.6-1',
  check: 'm5 12 4 4L19 6',
  search: 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  image:
    'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 17l6-6 4 4 3-3 5 5M8 7h.01',
} as const;

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  styles: `
    :host {
      display: inline-flex;
      width: 1.1em;
      height: 1.1em;
      flex: 0 0 auto;
      vertical-align: -0.15em;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
  template: `
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      [attr.fill]="filled() ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path [attr.d]="paths[name()]" />
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<keyof typeof paths>();
  readonly filled = input(false);
  protected readonly paths = paths;
}
