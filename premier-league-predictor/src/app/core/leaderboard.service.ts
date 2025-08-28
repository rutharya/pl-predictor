// core/leaderboard.service.ts
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  orderBy,
  where,
  getDocs,
  limit,
} from '@angular/fire/firestore';

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  photoURL?: string;
  totalPoints: number;
  position: number;
  weeklyPoints?: number;
  accuracy?: number;
}

export interface LeaderboardStats {
  totalUsers: number;
  averagePoints: number;
  topScore: number;
}

@Injectable({
  providedIn: 'root',
})
export class LeaderboardService {
  private firestore = inject(Firestore);

  // Cache for leaderboard data
  private leaderboardCache = new Map<string, LeaderboardEntry[]>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  constructor() {}

  /**
   * Get top leaderboard entries
   */
  async getTopLeaderboard(limitTo: number = 10): Promise<LeaderboardEntry[]> {
    try {
      const cacheKey = `top_${limitTo}`;

      // Check cache first
      if (this.isCacheValid(cacheKey)) {
        return this.leaderboardCache.get(cacheKey)!;
      }

      const usersRef = collection(this.firestore, 'users');
      const leaderboardQuery = query(
        usersRef,
        where('preferences.privacy.showOnLeaderboard', '==', true),
        orderBy('stats.totalPoints', 'desc'),
        limit(limitTo)
      );

      const snapshot = await getDocs(leaderboardQuery);
      const leaderboard = snapshot.docs.map(
        (doc, index) =>
          ({
            uid: doc.id,
            displayName: doc.data()['displayName'] || 'Anonymous',
            photoURL: doc.data()['photoURL'],
            totalPoints: doc.data()['stats']?.totalPoints || 0,
            position: index + 1,
            accuracy: doc.data()['stats']?.accuracyRate || 0,
            weeklyPoints: doc.data()['stats']?.weeklyPoints || 0,
          } as LeaderboardEntry)
      );

      // Cache the results
      this.leaderboardCache.set(cacheKey, leaderboard);
      this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_DURATION);

      return leaderboard;
    } catch (error) {
      console.error('Error loading leaderboard:', error);
      throw error;
    }
  }

  /**
   * Get user's rank position
   */
  async getUserRank(userId: string): Promise<number | null> {
    try {
      const userProfile = await this.getUserProfile(userId);
      if (!userProfile || userProfile.totalPoints === 0) {
        return null;
      }

      const usersRef = collection(this.firestore, 'users');
      const higherRankedQuery = query(
        usersRef,
        where('stats.totalPoints', '>', userProfile.totalPoints),
        where('preferences.privacy.showOnLeaderboard', '==', true)
      );

      const snapshot = await getDocs(higherRankedQuery);
      return snapshot.docs.length + 1;
    } catch (error) {
      console.error('Error loading user rank:', error);
      return null;
    }
  }

  /**
   * Get leaderboard around a specific user (context leaderboard)
   */
  async getLeaderboardAroundUser(
    userId: string,
    range: number = 5
  ): Promise<LeaderboardEntry[]> {
    try {
      const userRank = await this.getUserRank(userId);
      if (!userRank) return [];

      const startPosition = Math.max(1, userRank - range);
      const endPosition = userRank + range;

      // This is simplified - in a real implementation, you'd need pagination
      // or a more sophisticated query to get users around a specific rank
      const fullLeaderboard = await this.getTopLeaderboard(endPosition);

      return fullLeaderboard.slice(startPosition - 1, endPosition);
    } catch (error) {
      console.error('Error loading leaderboard around user:', error);
      return [];
    }
  }

  /**
   * Get weekly leaderboard
   */
  async getWeeklyLeaderboard(
    gameweek: number,
    limitTo: number = 10
  ): Promise<LeaderboardEntry[]> {
    try {
      const cacheKey = `weekly_${gameweek}_${limitTo}`;

      if (this.isCacheValid(cacheKey)) {
        return this.leaderboardCache.get(cacheKey)!;
      }

      const usersRef = collection(this.firestore, 'users');
      const weeklyQuery = query(
        usersRef,
        where('preferences.privacy.showOnLeaderboard', '==', true),
        where(`stats.gameweekStats.${gameweek}.points`, '>', 0),
        orderBy(`stats.gameweekStats.${gameweek}.points`, 'desc'),
        limit(limitTo)
      );

      const snapshot = await getDocs(weeklyQuery);
      const weeklyLeaderboard = snapshot.docs.map((doc, index) => {
        const gameweekStats = doc.data()['stats']?.gameweekStats?.[gameweek];
        return {
          uid: doc.id,
          displayName: doc.data()['displayName'] || 'Anonymous',
          photoURL: doc.data()['photoURL'],
          totalPoints: doc.data()['stats']?.totalPoints || 0,
          weeklyPoints: gameweekStats?.points || 0,
          position: index + 1,
          accuracy: gameweekStats?.accuracy || 0,
        } as LeaderboardEntry;
      });

      this.leaderboardCache.set(cacheKey, weeklyLeaderboard);
      this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_DURATION);

      return weeklyLeaderboard;
    } catch (error) {
      console.error('Error loading weekly leaderboard:', error);
      throw error;
    }
  }

  /**
   * Get leaderboard statistics
   */
  async getLeaderboardStats(): Promise<LeaderboardStats> {
    try {
      const usersRef = collection(this.firestore, 'users');
      const statsQuery = query(
        usersRef,
        where('preferences.privacy.showOnLeaderboard', '==', true),
        where('stats.totalPoints', '>', 0)
      );

      const snapshot = await getDocs(statsQuery);
      const users = snapshot.docs.map((doc) => doc.data());

      const totalUsers = users.length;
      const totalPoints = users.reduce(
        (sum, user) => sum + (user['stats']?.totalPoints || 0),
        0
      );
      const averagePoints =
        totalUsers > 0 ? Math.round(totalPoints / totalUsers) : 0;
      const topScore = users.reduce(
        (max, user) => Math.max(max, user['stats']?.totalPoints || 0),
        0
      );

      return {
        totalUsers,
        averagePoints,
        topScore,
      };
    } catch (error) {
      console.error('Error loading leaderboard stats:', error);
      throw error;
    }
  }

  /**
   * Get friends leaderboard (if you have a friends system)
   */
  async getFriendsLeaderboard(
    userId: string,
    friendIds: string[]
  ): Promise<LeaderboardEntry[]> {
    try {
      if (friendIds.length === 0) return [];

      const usersRef = collection(this.firestore, 'users');
      // Add the current user to the list
      const allUserIds = [...friendIds, userId];

      // Note: Firestore has a limit of 10 items for 'in' queries
      // For larger friend lists, you'd need to batch the requests
      const friendsQuery = query(
        usersRef,
        where('__name__', 'in', allUserIds.slice(0, 10)),
        orderBy('stats.totalPoints', 'desc')
      );

      const snapshot = await getDocs(friendsQuery);
      const friendsLeaderboard = snapshot.docs.map(
        (doc, index) =>
          ({
            uid: doc.id,
            displayName: doc.data()['displayName'] || 'Anonymous',
            photoURL: doc.data()['photoURL'],
            totalPoints: doc.data()['stats']?.totalPoints || 0,
            position: index + 1,
            accuracy: doc.data()['stats']?.accuracyRate || 0,
          } as LeaderboardEntry)
      );

      return friendsLeaderboard;
    } catch (error) {
      console.error('Error loading friends leaderboard:', error);
      return [];
    }
  }

  /**
   * Helper method to get user profile
   */
  private async getUserProfile(
    userId: string
  ): Promise<{ totalPoints: number } | null> {
    try {
      const usersRef = collection(this.firestore, 'users');
      const userQuery = query(usersRef, where('__name__', '==', userId));
      const snapshot = await getDocs(userQuery);

      if (!snapshot.empty) {
        const userData = snapshot.docs[0].data();
        return {
          totalPoints: userData['stats']?.totalPoints || 0,
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting user profile:', error);
      return null;
    }
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(cacheKey: string): boolean {
    const cached = this.leaderboardCache.get(cacheKey);
    const expiry = this.cacheExpiry.get(cacheKey);

    return cached !== undefined && expiry !== undefined && Date.now() < expiry;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.leaderboardCache.clear();
    this.cacheExpiry.clear();
  }

  /**
   * Clear specific cache entry
   */
  clearCacheEntry(cacheKey: string): void {
    this.leaderboardCache.delete(cacheKey);
    this.cacheExpiry.delete(cacheKey);
  }
}
