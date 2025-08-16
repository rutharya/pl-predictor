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
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Auth2Service } from '../../core/auth2.service';
import { ProfileService } from '../../core/profile.service';
import {
  Firestore,
  collection,
  query,
  orderBy,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  Timestamp,
} from '@angular/fire/firestore';
import {
  interval,
  takeUntil,
  Subject,
  debounceTime,
  distinctUntilChanged,
} from 'rxjs';

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
  matchDay: string; // e.g., "Saturday, Dec 23"
}

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
}

export interface GroupedFixtures {
  [matchDay: string]: Fixture[];
}

@Component({
  selector: 'app-fixtures',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './fixtures.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './fixtures.css',
})
export class Fixtures implements OnInit, OnDestroy {
  private firestore = inject(Firestore);
  private fb = inject(FormBuilder);
  protected authService = inject(Auth2Service);
  private profileService = inject(ProfileService);
  private destroy$ = new Subject<void>();
  private autoSaveSubject = new Subject<{
    fixtureId: string;
    prediction: any;
  }>();

  // Signals
  fixtures = signal<Fixture[]>([]);
  userPredictions = signal<Map<string, UserPrediction>>(new Map());
  selectedGameweek = signal<number>(1);
  isLoading = signal(true);
  isSaving = signal(false);
  lastSavedTime = signal<Date | null>(null);
  availableGameweeks = signal<number[]>([]);

  // Form management
  predictionForms = new Map<string, FormGroup>();
  unsavedChanges = new Map<string, boolean>();

  // Score options for dropdowns
  scoreOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  // Computed properties
  groupedFixtures = computed(() => {
    const fixtures = this.fixtures();
    const grouped: GroupedFixtures = {};

    fixtures.forEach((fixture) => {
      if (!grouped[fixture.matchDay]) {
        grouped[fixture.matchDay] = [];
      }
      grouped[fixture.matchDay].push(fixture);
    });

    return grouped;
  });

  predictionStats = computed(() => {
    const allFixtures = this.fixtures();
    const predictions = this.userPredictions();

    const total = allFixtures.length;
    const completed = allFixtures.filter((f) => predictions.has(f.id)).length;
    const locked = allFixtures.filter((f) => this.isPredictionLocked(f)).length;
    const remaining = total - completed - locked;

    return { total, completed, remaining, locked };
  });
  // Object: any;
  protected readonly Object = Object;

