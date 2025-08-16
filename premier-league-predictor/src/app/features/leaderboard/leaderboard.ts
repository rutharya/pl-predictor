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
import { FormsModule } from '@angular/forms';
import { Auth2Service } from '../../core/auth2.service';
import { ProfileService } from '../../core/profile.service';
import {
  Firestore,
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  where,
  DocumentSnapshot,
} from '@angular/fire/firestore';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  photoURL?: string;
  totalPoints: number;
  exactPredictions: number;
  accuracyRate: number;
  currentPosition: number;
  previousPosition?: number;
  positionChange?: 'up' | 'down' | 'same' | 'new';
  gameweekPoints?: number;
}

@Component({
  selector: 'app-leaderboard',
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './leaderboard.html',
  styleUrl: './leaderboard.css',
})
export class Leaderboard implements OnInit, OnDestroy {
  private firestore = inject(Firestore);
  private authService = inject(Auth2Service);
  private profileService = inject(ProfileService);
  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();

  // Signals
  leaderboardEntries = signal<LeaderboardEntry[]>([]);
  isLoading = signal(true);
  isLoadingMore = signal(false);
  hasMoreData = signal(true);
  currentView = signal<'overall' | 'gameweek'>('overall');
  searchTerm = '';

  private lastDoc: DocumentSnapshot | null = null;
  private readonly PAGE_SIZE = 20;

  ngOnInit(): void {
    this.setupSearch();
    this.loadLeaderboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupSearch(): void {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((term) => {
        this.performSearch(term);
      });
  }

  setView(view: 'overall' | 'gameweek'): void {
    if (this.currentView() !== view) {
      this.currentView.set(view);
      this.resetAndLoad();
    }
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm = target.value;
    this.searchSubject.next(this.searchTerm);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.resetAndLoad();
  }

  private resetAndLoad(): void {
    this.leaderboardEntries.set([]);
    this.lastDoc = null;
    this.hasMoreData.set(true);
    this.loadLeaderboard();
  }

  private async performSearch(term: string): Promise<void> {
    if (!term.trim()) {
      this.resetAndLoad();
      return;
    }

    this.isLoading.set(true);
    try {
      const usersRef = collection(this.firestore, 'users');
      const searchQuery = query(
        usersRef,
        where('displayName', '>=', term),
        where('displayName', '<=', term + '\uf8ff'),
        where('preferences.privacy.showOnLeaderboard', '==', true),
        orderBy('displayName'),
        limit(this.PAGE_SIZE)
      );

      const snapshot = await getDocs(searchQuery);
      const entries = snapshot.docs.map((doc, index) =>
        this.mapDocToEntry(doc, index + 1)
      );

      this.leaderboardEntries.set(entries);
      this.hasMoreData.set(snapshot.docs.length === this.PAGE_SIZE);
      this.lastDoc = snapshot.docs[snapshot.docs.length - 1] || null;
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadLeaderboard(): Promise<void> {
    this.isLoading.set(true);
    try {
      const usersRef = collection(this.firestore, 'users');
      const orderField =
        this.currentView() === 'overall'
          ? 'stats.totalPoints'
          : 'stats.gameweekPoints';

      let leaderboardQuery = query(
        usersRef,
        where('preferences.privacy.showOnLeaderboard', '==', true),
        orderBy(orderField, 'desc'),
        limit(this.PAGE_SIZE)
      );

      if (this.lastDoc) {
        leaderboardQuery = query(leaderboardQuery, startAfter(this.lastDoc));
      }

      const snapshot = await getDocs(leaderboardQuery);
      const entries = snapshot.docs.map((doc, index) => {
        const baseRank = this.leaderboardEntries().length + index + 1;
        return this.mapDocToEntry(doc, baseRank);
      });

      if (this.lastDoc) {
        // Append to existing entries
        this.leaderboardEntries.update((current) => [...current, ...entries]);
      } else {
        // Set new entries
        this.leaderboardEntries.set(entries);
      }

      this.hasMoreData.set(snapshot.docs.length === this.PAGE_SIZE);
      this.lastDoc = snapshot.docs[snapshot.docs.length - 1] || null;
    } catch (error) {
      console.error('Leaderboard loading error:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (!this.hasMoreData() || this.isLoadingMore()) return;

    this.isLoadingMore.set(true);
    try {
      await this.loadLeaderboard();
    } finally {
      this.isLoadingMore.set(false);
    }
  }

  private mapDocToEntry(doc: any, position: number): LeaderboardEntry {
    const data = doc.data();
    const stats = data.stats || {};

    return {
      uid: doc.id,
      displayName: data.displayName || 'Anonymous',
      photoURL: data.photoURL,
      totalPoints: stats.totalPoints || 0,
      exactPredictions: stats.correctPredictions || 0,
      accuracyRate: Math.round(stats.accuracyRate || 0),
      currentPosition: position,
      previousPosition: stats.previousPosition,
      positionChange: this.calculatePositionChange(
        position,
        stats.previousPosition
      ),
      gameweekPoints: stats.gameweekPoints || 0,
    };
  }

  private calculatePositionChange(
    current: number,
    previous?: number
  ): 'up' | 'down' | 'same' | 'new' {
    if (!previous) return 'new';
    if (current < previous) return 'up';
    if (current > previous) return 'down';
    return 'same';
  }

  // UI Helper Methods
  getViewButtonClass(view: 'overall' | 'gameweek'): string {
    return this.currentView() === view
      ? 'bg-white text-gray-900 shadow-lg'
      : 'text-white/70 hover:text-white hover:bg-white/10';
  }

  getRowClass(entry: LeaderboardEntry): string {
    let classes = 'animate-slide-in';
    if (this.isCurrentUser(entry.uid)) {
      classes += ' bg-blue-500/20 border-l-4 border-blue-500';
    }
    return classes;
  }

  getMobileCardClass(entry: LeaderboardEntry): string {
    let classes = 'animate-slide-in';
    if (this.isCurrentUser(entry.uid)) {
      classes += ' bg-blue-500/20 border border-blue-500/50';
    }
    return classes;
  }

  getRankBadgeClass(position: number): string {
    if (position === 1)
      return 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-yellow-900 shadow-lg';
    if (position === 2)
      return 'bg-gradient-to-r from-gray-300 to-gray-500 text-gray-900 shadow-lg';
    if (position === 3)
      return 'bg-gradient-to-r from-orange-400 to-orange-600 text-orange-900 shadow-lg';
    if (position <= 10)
      return 'bg-gradient-to-r from-green-400 to-green-600 text-green-900';
    return 'bg-white/20 text-white border border-white/30';
  }

  getChangeIndicatorClass(change: 'up' | 'down' | 'same' | 'new'): string {
    switch (change) {
      case 'up':
        return 'bg-green-500/20 text-green-300 border border-green-500/30';
      case 'down':
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
      case 'new':
        return 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
      default:
        return 'bg-white/10 text-white/60';
    }
  }

  getPositionChangeText(entry: LeaderboardEntry): string {
    if (!entry.previousPosition) return 'NEW';
    const change = Math.abs(entry.currentPosition - entry.previousPosition);
    return change.toString();
  }

  isCurrentUser(uid: string): boolean {
    return this.authService.getCurrentUserId() === uid;
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
