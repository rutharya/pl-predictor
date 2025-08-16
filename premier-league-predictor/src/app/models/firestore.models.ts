// src/app/models/firestore.models.ts
import { Timestamp } from 'firebase/firestore';

export interface User {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  totalPoints: number;
}

export interface Gameweek {
  gameweek: number;
  year: number;
  deadline: Timestamp;
}

export interface Fixture {
  fixtureId: number;
  gameweek: number;
  kickoffTime: Timestamp;
  homeTeam: string;
  homeTeamCrest: string;
  awayTeam: string;
  awayTeamCrest: string;
  status: 'SCHEDULED' | 'IN_PLAY' | 'FINISHED';
  homeScore?: number;
  awayScore?: number;
}

export interface Prediction {
  userId: string;
  fixtureId: number;
  gameweek: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  pointsEarned?: 0 | 1 | 3;
}
