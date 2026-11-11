import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const requiredConfigKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
] as const satisfies readonly (keyof FirebaseClientConfig)[];

let diagnosticsReported = false;

function isCompleteConfig(
  candidate: typeof config,
): candidate is FirebaseClientConfig {
  return requiredConfigKeys.every((key) => Boolean(candidate[key]?.trim()));
}

function reportConfigDiagnostics(isConfigured: boolean, missing: string[] = []) {
  if (diagnosticsReported) {
    return;
  }

  diagnosticsReported = true;
  const projectId = config.projectId?.trim() || null;

  if (isConfigured) {
    console.info('Firebase client configuration', { configured: true, projectId });
    return;
  }

  console.warn('Firebase client configuration is incomplete', {
    configured: false,
    missing,
    projectId,
  });
}

function matchesConfig(app: FirebaseApp, expected: FirebaseClientConfig): boolean {
  return (
    app.options.apiKey === expected.apiKey &&
    app.options.authDomain === expected.authDomain &&
    app.options.projectId === expected.projectId &&
    app.options.storageBucket === expected.storageBucket &&
    app.options.messagingSenderId === expected.messagingSenderId &&
    app.options.appId === expected.appId
  );
}

export function getFirebaseApp(): FirebaseApp | undefined {
  const missing = requiredConfigKeys
    .filter((key) => !config[key]?.trim())
    .map((key) => `NEXT_PUBLIC_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`);

  if (!isCompleteConfig(config)) {
    reportConfigDiagnostics(false, missing);
    return undefined;
  }

  reportConfigDiagnostics(true);

  const existingApps = getApps();
  if (existingApps.length > 1) {
    throw new Error(
      'Multiple Firebase client apps are initialized. Ensure the client SDK is initialized only once.',
    );
  }

  if (existingApps.length === 1) {
    const existingApp = existingApps.find((app) => app.name === '[DEFAULT]');
    if (!existingApp) {
      throw new Error(
        'An unexpected named Firebase client app is initialized. Configure one default client app.',
      );
    }

    if (!matchesConfig(existingApp, config)) {
      throw new Error(
        `The existing Firebase client app does not match the configured client settings (configured project: ${config.projectId}). Restart the app after correcting the Firebase environment variables.`,
      );
    }

    return existingApp;
  }

  return initializeApp(config);
}

export const firebaseApp = getFirebaseApp();

export function getFirebaseAuth(): Auth {
  const app = firebaseApp ?? getFirebaseApp();
  if (!app) {
    throw new Error(
      'Firebase Authentication is unavailable. Configure all required NEXT_PUBLIC_FIREBASE_* environment variables.',
    );
  }

  if (!app.options.apiKey?.trim()) {
    throw new Error(
      'Firebase Authentication is unavailable because the configured client app has no API key.',
    );
  }

  return getAuth(app);
}

export const auth: Auth | undefined =
  typeof window !== 'undefined' && firebaseApp ? getFirebaseAuth() : undefined;
export const firestore: Firestore | undefined = firebaseApp ? getFirestore(firebaseApp) : undefined;
