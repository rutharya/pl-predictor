// fixtures.component.ts - Refactored with Services
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
import { AuthService } from '../../core/auth.service';
import { ProfileService } from '../../core/profile.service';
import {
  FixturesService,
  Fixture,
  GroupedFixtures,
} from '../../core/fixtures.service';
import {
  PredictionsService,
  UserPrediction,
  PredictionStats,
} from '../../core/predictions.service';
import {
  interval,
  takeUntil,
  Subject,
  debounceTime,
  distinctUntilChanged,
} from 'rxjs';

@Component({
  selector: 'app-fixtures',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './fixtures.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './fixtures.css',
})
export class Fixtures implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  protected authService = inject(AuthService);
  private profileService = inject(ProfileService);
  private fixturesService = inject(FixturesService);
  private predictionsService = inject(PredictionsService);
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
    return this.fixturesService.groupFixturesByMatchDay(this.fixtures());
  });

  predictionStats = computed(() => {
    return this.predictionsService.calculatePredictionStats(
      this.fixtures(),
      this.userPredictions(),
      (fixture) => this.fixturesService.isPredictionLocked(fixture)
    );
  });

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
    this.fixturesService.cleanup();
  }

  private setupAutoSave(): void {
    this.autoSaveSubject
      .pipe(
        debounceTime(2000),
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
    const gameweeks = Array.from({ length: 38 }, (_, i) => i + 1);
    this.availableGameweeks.set(gameweeks);
  }

  private loadCurrentGameweek(): void {
    const seasonStart = new Date('2025-08-17');
    const now = new Date();
    const weeksDiff = Math.round(
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

    try {
      const userId = this.authService.getCurrentUserId();
      if (!userId) {
        this.isLoading.set(false);
        return;
      }

      // Load fixtures and predictions in parallel
      const [fixtures, predictions] = await Promise.all([
        this.fixturesService.loadFixturesByGameweek(this.selectedGameweek()),
        this.predictionsService.loadUserPredictions(
          userId,
          this.selectedGameweek()
        ),
      ]);

      this.fixtures.set(fixtures);
      this.userPredictions.set(predictions);
      this.setupPredictionForms();
    } catch (error) {
      console.error('Error loading fixtures and predictions:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private setupPredictionForms(): void {
    this.predictionForms.clear();
    this.unsavedChanges.clear();

    this.fixtures().forEach((fixture) => {
      const existingPrediction = this.userPredictions().get(fixture.id);

      const form = this.fb.group({
        homeScore: [
          existingPrediction?.homeScore ?? '-',
          [Validators.required, Validators.min(0), Validators.max(9)],
        ],
        awayScore: [
          existingPrediction?.awayScore ?? '-',
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

      // Save using the predictions service
      const savedPrediction = await this.predictionsService.savePrediction(
        userId,
        fixtureId,
        prediction.homeScore,
        prediction.awayScore,
        this.selectedGameweek(),
        existingPrediction
      );

      // Update local state with optimistic update
      const updatedPredictions = new Map(this.userPredictions());
      updatedPredictions.set(fixtureId, savedPrediction);
      this.userPredictions.set(updatedPredictions);

      this.unsavedChanges.set(fixtureId, false);
      this.lastSavedTime.set(new Date());

      // Update user stats if it's a new prediction
      if (!existingPrediction) {
        await this.profileService.incrementMatchCount();
      }
    } catch (error) {
      console.error('Error saving prediction:', error);
      this.unsavedChanges.set(fixtureId, true);
    } finally {
      if (!isAutoSave) this.isSaving.set(false);
    }
  }

  private startPeriodicUpdates(): void {
    interval(60000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // Force change detection for countdown timers
        this.lastSavedTime.set(this.lastSavedTime());
      });
  }

  // UI Helper Methods (delegated to services where appropriate)
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

  isPredictionLocked(fixture: Fixture): boolean {
    return this.fixturesService.isPredictionLocked(fixture);
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
    this.fixturesService.clearCache();
    this.predictionsService.clearCacheForUser(
      this.authService.getCurrentUserId()!,
      this.selectedGameweek()
    );
    this.loadFixturesAndPredictions();
  }

  // Batch operations using the predictions service
  async saveAllPredictions(): Promise<void> {
    const userId = this.authService.getCurrentUserId();
    if (!userId) return;

    try {
      this.isSaving.set(true);

      const predictionsToSave: Array<{
        fixtureId: string;
        homeScore: number;
        awayScore: number;
        gameweek: number;
      }> = [];

      // Collect all valid unsaved predictions
      this.predictionForms.forEach((form, fixtureId) => {
        if (form.valid && this.hasUnsavedChanges(fixtureId)) {
          const values = form.value;
          predictionsToSave.push({
            fixtureId,
            homeScore: values.homeScore,
            awayScore: values.awayScore,
            gameweek: this.selectedGameweek(),
          });
        }
      });

      if (predictionsToSave.length > 0) {
        await this.predictionsService.batchSavePredictions(
          userId,
          predictionsToSave
        );

        // Clear unsaved changes for all saved predictions
        predictionsToSave.forEach((prediction) => {
          this.unsavedChanges.set(prediction.fixtureId, false);
        });

        this.lastSavedTime.set(new Date());

        // Reload predictions to get the latest state
        const updatedPredictions =
          await this.predictionsService.loadUserPredictions(
            userId,
            this.selectedGameweek()
          );
        this.userPredictions.set(updatedPredictions);
      }
    } catch (error) {
      console.error('Error saving all predictions:', error);
    } finally {
      this.isSaving.set(false);
    }
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

  // Delete a prediction
  async deletePrediction(fixtureId: string): Promise<void> {
    const userId = this.authService.getCurrentUserId();
    const prediction = this.userPredictions().get(fixtureId);

    if (!userId || !prediction?.id) return;

    try {
      this.isSaving.set(true);

      await this.predictionsService.deletePrediction(
        prediction.id,
        userId,
        this.selectedGameweek(),
        fixtureId
      );

      // Update local state
      const updatedPredictions = new Map(this.userPredictions());
      updatedPredictions.delete(fixtureId);
      this.userPredictions.set(updatedPredictions);

      // Reset form
      const form = this.predictionForms.get(fixtureId);
      if (form) {
        form.patchValue({ homeScore: 0, awayScore: 0 });
      }
      this.unsavedChanges.set(fixtureId, false);
    } catch (error) {
      console.error('Error deleting prediction:', error);
    } finally {
      this.isSaving.set(false);
    }
  }

  // Get prediction statistics
  getPredictionStats(): PredictionStats {
    return this.predictionStats();
  }
}
