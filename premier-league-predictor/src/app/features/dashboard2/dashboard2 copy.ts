import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ProfileService } from '../../core/profile.service';
import {
  Firestore,
  collection,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  Timestamp,
} from '@angular/fire/firestore';
import { interval, takeUntil, Subject } from 'rxjs';

export interface Fixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  kickoffTime: Date;
  gameweek: number;
  status: 'upcoming' | 'live' | 'finished';
  homeScore?: number;
  awayScore?: number;
  predictionDeadline: Date;
}

export interface UserPrediction {
  id: string;
  fixtureId: string;
  homeScore: number;
  awayScore: number;
  pointsEarned: number;
  isCorrect: boolean;
  createdAt: Date;
  fixture?: Fixture;
}

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  photoURL?: string;
  totalPoints: number;
  position: number;
}
@Component({
  selector: 'app-dashboard2',
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard2.html',
  styleUrl: './dashboard2.css',
})
export class Dashboard2 {
  isPredictionCorrect(_t142: UserPrediction) {
    throw new Error('Method not implemented.');
  }
  private firestore = inject(Firestore);
  protected authService = inject(AuthService);
  protected profileService = inject(ProfileService);
  private destroy$ = new Subject<void>();

  // Signals
  upcomingFixtures = signal<Fixture[]>([]);
  recentPredictions = signal<UserPrediction[]>([]);
  topLeaderboard = signal<LeaderboardEntry[]>([]);
  currentGameweek = signal<number>(1);
  userRank = signal<number | null>(null);

  // Loading states
  isFixturesLoading = signal(true);
  isPredictionsLoading = signal(true);
  isLeaderboardLoading = signal(true);
  isStatsLoading = signal(true);

  // Computed properties
  upcomingDeadlines = computed(() => {
    return this.upcomingFixtures()
      .filter((fixture) => fixture.status === 'upcoming')
      .filter((fixture) =>
        this.isDeadlineApproaching(fixture.predictionDeadline)
      )
      .slice(0, 3);
  });

  ngOnInit(): void {
    this.loadDashboardData();
    this.startPeriodicUpdates();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadDashboardData(): Promise<void> {
    await Promise.all([
      this.loadCurrentGameweek(),
      this.loadUpcomingFixtures(),
      this.loadRecentPredictions(),
      this.loadTopLeaderboard(),
      this.loadUserRank(),
    ]);
    this.isStatsLoading.set(false);
  }

  private async loadCurrentGameweek(): Promise<void> {
    try {
      // This would typically come from your API or Firestore
      // For now, calculate based on current date
      const seasonStart = new Date('2025-08-17'); // Adjust for current season
      const now = new Date();
      const weeksDiff = Math.floor(
        (now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      this.currentGameweek.set(Math.max(1, Math.min(38, weeksDiff + 1)));
    } catch (error) {
      console.error('Error loading current gameweek:', error);
      this.currentGameweek.set(1);
    }
  }

  private async loadUpcomingFixtures(): Promise<void> {
    try {
      const fixturesRef = collection(this.firestore, 'fixtures');
      const upcomingQuery = query(
        fixturesRef,
        where('gameweek', '==', this.currentGameweek()),
        where('status', 'in', ['upcoming', 'live']),
        orderBy('kickoffTime'),
        limit(5)
      );

      const snapshot = await getDocs(upcomingQuery);
      const fixtures = snapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
            kickoffTime: doc.data()['kickoffTime'].toDate(),
            predictionDeadline: doc.data()['predictionDeadline'].toDate(),
          } as Fixture)
      );

      this.upcomingFixtures.set(fixtures);
    } catch (error) {
      console.error('Error loading fixtures:', error);
      // Mock data for development
      this.upcomingFixtures.set([
        {
          id: '1',
          homeTeam: 'Manchester City',
          awayTeam: 'Arsenal',
          kickoffTime: new Date(Date.now() + 86400000), // Tomorrow
          gameweek: this.currentGameweek(),
          status: 'upcoming',
          predictionDeadline: new Date(Date.now() + 82800000), // 1 hour before
        },
        {
          id: '2',
          homeTeam: 'Liverpool',
          awayTeam: 'Chelsea',
          kickoffTime: new Date(Date.now() + 172800000), // Day after tomorrow
          gameweek: this.currentGameweek(),
          status: 'upcoming',
          predictionDeadline: new Date(Date.now() + 169200000),
        },
      ]);
    } finally {
      this.isFixturesLoading.set(false);
    }
  }

