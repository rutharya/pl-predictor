import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="login-container">
      <h2>Login</h2>

      <form [formGroup]="loginForm" (ngSubmit)="onSubmit()">
        <div class="form-group">
          <label for="email">Email:</label>
          <input
            type="email"
            id="email"
            formControlName="email"
            [class.error]="emailControl?.invalid && emailControl?.touched"
          />
          <div
            *ngIf="emailControl?.invalid && emailControl?.touched"
            class="error-message"
          >
            Email is required and must be valid
          </div>
        </div>

        <div class="form-group">
          <label for="password">Password:</label>
          <input
            type="password"
            id="password"
            formControlName="password"
            [class.error]="passwordControl?.invalid && passwordControl?.touched"
          />
          <div
            *ngIf="passwordControl?.invalid && passwordControl?.touched"
            class="error-message"
          >
            Password is required (min 6 characters)
          </div>
        </div>

        <button type="submit" [disabled]="loginForm.invalid || loading()">
          {{ loading() ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>

      <div class="divider">OR</div>

      <button
        type="button"
        (click)="signInWithGoogle()"
        [disabled]="loading()"
        class="google-btn"
      >
        Sign in with Google
      </button>

      <div *ngIf="errorMessage()" class="error-message">
        {{ errorMessage() }}
      </div>
    </div>
  `,
  styles: [
    `
      .login-container {
        max-width: 400px;
        margin: 2rem auto;
        padding: 2rem;
        border: 1px solid #ddd;
        border-radius: 8px;
      }

      .form-group {
        margin-bottom: 1rem;
      }

      label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: bold;
      }

      input {
        width: 100%;
        padding: 0.5rem;
        border: 1px solid #ddd;
        border-radius: 4px;
      }

      input.error {
        border-color: #dc3545;
      }

      .error-message {
        color: #dc3545;
        font-size: 0.875rem;
        margin-top: 0.25rem;
      }

      button {
        width: 100%;
        padding: 0.75rem;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        margin-bottom: 1rem;
      }

      button:disabled {
        background-color: #6c757d;
        cursor: not-allowed;
      }

      .google-btn {
        background-color: #db4437;
      }

      .divider {
        text-align: center;
        margin: 1rem 0;
        color: #666;
      }
    `,
  ],
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  // Signals for reactive state
  loading = signal(false);
  errorMessage = signal<string | null>(null);

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  get emailControl() {
    return this.loginForm.get('email');
  }

  get passwordControl() {
    return this.loginForm.get('password');
  }

  async onSubmit() {
    if (this.loginForm.valid) {
      this.loading.set(true);
      this.errorMessage.set(null);

      try {
        const { email, password } = this.loginForm.value;
        await this.authService.signInWithEmailAndPassword(email, password);
        this.router.navigate(['/profile']);
      } catch (error: any) {
        this.errorMessage.set(error.message || 'Login failed');
      } finally {
        this.loading.set(false);
      }
    }
  }

  async signInWithGoogle() {
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      await this.authService.signInWithGoogle();
      this.router.navigate(['/profile']);
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Google sign-in failed');
    } finally {
      this.loading.set(false);
    }
  }
}
