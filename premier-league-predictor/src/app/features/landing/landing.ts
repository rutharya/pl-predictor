import {
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  PLATFORM_ID,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  Firestore,
  collection,
  query,
  orderBy,
  limit,
  where,
  getDocs,
} from '@angular/fire/firestore';
import { interval, takeUntil, Subject } from 'rxjs';

interface UpcomingFixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  kickoffTime: Date;
  gameweek: number;
  status: 'upcoming';
}

interface LeaderboardEntry {
  displayName: string;
  photoURL?: string;
  totalPoints: number;
  position: number;
  accuracyRate: number;
}

@Component({
  selector: 'app-landing',
  imports: [CommonModule, RouterModule],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class Landing implements OnInit, OnDestroy {
  private firestore = inject(Firestore);
  private platformId = inject(PLATFORM_ID);
  private destroy$ = new Subject<void>();

  // Signals for reactive data
  upcomingFixtures = signal<UpcomingFixture[]>([]);
  topPlayers = signal<LeaderboardEntry[]>([]);
  isFixturesLoading = signal(true);
  isLeaderboardLoading = signal(true);
  currentGameweek = signal<number | null>(null);
  totalPlayers = signal<number | null>(null);

  ngOnInit(): void {
    this.loadUpcomingFixtures();
    this.loadTopPlayers();
    this.loadGameStats();
    this.setupPeriodicUpdates();
    this.initScrollAnimations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async loadUpcomingFixtures(): Promise<void> {
    try {
      const fixturesRef = collection(this.firestore, 'fixtures');
      const now = new Date();

      const upcomingQuery = query(
        fixturesRef,
        where('status', '==', 'upcoming'),
        where('kickoffTime', '>', now),
        orderBy('kickoffTime'),
        limit(3)
      );

      const snapshot = await getDocs(upcomingQuery);
      const fixtures = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          kickoffTime: data['kickoffTime'].toDate(),
        } as UpcomingFixture;
      });

      this.upcomingFixtures.set(fixtures);
    } catch (error) {
      console.error('Error loading upcoming fixtures:', error);
      // Set mock data for development
      this.setMockFixtures();
    } finally {
      this.isFixturesLoading.set(false);
    }
  }

  private setMockFixtures(): void {
    const mockFixtures: UpcomingFixture[] = [
      {
        id: '1',
        homeTeam: 'Manchester City',
        awayTeam: 'Arsenal',
        kickoffTime: new Date(Date.now() + 86400000 * 2), // 2 days from now
        gameweek: 18,
        status: 'upcoming',
      },
      {
        id: '2',
        homeTeam: 'Liverpool',
        awayTeam: 'Chelsea',
        kickoffTime: new Date(Date.now() + 86400000 * 3), // 3 days from now
        gameweek: 18,
        status: 'upcoming',
      },
      {
        id: '3',
        homeTeam: 'Manchester United',
        awayTeam: 'Tottenham',
        kickoffTime: new Date(Date.now() + 86400000 * 4), // 4 days from now
        gameweek: 18,
        status: 'upcoming',
      },
    ];
    this.upcomingFixtures.set(mockFixtures);
  }

  private async loadTopPlayers(): Promise<void> {
    try {
      const usersRef = collection(this.firestore, 'users');
      const topPlayersQuery = query(
        usersRef,
        where('preferences.privacy.showOnLeaderboard', '==', true),
        orderBy('stats.totalPoints', 'desc'),
        limit(5)
      );

      const snapshot = await getDocs(topPlayersQuery);
      const players = snapshot.docs.map((doc, index) => {
        const data = doc.data();
        return {
          displayName: data['displayName'] || 'Anonymous',
          photoURL: data['photoURL'],
          totalPoints: data['stats']?.totalPoints || 0,
          accuracyRate: Math.round(data['stats']?.accuracyRate || 0),
          position: index + 1,
        } as LeaderboardEntry;
      });

      this.topPlayers.set(players);
      this.totalPlayers.set(snapshot.size);

      // inflate the numbers
      // this.totalPlayers.set(
      //   snapshot.size > 0 ? Math.max(1000, snapshot.size * 20) : 1247
      // );
    } catch (error) {
      console.error('Error loading top players:', error);
      // Set mock data for development
      this.setMockLeaderboard();
    } finally {
      this.isLeaderboardLoading.set(false);
    }
  }

  private setMockLeaderboard(): void {
    const mockPlayers: LeaderboardEntry[] = [
      {
        displayName: 'John Smith',
        totalPoints: 278,
        accuracyRate: 68,
        position: 1,
      },
      {
        displayName: 'Sarah Wilson',
        totalPoints: 265,
        accuracyRate: 64,
        position: 2,
      },
      {
        displayName: 'Mike Johnson',
        totalPoints: 251,
        accuracyRate: 62,
        position: 3,
      },
      {
        displayName: 'Emma Brown',
        totalPoints: 243,
        accuracyRate: 61,
        position: 4,
      },
      {
        displayName: 'David Lee',
        totalPoints: 238,
        accuracyRate: 59,
        position: 5,
      },
    ];
    this.topPlayers.set(mockPlayers);
    this.totalPlayers.set(1247);
  }

  private async loadGameStats(): Promise<void> {
    try {
      // Try to get current gameweek from system config
      const systemRef = collection(this.firestore, 'system');
      const systemQuery = query(systemRef, limit(1));
      const systemSnapshot = await getDocs(systemQuery);

      if (!systemSnapshot.empty) {
        const systemData = systemSnapshot.docs[0].data();
        this.currentGameweek.set(systemData['currentGameweek'] || 18);
      } else {
        // Fallback: calculate based on season start
        this.currentGameweek.set(this.calculateCurrentGameweek());
      }
    } catch (error) {
      console.error('Error loading game stats:', error);
      this.currentGameweek.set(18); // Fallback
    }
  }

  private calculateCurrentGameweek(): number {
    const seasonStart = new Date('2025-08-17');
    const now = new Date();
    const weeksDiff = Math.floor(
      (now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    return Math.max(1, Math.min(38, weeksDiff + 1));
  }

  private setupPeriodicUpdates(): void {
    // Update data every 2 hours
    interval(2 * 60 * 60 * 1000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadUpcomingFixtures();
        this.loadTopPlayers();
      });
  }

  private initScrollAnimations(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Intersection Observer for scroll animations
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px',
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
        }
      });
    }, observerOptions);

    // Observe elements after a short delay to ensure DOM is ready
    setTimeout(() => {
      const elementsToAnimate = document.querySelectorAll('.animate-on-scroll');
      elementsToAnimate.forEach((el) => observer.observe(el));
    }, 100);
  }

  // UI Helper Methods
  formatMatchDate(date: Date): string {
    return date.toLocaleDateString('en-GB', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  formatMatchTime(date: Date): string {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
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

  getPositionBadgeClass(position: number): string {
    switch (position) {
      case 1:
        return 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-yellow-900 shadow-lg';
      case 2:
        return 'bg-gradient-to-r from-gray-300 to-gray-500 text-gray-900 shadow-lg';
      case 3:
        return 'bg-gradient-to-r from-orange-400 to-orange-600 text-orange-900 shadow-lg';
      default:
        return 'bg-white/20 text-white border border-white/30';
    }
  }

  // Scroll to section method
  scrollToSection(sectionId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // Track by functions for performance
  trackByFixtureId(index: number, fixture: UpcomingFixture): string {
    return fixture.id;
  }

  trackByPlayerPosition(index: number, player: LeaderboardEntry): number {
    return player.position;
  }
}
