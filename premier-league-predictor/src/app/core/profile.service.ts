import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp,
  DocumentSnapshot,
  onSnapshot,
  Unsubscribe,
} from '@angular/fire/firestore';
import { AuthService, AuthUser } from './auth.service';
import { Observable, from, BehaviorSubject } from 'rxjs';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: any;
  lastActiveAt: any;
  stats: UserStats;
  preferences: UserPreferences;
}

export interface UserStats {
  totalPoints: number;
  predictionsMade: number;
  correctPredictions: number;
  exactPredictions: number;
  wrongPredictions: number;
  accuracyRate: number;
  currentStreak: number;
  longestStreak: number;
  favoriteTeam?: string;
  processedPredictionsCount: number;
  perfectWeeks: number;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  notifications: {
    matchReminders: boolean;
    results: boolean;
    leaderboard: boolean;
  };
  privacy: {
    showStats: boolean;
    showOnLeaderboard: boolean;
  };
}

@Injectable({
  providedIn: 'root',
})
export class ProfileService {
  private firestore = inject(Firestore);
  private authService = inject(AuthService);

  // Signals for reactive state management
  userProfile = signal<UserProfile | null>(null);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  // Computed values
  // accuracyPercentage = computed(() => {
  //   const profile = this.userProfile();
  //   if (!profile || profile.stats.predictionsMade === 0) return 0;
  //   return Math.round(
  //     ((profile.stats.correctPredictions + profile.stats.exactPredictions) /
  //       profile.stats.predictionsMade) *
  //       100
  //   );
  // });

  private profileUnsubscribe: Unsubscribe | null = null;

  constructor() {
    // Listen for auth state changes
    this.authService.user$.subscribe((user) => {
      if (user) {
        this.loadUserProfile(user.uid);
      } else {
        this.clearProfile();
      }
    });
  }

  private loadUserProfile(uid: string): void {
    this.isLoading.set(true);

    // Unsubscribe from previous listener
    if (this.profileUnsubscribe) {
      this.profileUnsubscribe();
    }

    const userDocRef = doc(this.firestore, 'users', uid);

    // Set up real-time listener
    this.profileUnsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data() as UserProfile;
          this.userProfile.set(data);
        } else {
          // Create new profile if it doesn't exist
          this.createUserProfile();
        }
        this.isLoading.set(false);
        this.error.set(null);
      },
      (error) => {
        console.error('Profile loading error:', error);
        this.error.set('Failed to load user profile');
        this.isLoading.set(false);
      }
    );
  }

  private async createUserProfile(): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    const defaultProfile: UserProfile = {
      uid: currentUser.uid,
      email: currentUser.email || '',
      displayName: currentUser.displayName || 'Anonymous',
      photoURL: currentUser.photoURL || undefined,
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
      stats: {
        totalPoints: 0,
        predictionsMade: 0,
        correctPredictions: 0,
        exactPredictions: 0,
        wrongPredictions: 0,
        accuracyRate: 0,
        currentStreak: 0,
        longestStreak: 0,
        processedPredictionsCount: 0,
        perfectWeeks: 0,
      },
      preferences: {
        theme: 'system',
        notifications: {
          matchReminders: true,
          results: true,
          leaderboard: true,
        },
        privacy: {
          showStats: true,
          showOnLeaderboard: true,
        },
      },
    };

    try {
      const userDocRef = doc(this.firestore, 'users', currentUser.uid);
      await setDoc(userDocRef, defaultProfile);
    } catch (error) {
      console.error('Error creating profile:', error);
      this.error.set('Failed to create user profile');
    }
  }

  async updateDisplayName(newDisplayName: string): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    try {
      this.isLoading.set(true);
      const userDocRef = doc(this.firestore, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        displayName: newDisplayName,
        lastActiveAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating display name:', error);
      this.error.set('Failed to update display name');
    } finally {
      this.isLoading.set(false);
    }
  }

  async updatePreferences(
    preferences: Partial<UserPreferences>
  ): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    try {
      this.isLoading.set(true);
      const userDocRef = doc(this.firestore, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        preferences: { ...this.userProfile()?.preferences, ...preferences },
        lastActiveAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating preferences:', error);
      this.error.set('Failed to update preferences');
    } finally {
      this.isLoading.set(false);
    }
  }

  async updateLastActive(): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    try {
      const userDocRef = doc(this.firestore, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        lastActiveAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating last active:', error);
      // Don't show error to user for this background operation
    }
  }

  async addPrediction(isCorrect: boolean, points: number = 0): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    try {
      const userDocRef = doc(this.firestore, 'users', currentUser.uid);
      const currentProfile = this.userProfile();

      if (!currentProfile) return;

      const newStreak = isCorrect ? currentProfile.stats.currentStreak + 1 : 0;
      const newLongestStreak = Math.max(
        newStreak,
        currentProfile.stats.longestStreak
      );
      const newCorrectPredictions = isCorrect
        ? currentProfile.stats.correctPredictions + 1
        : currentProfile.stats.correctPredictions;
      const newTotalPredictions = currentProfile.stats.predictionsMade + 1;
      const newAccuracyRate =
        newTotalPredictions > 0
          ? (newCorrectPredictions / newTotalPredictions) * 100
          : 0;

      await updateDoc(userDocRef, {
        'stats.totalPoints': increment(points),
        'stats.predictionsMade': increment(1),
        'stats.correctPredictions': isCorrect
          ? increment(1)
          : currentProfile.stats.correctPredictions,
        'stats.accuracyRate': newAccuracyRate,
        'stats.currentStreak': newStreak,
        'stats.longestStreak': newLongestStreak,
        lastActiveAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating prediction stats:', error);
      this.error.set('Failed to update prediction stats');
    }
  }

  async incrementMatchCount(): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    try {
      const userDocRef = doc(this.firestore, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        'stats.totalMatches': increment(1),
        lastActiveAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error incrementing match count:', error);
    }
  }

  async addPerfectWeek(): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    try {
      const userDocRef = doc(this.firestore, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        'stats.perfectWeeks': increment(1),
        'stats.totalPoints': increment(50), // Bonus points for perfect week
        lastActiveAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error adding perfect week:', error);
    }
  }

  async setFavoriteTeam(teamName: string): Promise<void> {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return;

    try {
      this.isLoading.set(true);
      const userDocRef = doc(this.firestore, 'users', currentUser.uid);
      await updateDoc(userDocRef, {
        'stats.favoriteTeam': teamName,
        lastActiveAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error setting favorite team:', error);
      this.error.set('Failed to set favorite team');
    } finally {
      this.isLoading.set(false);
    }
  }

  // Utility methods
  getUserStats(): UserStats | null {
    return this.userProfile()?.stats || null;
  }

  getUserPreferences(): UserPreferences | null {
    return this.userProfile()?.preferences || null;
  }

  clearError(): void {
    this.error.set(null);
  }

  private clearProfile(): void {
    if (this.profileUnsubscribe) {
      this.profileUnsubscribe();
      this.profileUnsubscribe = null;
    }
    this.userProfile.set(null);
    this.isLoading.set(false);
    this.error.set(null);
  }

  ngOnDestroy(): void {
    this.clearProfile();
  }
}
