import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveIdentityFromCookies } from '@/lib/auth';
import { SignedOutLanding } from '@/components/SignedOutLanding';

export const dynamic = 'force-dynamic';

/**
 * Landing: always the roadmap chooser (Home). Direct links to
 * /roadmaps/<id> keep working; the previous "jump to last visited roadmap"
 * redirect was dropped so opening the app is predictable (2026-09).
 */
export default async function Home() {
  const jar = cookies();
  const identity = await resolveIdentityFromCookies((name) => jar.get(name)?.value);
  if (!identity) return <SignedOutLanding />;
  redirect('/profile');
}
