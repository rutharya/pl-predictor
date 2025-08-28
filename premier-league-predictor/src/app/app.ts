import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterModule, RouterOutlet } from '@angular/router';
import { Footer } from './shared/footer/footer';
import { Navbar } from './shared/navbar/navbar';
import { CommonModule } from '@angular/common';
import { AuthService } from './core/auth.service';
import { ProfileService } from './core/profile.service';

@Component({
  selector: 'app-root',
  // imports: [RouterOutlet, Footer, Navbar],
  imports: [CommonModule, RouterOutlet, RouterModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected readonly title = signal('premier-league-predictor');

  protected authService = inject(AuthService);
  protected profileService = inject(ProfileService);
  private router = inject(Router);

  isProfileMenuOpen = false;
  isMobileMenuOpen = false;

  ngOnInit(): void {
    // Update last active time when app loads
    if (this.authService.isAuthenticated()) {
      this.profileService.updateLastActive();
    }

    // Set up periodic activity updates (every 5 minutes)
    setInterval(() => {
      if (this.authService.isAuthenticated()) {
        this.profileService.updateLastActive();
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  toggleProfileMenu(): void {
    this.isProfileMenuOpen = !this.isProfileMenuOpen;
    if (this.isProfileMenuOpen) {
      this.isMobileMenuOpen = false;
    }
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
    if (this.isMobileMenuOpen) {
      this.isProfileMenuOpen = false;
    }
  }
  closeProfileMenu(): void {
    this.isProfileMenuOpen = false;
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
  }

  closeAllMenus(): void {
    this.isProfileMenuOpen = false;
    this.isMobileMenuOpen = false;
  }

  async signOut(): Promise<void> {
    this.closeAllMenus();
    await this.authService.signOut();
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
}