  private async loadRecentPredictions(): Promise<void> {
    const userId = this.authService.getCurrentUserId();
    if (!userId) {
      this.isPredictionsLoading.set(false);
      return;
    }

    try {
      const predictionsRef = collection(this.firestore, 'predictions');
      const recentQuery = query(
        predictionsRef,
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(5)
      );

      const snapshot = await getDocs(recentQuery);
      const predictions = snapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data()['createdAt'].toDate(),
          } as UserPrediction)
      );

      this.recentPredictions.set(predictions);
    } catch (error) {
      console.error('Error loading predictions:', error);
      // Mock data for development
      this.recentPredictions.set([
        {
          id: '1',
          fixtureId: '1',
          homeScore: 2,
          awayScore: 1,
          pointsEarned: 5,
          isCorrect: true,
          createdAt: new Date(Date.now() - 86400000),
          fixture: {
            id: '1',
            homeTeam: 'Manchester United',
            awayTeam: 'Tottenham',
            kickoffTime: new Date(),
            gameweek: this.currentGameweek() - 1,
            status: 'finished',
            predictionDeadline: new Date(),
          },
        },
      ]);
    } finally {
      this.isPredictionsLoading.set(false);
    }
  }

  private async loadTopLeaderboard(): Promise<void> {
    try {
      const usersRef = collection(this.firestore, 'users');
      const leaderboardQuery = query(
        usersRef,
        where('preferences.privacy.showOnLeaderboard', '==', true),
        orderBy('stats.totalPoints', 'desc'),
        limit(5)
      );

      const snapshot = await getDocs(leaderboardQuery);
      const leaderboard = snapshot.docs.map(
        (doc, index) =>
          ({
            uid: doc.id,
            displayName: doc.data()['displayName'],
            photoURL: doc.data()['photoURL'],
            totalPoints: doc.data()['stats']?.totalPoints || 0,
            position: index + 1,
          } as LeaderboardEntry)
      );

      this.topLeaderboard.set(leaderboard);
    } catch (error) {
      console.error('Error loading leaderboard:', error);
      // Mock data for development
      this.topLeaderboard.set([
        { uid: '1', displayName: 'John Smith', totalPoints: 245, position: 1 },
        {
          uid: '2',
          displayName: 'Sarah Wilson',
          totalPoints: 238,
          position: 2,
        },
        {
          uid: '3',
          displayName: 'Mike Johnson',
          totalPoints: 231,
          position: 3,
        },
        { uid: '4', displayName: 'Emma Brown', totalPoints: 224, position: 4 },
        { uid: '5', displayName: 'David Lee', totalPoints: 218, position: 5 },
      ]);
    } finally {
      this.isLeaderboardLoading.set(false);
    }
  }

  private async loadUserRank(): Promise<void> {
    const userId = this.authService.getCurrentUserId();
    if (!userId) return;

    try {
      const userPoints =
        this.profileService.userProfile()?.stats.totalPoints || 0;
      const usersRef = collection(this.firestore, 'users');
      const higherRankedQuery = query(
        usersRef,
        where('stats.totalPoints', '>', userPoints),
        where('preferences.privacy.showOnLeaderboard', '==', true)
      );

      const snapshot = await getDocs(higherRankedQuery);
      this.userRank.set(snapshot.docs.length + 1);
    } catch (error) {
      console.error('Error loading user rank:', error);
      this.userRank.set(null);
    }
  }

  private startPeriodicUpdates(): void {
    // Update every minute for live scores and countdown timers
    interval(60000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // Update any live fixtures or countdown timers
        this.updateLiveData();
      });
  }

  private updateLiveData(): void {
    // Update countdown timers and check for live fixtures
    // This would typically sync with your live data source
  }

  // UI Helper Methods
  getGameweekProgress(): string {
    const fixtures = this.upcomingFixtures();
    const totalFixtures = 10; // Typical gameweek has 10 fixtures
    const played = totalFixtures - fixtures.length;
    return `${played}/${totalFixtures} matches played`;
  }

  formatKickoffTime(kickoffTime: Date): string {
    return kickoffTime.toLocaleDateString('en-GB', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatPredictionDate(date: Date): string {
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60)
    );

    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 48) return 'Yesterday';
    return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  getTimeUntilDeadline(deadline: Date): string {
    const now = new Date();
    const diff = deadline.getTime() - now.getTime();

    if (diff <= 0) return 'Closed';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  getDeadlineClass(deadline: Date): string {
    const now = new Date();
    const diff = deadline.getTime() - now.getTime();
    const hoursLeft = diff / (1000 * 60 * 60);

    if (hoursLeft <= 0) return 'text-red-400 font-semibold';
    if (hoursLeft <= 2) return 'text-orange-400 font-semibold';
    if (hoursLeft <= 24) return 'text-yellow-400';
    return 'text-white/60';
  }

  isDeadlineApproaching(deadline: Date): boolean {
    const now = new Date();
    const diff = deadline.getTime() - now.getTime();
    const hoursLeft = diff / (1000 * 60 * 60);
    return hoursLeft > 0 && hoursLeft <= 24;
  }

  getPredictionResultClass(prediction: UserPrediction): string {
    return prediction.isCorrect
      ? 'bg-green-500 text-green-100'
      : 'bg-red-500 text-red-100';
  }

  getPointsClass(points: number): string {
    if (points >= 5) return 'text-green-400';
    if (points >= 3) return 'text-yellow-400';
    if (points > 0) return 'text-blue-400';
    return 'text-white/60';
  }

  getRankBadgeClass(position: number): string {
    if (position === 1)
      return 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-yellow-900';
    if (position === 2)
      return 'bg-gradient-to-r from-gray-300 to-gray-500 text-gray-900';
    if (position === 3)
      return 'bg-gradient-to-r from-orange-400 to-orange-600 text-orange-900';
    if (position <= 5)
      return 'bg-gradient-to-r from-green-400 to-green-600 text-green-900';
    return 'bg-blue-500 text-white';
  }

  getTeamInitials(teamName: string): string {
    return teamName
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 3);
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
