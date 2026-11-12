import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { adminFirestore } from '@/lib/firebase/admin';

export const firestoreCollections = {
  users: 'users',
  contracts: 'contracts',
  negotiations: 'negotiations',
  amendments: 'amendments',
  payments: 'payments',
  auditLogs: 'auditLogs',
} as const;

export type FirestoreCollection =
  (typeof firestoreCollections)[keyof typeof firestoreCollections];

export function getDocumentReference(
  collection: FirestoreCollection,
  documentId: string,
): DocumentReference {
  if (!documentId.trim()) {
    throw new Error('Firestore document IDs must not be empty.');
  }

  if (!adminFirestore) {
    throw new Error('Firebase Admin Firestore is not configured.');
  }

  return adminFirestore.collection(collection).doc(documentId);
}

export function getServerTimestamp() {
  return FieldValue.serverTimestamp();
}
