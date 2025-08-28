// core/predictions.service.ts
import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  orderBy,
  where,
  getDocs,
  doc,
  setDoc,
  limit,
  updateDoc,
  deleteDoc,
  Timestamp,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';

export interface UserPrediction {
  id?: string;
  fixtureId: string;
  userId: string;
  homeScore: number;
  awayScore: number;
  createdAt: Date;
  updatedAt: Date;
  pointsEarned?: number;
  isSubmitted: boolean;
  gameweek: number;
}

export interface PredictionStats {
  total: number;
  completed: number;
  remaining: number;
  locked: number;
}

@Injectable({
  providedIn: 'root',
})
export class PredictionsService {
  private firestore = inject(Firestore);

  // Cache for user predictions
  private predictionsCache = new Map<string, Map<string, UserPrediction>>();

  constructor() {}

  /**
   * Load user predictions for a specific gameweek
   */
  async loadUserPredictions(
    userId: string,
    gameweek: number
  ): Promise<Map<string, UserPrediction>> {
    try {
      const cacheKey = `${userId}_${gameweek}`;

      // Check cache first
      if (this.predictionsCache.has(cacheKey)) {
        return this.predictionsCache.get(cacheKey)!;
      }

      const predictionsRef = collection(this.firestore, 'predictions');
      const predictionsQuery = query(
        predictionsRef,
        where('userId', '==', userId),
        where('gameweek', '==', gameweek)
      );

      const snapshot = await getDocs(predictionsQuery);
      const predictionsMap = new Map<string, UserPrediction>();

      snapshot.docs.forEach((doc) => {
        const data = doc.data() as UserPrediction;
        predictionsMap.set(data.fixtureId, {
          id: doc.id,
          ...data,
          createdAt:
            data.createdAt instanceof Date
              ? data.createdAt
              : (data.createdAt as any).toDate(),
          updatedAt:
            data.updatedAt instanceof Date
              ? data.updatedAt
              : (data.updatedAt as any).toDate(),
        });
      });

      // Cache the results
      this.predictionsCache.set(cacheKey, predictionsMap);
      return predictionsMap;
    } catch (error) {
      console.error('Error loading user predictions:', error);
      throw error;
    }
  }

  /**
   * Save or update a prediction
   */
  async savePrediction(
    userId: string,
    fixtureId: string,
    homeScore: number,
    awayScore: number,
    gameweek: number,
    existingPrediction?: UserPrediction
  ): Promise<UserPrediction> {
    try {
      const now = new Date();

      const predictionData: Partial<UserPrediction> = {
        fixtureId,
        userId,
        homeScore,
        awayScore,
        createdAt: existingPrediction?.createdAt || now,
        updatedAt: now,
        isSubmitted: true,
        gameweek,
      };

      let docId: string;

      if (existingPrediction?.id) {
        // Update existing prediction
        docId = existingPrediction.id;
        const predictionRef = doc(this.firestore, 'predictions', docId);
        await updateDoc(predictionRef, {
          homeScore: predictionData.homeScore,
          awayScore: predictionData.awayScore,
          updatedAt: Timestamp.fromDate(now),
          gameweek,
        });
      } else {
        // Create new prediction
        docId = `${userId}_${fixtureId}_${gameweek}`;
        const predictionRef = doc(this.firestore, 'predictions', docId);
        await setDoc(predictionRef, {
          ...predictionData,
          createdAt: Timestamp.fromDate(predictionData.createdAt!),
          updatedAt: Timestamp.fromDate(now),
        });
      }

      const savedPrediction: UserPrediction = {
        ...(predictionData as UserPrediction),
        id: docId,
      };

      // Update cache
      const cacheKey = `${userId}_${gameweek}`;
      if (this.predictionsCache.has(cacheKey)) {
        const cachedPredictions = this.predictionsCache.get(cacheKey)!;
        cachedPredictions.set(fixtureId, savedPrediction);
      }

      return savedPrediction;
    } catch (error) {
      console.error('Error saving prediction:', error);
      throw error;
    }
  }

  /**
   * Delete a prediction
   */
  async deletePrediction(
    predictionId: string,
    userId: string,
    gameweek: number,
    fixtureId: string
  ): Promise<void> {
    try {
      const predictionRef = doc(this.firestore, 'predictions', predictionId);
      await deleteDoc(predictionRef);

      // Update cache
      const cacheKey = `${userId}_${gameweek}`;
      if (this.predictionsCache.has(cacheKey)) {
        const cachedPredictions = this.predictionsCache.get(cacheKey)!;
        cachedPredictions.delete(fixtureId);
      }
    } catch (error) {
      console.error('Error deleting prediction:', error);
      throw error;
    }
  }

