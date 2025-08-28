import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { map, take } from 'rxjs/operators';

// Guard for protected routes - requires authentication
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.user$.pipe(
    take(1),
    map((user) => {
      if (user) {
        return true;
      } else {
        router.navigate(['/login'], {
          queryParams: { returnUrl: state.url },
        });
        return false;
      }
    })
  );
};

// Guard for auth pages (login) - redirects authenticated users
export const unauthGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.user$.pipe(
    take(1),
    map((user) => {
      if (!user) {
        return true;
      } else {
        // Redirect to dashboard or return URL
        const returnUrl = route.queryParams?.['returnUrl'] || '/dashboard';
        router.navigate([returnUrl]);
        return false;
      }
    })
  );
};

// admin.guard.ts - Example of role-based guard
export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.user$.pipe(
    take(1),
    map((user) => {
      if (user && user.email?.includes('admin')) {
        // Replace with your admin logic
        return true;
      } else {
        router.navigate(['/unauthorized']);
        return false;
      }
    })
  );
};
