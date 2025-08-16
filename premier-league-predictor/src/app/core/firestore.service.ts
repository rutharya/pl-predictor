import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  docData,
  collectionData,
  query,
  where,
  orderBy,
  Timestamp,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface User {
  id?: string;
  name: string;
  email: string;
  createdAt: Timestamp;
}

@Injectable({
  providedIn: 'root',
})
export class FirestoreService {
  private firestore = inject(Firestore);

  // Get all users
  getUsers(): Observable<User[]> {
    const usersRef = collection(this.firestore, 'users');
    const q = query(usersRef, orderBy('createdAt', 'desc'));
    return collectionData(q, { idField: 'id' }) as Observable<User[]>;
  }

  // Get specific user
  getUser(id: string): Observable<User | undefined> {
    const userRef = doc(this.firestore, 'users', id);
    return docData(userRef, { idField: 'id' }) as Observable<User | undefined>;
  }

  // Add new user
  async addUser(userData: Omit<User, 'id' | 'createdAt'>) {
    try {
      const usersRef = collection(this.firestore, 'users');
      const user: Omit<User, 'id'> = {
        ...userData,
        createdAt: Timestamp.now(),
      };
      const docRef = await addDoc(usersRef, user);
      return docRef;
    } catch (error) {
      throw error;
    }
  }

  // Update user
  async updateUser(id: string, userData: Partial<User>) {
    try {
      const userRef = doc(this.firestore, 'users', id);
      await updateDoc(userRef, userData);
    } catch (error) {
      throw error;
    }
  }

  // Delete user
  async deleteUser(id: string) {
    try {
      const userRef = doc(this.firestore, 'users', id);
      await deleteDoc(userRef);
    } catch (error) {
      throw error;
    }
  }

  // Query users by email
  getUserByEmail(email: string): Observable<User[]> {
    const usersRef = collection(this.firestore, 'users');
    const q = query(usersRef, where('email', '==', email));
    return collectionData(q, { idField: 'id' }) as Observable<User[]>;
  }
}
