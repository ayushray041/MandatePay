import { z } from 'zod';
import { NextResponse } from 'next/server';
import { adminAuth, adminFirestore } from '@/lib/firebase/admin';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase-admin/firestore';

// Zod schemas
const profileSchema = z.object({
  displayName: z.string().min(1).max(100),
});

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const verification = await verifyToken(authHeader);
  if (!verification.success) {
    return NextResponse.json({ error: verification.error }, { status: 401 });
  }
  const { uid } = verification;
  const profileRef = doc(adminFirestore, 'users', uid);
  const snap = await getDoc(profileRef);
  if (!snap.exists()) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }
  return NextResponse.json(snap.data());
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const verification = await verifyToken(authHeader);
  if (!verification.success) {
    return NextResponse.json({ error: verification.error }, { status: 401 });
  }
  const { uid, email } = verification;

  const body = await request.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.format() }, { status: 400 });
  }
  const profileRef = doc(adminFirestore, 'users', uid);
  const snap = await getDoc(profileRef);
  if (snap.exists()) {
    return NextResponse.json({ error: 'Profile already exists' }, { status: 400 });
  }
  const data = {
    uid,
    email,
    displayName: parsed.data.displayName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(profileRef, data);
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const verification = await verifyToken(authHeader);
  if (!verification.success) {
    return NextResponse.json({ error: verification.error }, { status: 401 });
  }
  const { uid } = verification;
  const body = await request.json();
  const parsed = profileSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.format() }, { status: 400 });
  }
  const profileRef = doc(adminFirestore, 'users', uid);
  const snap = await getDoc(profileRef);
  if (!snap.exists()) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }
  const updateData = { ...parsed.data, updatedAt: serverTimestamp() };
  await updateDoc(profileRef, updateData);
  const updatedSnap = await getDoc(profileRef);
  return NextResponse.json(updatedSnap.data());
}

// Helper verification function
async function verifyToken(authHeader: string | null): Promise<{ success: boolean; uid?: string; email?: string; error?: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Missing or malformed Authorization header' };
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { success: true, uid: decoded.uid, email: decoded.email };
  } catch (e: any) {
    return { success: false, error: e.message ?? 'Invalid token' };
  }
}
