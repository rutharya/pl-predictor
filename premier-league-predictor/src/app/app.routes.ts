import { Routes } from '@angular/router';
import { authGuard, unauthGuard, adminGuard } from './core/auth2.guard';
import { Dashboard } from './features/dashboard/dashboard';
import { LoginComponent } from './features/login/login';
import { Login2 } from './features/login2/login2';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login2/login2').then((m) => m.Login2),
    canActivate: [unauthGuard],
    title: 'Login - Premier League Hub',
  },
  //   {
  //     path: 'dashboard',
  //     loadComponent: () =>
  //       import('./features/dashboard/dashboard').then((m) => m.Dashboard),
  //     canActivate: [authGuard],
  //     title: 'Dashboard - Premier League Hub',
  //   },
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

  //   { path: 'login', component: Login2 },
  //   {
  //     path: 'dashboard',
  //     component: Dashboard,
  //     // canActivate: [AuthGuard]
  //   },
  //     {
  //     path: '',
  //     loadComponent: () => import('./home/home.component').then(m => m.HomeComponent)
  //   },
  //   {
  //     path: 'login',
  //     loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent)
  //   },
  //   {
  //     path: 'profile',
  //     loadComponent: () => import('./profile/profile.component').then(m => m.ProfileComponent)
  //   },
];
