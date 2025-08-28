import { Component, inject, OnDestroy } from '@angular/core';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnDestroy {
  protected authService = inject(AuthService);

  async signInWithGoogle(): Promise<void> {
    await this.authService.signInWithGoogle();
  }

  ngOnDestroy(): void {
    this.authService.clearError();
  }
}
