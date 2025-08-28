import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ProfileService, UserPreferences } from '../../core/profile.service';

@Component({
  selector: 'app-user-profile',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './user-profile.html',
  styleUrl: './user-profile.css',
})
export class UserProfile {
  protected authService = inject(AuthService);
  protected profileService = inject(ProfileService);

  // Edit states
  isEditingName = signal(false);
  isEditingTeam = signal(false);
  editedName = '';
  selectedTeam = '';

  // Premier League teams
  premierLeagueTeams = [
    'Arsenal',
    'Aston Villa',
    'Brighton & Hove Albion',
    'Burnley',
    'Chelsea',
    'Crystal Palace',
    'Everton',
    'Fulham',
    'Liverpool',
    'Luton Town',
    'Manchester City',
    'Manchester United',
    'Newcastle United',
    'Nottingham Forest',
    'Sheffield United',
    'Tottenham Hotspur',
    'West Ham United',
    'Wolverhampton Wanderers',
    'Brentford',
    'Bournemouth',
  ];

  // Theme options
  themes: Array<{
    value: 'light' | 'dark' | 'system';
    label: string;
    icon: string;
  }> = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' },
    { value: 'system', label: 'System', icon: '💻' },
  ];

  // Name editing methods
  startEditingName(): void {
    this.editedName = this.profileService.userProfile()?.displayName || '';
    this.isEditingName.set(true);
  }

  async saveDisplayName(): Promise<void> {
    if (this.editedName.trim()) {
      await this.profileService.updateDisplayName(this.editedName.trim());
      this.isEditingName.set(false);
    }
  }

  cancelEdit(): void {
    this.isEditingName.set(false);
    this.editedName = '';
  }

  // Team editing methods
  startEditingTeam(): void {
    this.selectedTeam =
      this.profileService.userProfile()?.stats?.favoriteTeam || '';
    this.isEditingTeam.set(true);
  }

  async saveFavoriteTeam(): Promise<void> {
    if (this.selectedTeam) {
      await this.profileService.setFavoriteTeam(this.selectedTeam);
      this.isEditingTeam.set(false);
    }
  }

  cancelTeamEdit(): void {
    this.isEditingTeam.set(false);
    this.selectedTeam = '';
  }

  // Theme methods
  async updateTheme(theme: 'light' | 'dark' | 'system'): Promise<void> {
    await this.profileService.updatePreferences({ theme });
  }

  getThemeButtonClass(theme: string): string {
    const isActive =
      this.profileService.userProfile()?.preferences.theme === theme;
    return isActive
      ? 'bg-blue-600/30 border-blue-500/50 text-blue-200'
      : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20';
  }

  // Notification methods
  async toggleNotification(
    type: 'matchReminders' | 'results' | 'leaderboard'
  ): Promise<void> {
    const currentPrefs = this.profileService.userProfile()?.preferences;
    if (!currentPrefs) return;

    const newNotifications = {
      ...currentPrefs.notifications,
      [type]: !currentPrefs.notifications[type],
    };

    await this.profileService.updatePreferences({
      notifications: newNotifications,
    });
  }

  // Privacy methods
  async togglePrivacy(type: 'showStats' | 'showOnLeaderboard'): Promise<void> {
    const currentPrefs = this.profileService.userProfile()?.preferences;
    if (!currentPrefs) return;

    const newPrivacy = {
      ...currentPrefs.privacy,
      [type]: !currentPrefs.privacy[type],
    };

    await this.profileService.updatePreferences({
      privacy: newPrivacy,
    });
  }

  // Toggle styling methods
  getToggleClass(isEnabled: boolean | undefined): string {
    return isEnabled ? 'bg-blue-600' : 'bg-gray-600';
  }

  getToggleSpanClass(isEnabled: boolean | undefined): string {
    return isEnabled ? 'translate-x-5' : 'translate-x-0';
  }

  // Utility methods
  getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  formatDate(timestamp: any): string {
    if (!timestamp) return 'Unknown';

    // Handle Firestore timestamp
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
    });
  }
}
