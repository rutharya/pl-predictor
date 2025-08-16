import { Injectable, inject, signal } from '@angular/core';
import {
  Auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  user,
  GoogleAuthProvider,
  signInWithPopup,
} from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { User } from 'firebase/auth';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private auth = inject(Auth);

  // Signal-based user state
  currentUser = signal<User | null>(null);

  // Observable user state (for reactive forms/templates)
  user$: Observable<User | null> = user(this.auth);

  constructor() {
    // Update signal when auth state changes
    this.user$.subscribe((user) => this.currentUser.set(user));
  }

  async signInWithEmailAndPassword(email: string, password: string) {
    try {
      const userCredential = await signInWithEmailAndPassword(
        this.auth,
        email,
        password
      );
      return userCredential;
    } catch (error) {
      throw error;
    }
  }

  async createUserWithEmailAndPassword(email: string, password: string) {
    try {
      const userCredential = await createUserWithEmailAndPassword(
        this.auth,
        email,
        password
      );
      return userCredential;
    } catch (error) {
      throw error;
    }
  }

  async signInWithGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(this.auth, provider);
      return userCredential;
    } catch (error) {
      throw error;
    }
  }

  async signOut() {
    try {
      await signOut(this.auth);
    } catch (error) {
      throw error;
    }
  }
}
