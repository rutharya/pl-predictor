import { Routes } from '@angular/router';
import { authGuard, unauthGuard, adminGuard } from './core/auth.guard';
import { Dashboard } from './features/dashboard/dashboard';
// import { Login } from './features/login/login';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/landing/landing').then((m) => m.Landing),
    title: 'Premier League Predictions - The Ultimate Football Game',
  },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
    canActivate: [unauthGuard],
    title: 'Login - Premier League Hub',
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard2/dashboard2').then((m) => m.Dashboard2),
    canActivate: [authGuard],
    title: 'Dashboard - Premier League Hub',
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./features/user-profile/user-profile').then((m) => m.UserProfile),
    canActivate: [authGuard],
    title: 'Profile - Premier League Hub',
  },
  {
    path: 'leaderboard',
    loadComponent: () =>
      import('./features/leaderboard/leaderboard').then((m) => m.Leaderboard),
    canActivate: [authGuard],
    title: 'Leaderboard - Premier League Hub',
  },
  {
    path: 'predictions',
    loadComponent: () =>
      import('./features/fixtures/fixtures').then((m) => m.Fixtures),
    canActivate: [authGuard],
    title: 'Predictions - Premier League Hub',
  },
];
