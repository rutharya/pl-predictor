import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getFunctions, provideFunctions } from '@angular/fire/functions';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes), provideFirebaseApp(() => initializeApp({ projectId: "pl-predictor-5c8e6", appId: "1:950699719981:web:d658a04a3829c57faee7a4", storageBucket: "pl-predictor-5c8e6.firebasestorage.app", apiKey: "AIzaSyCI1ZLdpz0tjFkUl-npIUTv21gVP35P7QA", authDomain: "pl-predictor-5c8e6.firebaseapp.com", messagingSenderId: "950699719981", measurementId: "G-9BBW5VYNBP" })), provideAuth(() => getAuth()), provideFirestore(() => getFirestore()), provideFunctions(() => getFunctions())
  ]
};
