import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  orderBy,
  where,
  getDocs,
  doc,
  limit,
  onSnapshot,
  Unsubscribe,
} from '@angular/fire/firestore';
import { Observable, from, BehaviorSubject } from 'rxjs';

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
  matchDay: string;
}

export interface GroupedFixtures {
  [matchDay: string]: Fixture[];
}

@Injectable({
  providedIn: 'root',
})
export class FixturesService {
  private firestore = inject(Firestore);

  // Cache for fixtures
  private fixturesCache = new Map<number, Fixture[]>();
  private liveFixturesSubscription: Unsubscribe | null = null;

  constructor() {}

  /**
   * Load fixtures for a specific gameweek
   */
  async loadFixturesByGameweek(gameweek: number): Promise<Fixture[]> {
    try {
      // Check cache first
      if (this.fixturesCache.has(gameweek)) {
        return this.fixturesCache.get(gameweek)!;
      }

      const fixturesRef = collection(this.firestore, 'fixtures');
      const fixturesQuery = query(
        fixturesRef,
        where('gameweek', '==', gameweek),
        orderBy('kickoffTime')
      );

      const snapshot = await getDocs(fixturesQuery);
      const fixtures = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          kickoffTime: data['kickoffTime'].toDate(),
          predictionDeadline: data['predictionDeadline'].toDate(),
          matchDay: this.formatMatchDay(data['kickoffTime'].toDate()),
        } as Fixture;
      });

      // Cache the results
      this.fixturesCache.set(gameweek, fixtures);
      return fixtures;
    } catch (error) {
      console.error('Error loading fixtures:', error);
      throw error;
    }
  }

  /**
   * Load upcoming fixtures (next 3-5 matches)
   */
  async loadUpcomingFixtures(lim: number = 5): Promise<Fixture[]> {
    try {
      const fixturesRef = collection(this.firestore, 'fixtures');
      const now = new Date();

      const upcomingQuery = query(
        fixturesRef,
        where('status', '==', 'upcoming'),
        where('kickoffTime', '>', now),
        orderBy('kickoffTime'),
        limit(lim)
      );

      const snapshot = await getDocs(upcomingQuery);
      const fixtures = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          kickoffTime: data['kickoffTime'].toDate(),
          predictionDeadline: data['predictionDeadline'].toDate(),
          matchDay: this.formatMatchDay(data['kickoffTime'].toDate()),
        } as Fixture;
      });

      return fixtures;
    } catch (error) {
      console.error('Error loading upcoming fixtures:', error);
      throw error;
    }
  }

  /**
   * Get live fixtures with real-time updates
   */
  subscribeLiveFixtures(callback: (fixtures: Fixture[]) => void): Unsubscribe {
    const fixturesRef = collection(this.firestore, 'fixtures');
    const liveQuery = query(
      fixturesRef,
      where('status', '==', 'live'),
      orderBy('kickoffTime')
    );

    return onSnapshot(
      liveQuery,
      (snapshot) => {
        const liveFixtures = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            kickoffTime: data['kickoffTime'].toDate(),
            predictionDeadline: data['predictionDeadline'].toDate(),
            matchDay: this.formatMatchDay(data['kickoffTime'].toDate()),
          } as Fixture;
        });

        callback(liveFixtures);
      },
      (error) => {
        console.error('Error in live fixtures subscription:', error);
      }
    );
  }

  /**
   * Get fixture by ID
   */
  async getFixtureById(fixtureId: string): Promise<Fixture | null> {
    try {
      const fixtureRef = doc(this.firestore, 'fixtures', fixtureId);
      const fixtureDoc = await getDocs(
        query(
          collection(this.firestore, 'fixtures'),
          where('__name__', '==', fixtureId)
        )
      );

      if (!fixtureDoc.empty) {
        const data = fixtureDoc.docs[0].data();
        return {
          id: fixtureDoc.docs[0].id,
          ...data,
          kickoffTime: data['kickoffTime'].toDate(),
          predictionDeadline: data['predictionDeadline'].toDate(),
          matchDay: this.formatMatchDay(data['kickoffTime'].toDate()),
        } as Fixture;
      }

      return null;
    } catch (error) {
      console.error('Error getting fixture by ID:', error);
      return null;
    }
  }

  /**
   * Group fixtures by match day
   */
  groupFixturesByMatchDay(fixtures: Fixture[]): GroupedFixtures {
    const grouped: GroupedFixtures = {};

    fixtures.forEach((fixture) => {
      if (!grouped[fixture.matchDay]) {
        grouped[fixture.matchDay] = [];
      }
      grouped[fixture.matchDay].push(fixture);
    });

    return grouped;
  }

  /**
   * Check if prediction deadline has passed
   */
  isPredictionLocked(fixture: Fixture): boolean {
    return new Date() >= fixture.predictionDeadline;
  }

  /**
   * Get time until prediction deadline
   */
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

  /**
   * Format match day for display
   */
  formatMatchDay(date: Date): string {
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  /**
   * Clear cache (useful for refreshing data)
   */
  clearCache(): void {
    this.fixturesCache.clear();
  }

  /**
   * Cleanup subscriptions
   */
  cleanup(): void {
    if (this.liveFixturesSubscription) {
      this.liveFixturesSubscription();
      this.liveFixturesSubscription = null;
    }
  }
}
