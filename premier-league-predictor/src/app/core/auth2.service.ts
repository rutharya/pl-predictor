// auth.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Auth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  user,
  User,
  onAuthStateChanged,
  authState,
} from '@angular/fire/auth';
import { Observable, from, BehaviorSubject, map } from 'rxjs';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class Auth2Service {
  private auth = inject(Auth);
  private router = inject(Router);

  // Signals for reactive state management
  currentUser = signal<AuthUser | null>(null);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);
  isAuthenticated = signal<boolean>(false);

  // Observable for components that need it
  user$ = authState(this.auth);

  constructor() {
    this.initAuthStateListener();
  }

  private initAuthStateListener(): void {
    onAuthStateChanged(this.auth, (user) => {
      this.isLoading.set(false);
      if (user) {
        const authUser: AuthUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        };
        this.currentUser.set(authUser);
        this.isAuthenticated.set(true);
        this.error.set(null);
      } else {
        this.currentUser.set(null);
        this.isAuthenticated.set(false);
      }
    });
  }

  async signInWithGoogle(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      const provider = new GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');

      const credential = await signInWithPopup(this.auth, provider);

      if (credential.user) {
        // User will be set via the auth state listener
        this.router.navigate(['/dashboard']);
      }
    } catch (error: any) {
      console.error('Sign-in error:', error);
      this.handleAuthError(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async signOut(): Promise<void> {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      await signOut(this.auth);
      this.router.navigate(['/login']);
    } catch (error: any) {
      console.error('Sign-out error:', error);
      this.handleAuthError(error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private handleAuthError(error: any): void {
    let message = 'An authentication error occurred';

    switch (error.code) {
      case 'auth/popup-closed-by-user':
        message = 'Sign-in was cancelled';
        break;
      case 'auth/popup-blocked':
        message = 'Pop-up was blocked by your browser';
        break;
      case 'auth/network-request-failed':
        message = 'Network error. Please check your connection';
        break;
      case 'auth/too-many-requests':
        message = 'Too many attempts. Please try again later';
        break;
      case 'auth/user-disabled':
        message = 'This account has been disabled';
        break;
      default:
        message = error.message || message;
    }

    this.error.set(message);
  }

  // Utility methods
  getCurrentUserId(): string | null {
    return this.currentUser()?.uid || null;
  }

  isUserAuthenticated(): boolean {
    return this.isAuthenticated();
  }

  clearError(): void {
    this.error.set(null);
  }
}
