import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveIdentityFromCookies } from '@/lib/auth';
import { roleForRoadmap } from '@/lib/api-helpers';
import { getStore } from '@/lib/store';
import { SignedOutLanding } from '@/components/SignedOutLanding';

export const dynamic = 'force-dynamic';

/**
 * Login landing (F-5): straight to the last worked-on/visited roadmap;
 * first-time users land on Profile with a create CTA (AC-5.1, AC-5.3).
 */
export default async function Home() {
  const jar = cookies();
  const identity = await resolveIdentityFromCookies((name) => jar.get(name)?.value);

  if (!identity) return <SignedOutLanding />;

  const store = getStore();
  const state = await store.getUserState(identity.uid);

  if (state?.lastRoadmapId) {
    const roadmap = await store.getRoadmap(state.lastRoadmapId);
    if (roadmap && (await roleForRoadmap(identity, roadmap)) !== 'none') {
      redirect(`/roadmaps/${roadmap.id}`);
    }
    redirect('/profile?fallback=1');
  }

  redirect('/profile');
}
