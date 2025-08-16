import { Component, inject, OnDestroy } from '@angular/core';
import { Auth2Service } from '../../core/auth2.service';

@Component({
  selector: 'app-login2',
  imports: [],
  templateUrl: './login2.html',
  styleUrl: './login2.css',
})
export class Login2 implements OnDestroy {
  protected authService = inject(Auth2Service);

  async signInWithGoogle(): Promise<void> {
    await this.authService.signInWithGoogle();
  }

  ngOnDestroy(): void {
    this.authService.clearError();
  }
}
