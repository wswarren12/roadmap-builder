import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Health contract for the LabOS sandbox. Reports 503 when the app would run
 * on the in-memory store outside dev (Supabase env missing and DEV_AUTH not
 * set): a memory-backed production container looks like a working app while
 * every write evaporates on restart — LabOS must treat that deploy as failed
 * rather than route members to it (2026-08-15 incident: a container came up
 * without injected secrets and served an empty app; items "created" there
 * never reached the database).
 */
export function GET() {
  const misconfigured =
    process.env.DEV_AUTH !== '1' &&
    !process.env.DATABASE_URL &&
    !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (misconfigured) {
    return NextResponse.json(
      { status: 'error', reason: 'database not configured' },
      { status: 503 },
    );
  }
  return NextResponse.json({ status: 'ok' });
}