  /**
   * Get recent predictions for a user
   */
  async getRecentPredictions(
    userId: string,
    lim: number = 10
  ): Promise<UserPrediction[]> {
    try {
      const predictionsRef = collection(this.firestore, 'predictions');
      const recentQuery = query(
        predictionsRef,
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(lim)
      );

      const snapshot = await getDocs(recentQuery);
      return snapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data()['createdAt'].toDate(),
            updatedAt: doc.data()['updatedAt'].toDate(),
          } as UserPrediction)
      );
    } catch (error) {
      console.error('Error loading recent predictions:', error);
      throw error;
    }
  }

  /**
   * Calculate prediction statistics
   */
  calculatePredictionStats(
    fixtures: any[],
    predictions: Map<string, UserPrediction>,
    isPredictionLockedFn: (fixture: any) => boolean
  ): PredictionStats {
    const total = fixtures.length;
    const completed = fixtures.filter((f) => predictions.has(f.id)).length;
    const locked = fixtures.filter((f) => isPredictionLockedFn(f)).length;
    const remaining = total - completed - locked;

    return { total, completed, remaining, locked };
  }

  /**
   * Batch save multiple predictions
   */
  async batchSavePredictions(
    userId: string,
    predictions: Array<{
      fixtureId: string;
      homeScore: number;
      awayScore: number;
      gameweek: number;
    }>
  ): Promise<void> {
    try {
      const batch = writeBatch(this.firestore);
      const now = new Date();

      predictions.forEach((prediction) => {
        const docId = `${userId}_${prediction.fixtureId}_${prediction.gameweek}`;
        const predictionRef = doc(this.firestore, 'predictions', docId);

        batch.set(predictionRef, {
          fixtureId: prediction.fixtureId,
          userId,
          homeScore: prediction.homeScore,
          awayScore: prediction.awayScore,
          gameweek: prediction.gameweek,
          createdAt: Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now),
          isSubmitted: true,
        });
      });

      await batch.commit();

      // Clear cache for affected gameweeks
      predictions.forEach((prediction) => {
        const cacheKey = `${userId}_${prediction.gameweek}`;
        this.predictionsCache.delete(cacheKey);
      });
    } catch (error) {
      console.error('Error batch saving predictions:', error);
      throw error;
    }
  }

  /**
   * Get user's accuracy statistics
   */
  async getUserAccuracyStats(userId: string): Promise<{
    totalPredictions: number;
    correctPredictions: number;
    accuracyRate: number;
    totalPoints: number;
  }> {
    try {
      const predictionsRef = collection(this.firestore, 'predictions');
      const userPredictionsQuery = query(
        predictionsRef,
        where('userId', '==', userId),
        where('pointsEarned', '!=', null) // Only calculated predictions
      );

      const snapshot = await getDocs(userPredictionsQuery);
      const predictions = snapshot.docs.map(
        (doc) => doc.data() as UserPrediction
      );

      const totalPredictions = predictions.length;
      const correctPredictions = predictions.filter(
        (p) => (p.pointsEarned || 0) > 0
      ).length;
      const totalPoints = predictions.reduce(
        (sum, p) => sum + (p.pointsEarned || 0),
        0
      );
      const accuracyRate =
        totalPredictions > 0
          ? (correctPredictions / totalPredictions) * 100
          : 0;

      return {
        totalPredictions,
        correctPredictions,
        accuracyRate: Math.round(accuracyRate),
        totalPoints,
      };
    } catch (error) {
      console.error('Error getting user accuracy stats:', error);
      throw error;
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.predictionsCache.clear();
  }

  /**
   * Clear cache for specific user/gameweek
   */
  clearCacheForUser(userId: string, gameweek?: number): void {
    if (gameweek) {
      const cacheKey = `${userId}_${gameweek}`;
      this.predictionsCache.delete(cacheKey);
    } else {
      // Clear all cache entries for this user
      const keysToDelete = Array.from(this.predictionsCache.keys()).filter(
        (key) => key.startsWith(`${userId}_`)
      );

      keysToDelete.forEach((key) => this.predictionsCache.delete(key));
    }
  }

  /**
   * Get recent predictions for a user with fixture data included
   */
  async getRecentPredictionsWithFixtures(
    userId: string,
    lim: number = 10
  ): Promise<Array<UserPrediction & { fixture?: any }>> {
    try {
      const predictionsRef = collection(this.firestore, 'predictions');
      const recentQuery = query(
        predictionsRef,
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(lim)
      );

      const snapshot = await getDocs(recentQuery);
      const predictions = snapshot.docs.map(
        (doc) =>
          ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data()['createdAt'].toDate(),
            updatedAt: doc.data()['updatedAt'].toDate(),
          } as UserPrediction)
      );

      // Get unique fixture IDs
      const fixtureIds = [...new Set(predictions.map((p) => p.fixtureId))];

      // Batch load fixtures
      const fixturesMap = new Map();
      if (fixtureIds.length > 0) {
        const fixturesRef = collection(this.firestore, 'fixtures');
        const fixturesQuery = query(
          fixturesRef,
          where('__name__', 'in', fixtureIds.slice(0, 10)) // Firestore limit
        );

        const fixturesSnapshot = await getDocs(fixturesQuery);
        fixturesSnapshot.docs.forEach((doc) => {
          const data = doc.data();
          fixturesMap.set(doc.id, {
            id: doc.id,
            ...data,
            kickoffTime: data['kickoffTime'].toDate(),
            predictionDeadline: data['predictionDeadline'].toDate(),
          });
        });
      }

      // Merge predictions with fixture data
      return predictions.map((prediction) => ({
        ...prediction,
        fixture: fixturesMap.get(prediction.fixtureId) || null,
      }));
    } catch (error) {
      console.error('Error loading recent predictions with fixtures:', error);
      throw error;
    }
  }
}
