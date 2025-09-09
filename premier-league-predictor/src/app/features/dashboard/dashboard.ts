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
import { FixturesService, Fixture } from '../../core/fixtures.service';
import {
  PredictionsService,
  UserPrediction,
} from '../../core/predictions.service';
import {
  LeaderboardService,
  LeaderboardEntry,
} from '../../core/leaderboard.service';
import { interval, takeUntil, Subject } from 'rxjs';

// Extended interface for dashboard use
interface PredictionWithFixture extends UserPrediction {
  fixture?: Fixture;
}

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard2 implements OnInit, OnDestroy {
  protected authService = inject(AuthService);
  protected profileService = inject(ProfileService);
  private fixturesService = inject(FixturesService);
  private predictionsService = inject(PredictionsService);
  private leaderboardService = inject(LeaderboardService);
  private destroy$ = new Subject<void>();

  // Signals
  upcomingFixtures = signal<Fixture[]>([]);
  recentPredictions = signal<PredictionWithFixture[]>([]);
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
      const weeksDiff = Math.round(
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
      // Use the FixturesService instead of direct Firestore calls
      const fixtures = await this.fixturesService.loadUpcomingFixtures(5);
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
          matchDay: this.fixturesService.formatMatchDay(
            new Date(Date.now() + 86400000)
          ),
        },
        {
          id: '2',
          homeTeam: 'Liverpool',
          awayTeam: 'Chelsea',
          kickoffTime: new Date(Date.now() + 172800000), // Day after tomorrow
          gameweek: this.currentGameweek(),
          status: 'upcoming',
          predictionDeadline: new Date(Date.now() + 169200000),
          matchDay: this.fixturesService.formatMatchDay(
            new Date(Date.now() + 172800000)
          ),
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
      // Load basic predictions first
      const basicPredictions =
        await this.predictionsService.getRecentPredictions(userId, 5);

      // Load fixture data for each prediction
      const predictionsWithFixtures: PredictionWithFixture[] =
        await Promise.all(
          basicPredictions.map(async (prediction) => {
            try {
              const fixture = await this.fixturesService.getFixtureById(
                prediction.fixtureId
              );
              return { ...prediction, fixture: fixture || undefined };
            } catch (error) {
              console.error(
                `Error loading fixture ${prediction.fixtureId}:`,
                error
              );
              return { ...prediction };
            }
          })
        );

      this.recentPredictions.set(predictionsWithFixtures);
    } catch (error) {
      console.error('Error loading predictions:', error);
      // Mock data for development
      this.recentPredictions.set([
        {
          id: '1',
          fixtureId: '1',
          userId: userId!,
          homeScore: 2,
          awayScore: 1,
          pointsEarned: 5,
          createdAt: new Date(Date.now() - 86400000),
          updatedAt: new Date(Date.now() - 86400000),
          isSubmitted: true,
          gameweek: this.currentGameweek() - 1,
          fixture: {
            id: '1',
            homeTeam: 'Manchester United',
            awayTeam: 'Tottenham',
            kickoffTime: new Date(Date.now() - 86400000),
            gameweek: this.currentGameweek() - 1,
            status: 'finished',
            predictionDeadline: new Date(Date.now() - 90000000),
            matchDay: 'Saturday, August 16',
          },
        },
      ]);
    } finally {
      this.isPredictionsLoading.set(false);
    }
  }

  private async loadTopLeaderboard(): Promise<void> {
    try {
      // Use the LeaderboardService instead of direct Firestore calls
      const leaderboard = await this.leaderboardService.getTopLeaderboard(5);
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
      // Use the LeaderboardService instead of direct Firestore calls
      const rank = await this.leaderboardService.getUserRank(userId);
      this.userRank.set(rank);
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
  public isPredictionCorrect(prediction: PredictionWithFixture): boolean {
    return (prediction.pointsEarned || 0) > 0;
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
    // Use the FixturesService method for consistency
    return this.fixturesService.getTimeUntilDeadline(deadline);
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

  getPredictionResultClass(prediction: PredictionWithFixture): string {
    const isCorrect = this.isPredictionCorrect(prediction);
    return isCorrect
      ? 'bg-green-500 text-green-100'
      : 'bg-red-500 text-red-100';
  }

  getPointsClass(points: number | undefined): string {
    const pointsValue = points || 0;
    if (pointsValue >= 5) return 'text-green-400';
    if (pointsValue >= 3) return 'text-yellow-400';
    if (pointsValue > 0) return 'text-blue-400';
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