  ngOnInit(): void {
    this.setupAutoSave();
    this.loadAvailableGameweeks();
    this.loadCurrentGameweek();
    this.loadFixturesAndPredictions();
    this.startPeriodicUpdates();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupAutoSave(): void {
    this.autoSaveSubject
      .pipe(
        debounceTime(2000), // Wait 2 seconds after last change
        distinctUntilChanged(
          (prev, curr) =>
            prev.fixtureId === curr.fixtureId &&
            JSON.stringify(prev.prediction) === JSON.stringify(curr.prediction)
        ),
        takeUntil(this.destroy$)
      )
      .subscribe(({ fixtureId, prediction }) => {
        this.savePrediction(fixtureId, prediction, true);
      });
  }

  private loadAvailableGameweeks(): void {
    // Generate gameweeks 1-38 for Premier League
    const gameweeks = Array.from({ length: 38 }, (_, i) => i + 1);
    this.availableGameweeks.set(gameweeks);
  }

  private loadCurrentGameweek(): void {
    // Calculate current gameweek based on date
    const seasonStart = new Date('2025-08-17');
    const now = new Date();
    const weeksDiff = Math.floor(
      (now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    const currentGW = Math.max(1, Math.min(38, weeksDiff + 1));
    this.selectedGameweek.set(currentGW);
  }

  setGameweek(gameweek: number): void {
    if (this.selectedGameweek() !== gameweek) {
      this.selectedGameweek.set(gameweek);
      this.loadFixturesAndPredictions();
    }
  }

  private async loadFixturesAndPredictions(): Promise<void> {
    this.isLoading.set(true);
    await Promise.all([this.loadFixtures(), this.loadUserPredictions()]);
    this.setupPredictionForms();
    this.isLoading.set(false);
  }

  private async loadFixtures(): Promise<void> {
    try {
      const fixturesRef = collection(this.firestore, 'fixtures');

      const fixturesQuery = query(
        fixturesRef,
        where('gameweek', '==', this.selectedGameweek()),
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

      this.fixtures.set(fixtures);
    } catch (error) {
      console.error('Error loading fixtures:', error);
      // Mock data for development
      // this.loadMockFixtures();
    }
  }

  // private loadMockFixtures(): void {
  //   const baseDate = new Date();
  //   baseDate.setDate(baseDate.getDate() + 1); // Tomorrow

  //   const mockFixtures: Fixture[] = [
  //     {
  //       id: '1',
  //       homeTeam: 'Manchester City',
  //       awayTeam: 'Arsenal',
  //       kickoffTime: new Date(baseDate.getTime()),
  //       predictionDeadline: new Date(baseDate.getTime() - 3600000), // 1 hour before
  //       gameweek: this.selectedGameweek(),
  //       status: 'upcoming',
  //       matchDay: this.formatMatchDay(baseDate),
  //     },
  //     {
  //       id: '2',
  //       homeTeam: 'Liverpool',
  //       awayTeam: 'Chelsea',
  //       kickoffTime: new Date(baseDate.getTime() + 7200000), // 2 hours later
  //       predictionDeadline: new Date(baseDate.getTime() + 3600000),
  //       gameweek: this.selectedGameweek(),
  //       status: 'upcoming',
  //       matchDay: this.formatMatchDay(baseDate),
  //     },
  //     {
  //       id: '3',
  //       homeTeam: 'Manchester United',
  //       awayTeam: 'Tottenham',
  //       kickoffTime: new Date(baseDate.getTime() + 86400000), // Next day
  //       predictionDeadline: new Date(baseDate.getTime() + 82800000),
  //       gameweek: this.selectedGameweek(),
  //       status: 'upcoming',
  //       matchDay: this.formatMatchDay(new Date(baseDate.getTime() + 86400000)),
  //     },
  //     {
  //       id: '4',
  //       homeTeam: 'Newcastle United',
  //       awayTeam: 'Brighton',
  //       kickoffTime: new Date(baseDate.getTime() + 86400000 + 7200000), // Next day + 2 hours
  //       predictionDeadline: new Date(baseDate.getTime() + 86400000 + 3600000),
  //       gameweek: this.selectedGameweek(),
  //       status: 'upcoming',
  //       matchDay: this.formatMatchDay(new Date(baseDate.getTime() + 86400000)),
  //     },
  //     {
  //       id: '5',
  //       homeTeam: 'West Ham',
  //       awayTeam: 'Everton',
  //       kickoffTime: new Date(baseDate.getTime() + 172800000), // Day after tomorrow
  //       predictionDeadline: new Date(baseDate.getTime() + 169200000),
  //       gameweek: this.selectedGameweek(),
  //       status: 'upcoming',
  //       matchDay: this.formatMatchDay(new Date(baseDate.getTime() + 172800000)),
  //     },
  //   ];

  //   this.fixtures.set(mockFixtures);
  // }

  private async loadUserPredictions(): Promise<void> {
    const userId = this.authService.getCurrentUserId();
    if (!userId) return;

    try {
      const predictionsRef = collection(this.firestore, 'predictions');
      const predictionsQuery = query(
        predictionsRef,
        where('userId', '==', userId),
        where('gameweek', '==', this.selectedGameweek())
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

      this.userPredictions.set(predictionsMap);
    } catch (error) {
      console.error('Error loading predictions:', error);
    }
  }

  private setupPredictionForms(): void {
    this.predictionForms.clear();
    this.unsavedChanges.clear();

    this.fixtures().forEach((fixture) => {
      const existingPrediction = this.userPredictions().get(fixture.id);

      const form = this.fb.group({
        homeScore: [
          existingPrediction?.homeScore ?? 0,
          [Validators.required, Validators.min(0), Validators.max(9)],
        ],
        awayScore: [
          existingPrediction?.awayScore ?? 0,
          [Validators.required, Validators.min(0), Validators.max(9)],
        ],
      });

      this.predictionForms.set(fixture.id, form);
      this.unsavedChanges.set(fixture.id, false);
    });
  }

  getPredictionForm(fixtureId: string): FormGroup {
    return (
      this.predictionForms.get(fixtureId) ||
      this.fb.group({
        homeScore: [
          0,
          [Validators.required, Validators.min(0), Validators.max(9)],
        ],
        awayScore: [
          0,
          [Validators.required, Validators.min(0), Validators.max(9)],
        ],
      })
    );
  }

  onPredictionChange(fixtureId: string): void {
    const form = this.predictionForms.get(fixtureId);
    if (!form || !form.valid) return;

    const prediction = form.value;
    const existingPrediction = this.userPredictions().get(fixtureId);

    // Check if prediction has changed
    const hasChanged =
      !existingPrediction ||
      existingPrediction.homeScore !== prediction.homeScore ||
      existingPrediction.awayScore !== prediction.awayScore;

    if (hasChanged) {
      this.unsavedChanges.set(fixtureId, true);
      this.autoSaveSubject.next({ fixtureId, prediction });
    }
  }

  async savePredictionManually(fixtureId: string): Promise<void> {
    const form = this.predictionForms.get(fixtureId);
    if (!form || !form.valid) return;

    await this.savePrediction(fixtureId, form.value, false);
  }

  private async savePrediction(
    fixtureId: string,
    prediction: any,
    isAutoSave: boolean = false
  ): Promise<void> {
    const userId = this.authService.getCurrentUserId();
    if (!userId) return;

    try {
      if (!isAutoSave) this.isSaving.set(true);

      const existingPrediction = this.userPredictions().get(fixtureId);
      const now = new Date();

      const predictionData: Partial<UserPrediction> = {
        fixtureId,
        userId,
        homeScore: prediction.homeScore,
        awayScore: prediction.awayScore,
        createdAt: existingPrediction?.createdAt || now,
        updatedAt: now,
        isSubmitted: true,
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
          gameweek: this.selectedGameweek(),
        });
      } else {
        // Create new prediction
        docId = `${userId}_${fixtureId}_${this.selectedGameweek()}`;
        const predictionRef = doc(this.firestore, 'predictions', docId);
        await setDoc(predictionRef, {
          ...predictionData,
          gameweek: this.selectedGameweek(),
          createdAt: Timestamp.fromDate(predictionData.createdAt!),
          updatedAt: Timestamp.fromDate(now),
        });
      }

      // Update local state with optimistic update
      const updatedPredictions = new Map(this.userPredictions());
      updatedPredictions.set(fixtureId, {
        ...(predictionData as UserPrediction),
        id: docId,
      });
      this.userPredictions.set(updatedPredictions);

      this.unsavedChanges.set(fixtureId, false);
      this.lastSavedTime.set(now);

      // Update user stats
      if (!existingPrediction) {
        await this.profileService.incrementMatchCount();
      }
    } catch (error) {
      console.error('Error saving prediction:', error);
      // Revert optimistic update on error
      this.unsavedChanges.set(fixtureId, true);
    } finally {
      if (!isAutoSave) this.isSaving.set(false);
    }
  }

  private startPeriodicUpdates(): void {
    // Update every minute for countdown timers
    interval(60000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // This would update live scores and countdown timers
        // For now, just force change detection by updating a signal
        this.lastSavedTime.set(this.lastSavedTime());
      });
  }

  // UI Helper Methods
  getGameweekButtonClass(gameweek: number): string {
    return this.selectedGameweek() === gameweek
      ? 'bg-white text-gray-900 shadow-lg'
      : 'text-white/70 hover:text-white hover:bg-white/10';
  }

  getFixtureCardClass(fixture: Fixture): string {
    let classes =
      'bg-white/5 rounded-xl p-4 md:p-6 transition-all duration-300 hover:bg-white/10 group';

    if (fixture.status === 'live') {
      classes += ' animate-pulse-border border-green-500/50';
    }

    if (this.hasUnsavedChanges(fixture.id)) {
      classes += ' border-orange-500/50';
    }

    return classes;
  }

  formatMatchDay(date: Date): string {
    return date.toLocaleDateString('en-GB', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  formatKickoffTime(kickoffTime: Date): string {
    return kickoffTime.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
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

  isPredictionLocked(fixture: Fixture): boolean {
    return new Date() >= fixture.predictionDeadline;
  }

  hasUnsavedChanges(fixtureId: string): boolean {
    return this.unsavedChanges.get(fixtureId) || false;
  }

  getUserPrediction(fixtureId: string): UserPrediction | undefined {
    return this.userPredictions().get(fixtureId);
  }

  getPointsClass(points: number | undefined): string {
    if (!points) return 'text-white/60';
    if (points >= 5) return 'text-green-400';
    if (points >= 3) return 'text-yellow-400';
    if (points > 0) return 'text-blue-400';
    return 'text-white/60';
  }

  getTeamInitials(teamName: string): string {
    return teamName
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 3);
  }

  formatLastSaved(): string {
    const lastSaved = this.lastSavedTime();
    if (!lastSaved) return '';

    const now = new Date();
    const diffInMinutes = Math.floor(
      (now.getTime() - lastSaved.getTime()) / (1000 * 60)
    );

    if (diffInMinutes < 1) return 'just now';
    if (diffInMinutes === 1) return '1 minute ago';
    if (diffInMinutes < 60) return `${diffInMinutes} minutes ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours === 1) return '1 hour ago';
    return `${diffInHours} hours ago`;
  }

  // Additional utility methods
  clearUnsavedChanges(fixtureId: string): void {
    this.unsavedChanges.set(fixtureId, false);
  }

  resetForm(fixtureId: string): void {
    const form = this.predictionForms.get(fixtureId);
    const existingPrediction = this.userPredictions().get(fixtureId);

    if (form && existingPrediction) {
      form.patchValue({
        homeScore: existingPrediction.homeScore,
        awayScore: existingPrediction.awayScore,
      });
      this.unsavedChanges.set(fixtureId, false);
    }
  }

  isFormValid(fixtureId: string): boolean {
    const form = this.predictionForms.get(fixtureId);
    return form ? form.valid : false;
  }

  getFormErrors(fixtureId: string): any {
    const form = this.predictionForms.get(fixtureId);
    return form ? form.errors : null;
  }

  refreshFixtures(): void {
    this.loadFixturesAndPredictions();
  }

  // Batch operations
  saveAllPredictions(): Promise<void[]> {
    const savePromises: Promise<void>[] = [];

    this.predictionForms.forEach((form, fixtureId) => {
      if (form.valid && this.hasUnsavedChanges(fixtureId)) {
        savePromises.push(this.savePredictionManually(fixtureId));
      }
    });

    return Promise.all(savePromises);
  }

  hasAnyUnsavedChanges(): boolean {
    return Array.from(this.unsavedChanges.values()).some(
      (hasChanges) => hasChanges
    );
  }

  getTotalUnsavedChanges(): number {
    return Array.from(this.unsavedChanges.values()).filter(
      (hasChanges) => hasChanges
    ).length;
  }
}
