import { NextResponse } from 'next/server';

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(
    { data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
