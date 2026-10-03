import { HttpErrorResponse } from '@angular/common/http';

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (!error.status)
      return 'We could not reach the gallery. Please try again.';
    if (typeof error.error?.error === 'string') return error.error.error;
  }
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}
