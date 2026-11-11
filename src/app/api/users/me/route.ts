import { z } from 'zod';
import { NextResponse } from 'next/server';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyIdToken } from '@/lib/firebase/verify-token';
import { FieldValue } from 'firebase-admin/firestore';

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});

const updateProfileSchema = profileSchema.partial();

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const verification = await verifyIdToken(authHeader);

  if (!verification.success) {
    return NextResponse.json({ error: verification.error }, { status: 401 });
  }

  const uid = verification.uid;
  if (!uid) {
    return NextResponse.json({ error: 'Authentication context missing' }, { status: 401 });
  }

  if (!adminFirestore) {
    return NextResponse.json({ error: 'Firebase Admin SDK is not configured' }, { status: 500 });
  }

  const db = adminFirestore;
  const userRef = db.collection('users').doc(uid);
  const snapshot = await userRef.get();

  if (!snapshot.exists) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  return NextResponse.json(snapshot.data());
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const verification = await verifyIdToken(authHeader);

  if (!verification.success) {
    return NextResponse.json({ error: verification.error }, { status: 401 });
  }

  const uid = verification.uid;
  const email = verification.email;
  if (!uid || !email) {
    return NextResponse.json({ error: 'Authentication context missing' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.issues.map((issue) => issue.message) },
      { status: 400 },
    );
  }

  if (!adminFirestore) {
    return NextResponse.json({ error: 'Firebase Admin SDK is not configured' }, { status: 500 });
  }

  const db = adminFirestore;
  const userRef = db.collection('users').doc(uid);
  const snapshot = await userRef.get();

  if (snapshot.exists) {
    return NextResponse.json({ error: 'Profile already exists' }, { status: 400 });
  }

  const data = {
    uid,
    email,
    displayName: parsed.data.displayName,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await userRef.set(data, { merge: true });
  const createdProfile = await userRef.get();
  return NextResponse.json(createdProfile.data(), { status: 201 });
}

export async function PATCH(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const verification = await verifyIdToken(authHeader);

  if (!verification.success) {
    return NextResponse.json({ error: verification.error }, { status: 401 });
  }

  const uid = verification.uid;
  if (!uid) {
    return NextResponse.json({ error: 'Authentication context missing' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.issues.map((issue) => issue.message) },
      { status: 400 },
    );
  }

  if (!adminFirestore) {
    return NextResponse.json({ error: 'Firebase Admin SDK is not configured' }, { status: 500 });
  }

  const db = adminFirestore;
  const userRef = db.collection('users').doc(uid);
  const snapshot = await userRef.get();

  if (!snapshot.exists) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const updateData = {
    ...parsed.data,
    updatedAt: FieldValue.serverTimestamp(),
  };

  await userRef.update(updateData);
  const updatedSnapshot = await userRef.get();
  return NextResponse.json(updatedSnapshot.data());
}

