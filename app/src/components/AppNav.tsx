'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NavBar } from '@pl/components/NavBar';
import { Button } from '@pl/components/Button';
import { api } from '@/lib/client/api';
import { DEV_USERS } from '@/lib/dev-users';
import { NewRoadmapModal } from './NewRoadmapModal';

/** Switch the active DEV_AUTH identity by setting the `dev_user` cookie the
 *  server reads, then hard-reload so every server component re-resolves. */
function switchDevUser(user: { uid: string; name: string; email: string | null }) {
  const value = encodeURIComponent(JSON.stringify(user));
  document.cookie = `dev_user=${value}; path=/; max-age=31536000`;
  window.location.assign('/');
}

export function AppNav() {
  const pathname = usePathname();
  const [me, setMe] = useState<{ name: string; email: string | null } | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const identityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ user: { uid: string; name: string; email: string | null }; devMode?: boolean }>(
      '/api/me',
    )
      .then((res) => {
        setMe(res.user);
        setUid(res.user.uid);
        setDevMode(Boolean(res.devMode));
      })
      .catch(() => setMe(null));
  }, []);

  // Identity popover: dismiss on outside click or Escape.
  useEffect(() => {
    if (!identityOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (identityRef.current && !identityRef.current.contains(e.target as Node)) {
        setIdentityOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setIdentityOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [identityOpen]);

  return (
    <>
      <NavBar
        // NavBar wraps the logo in its own anchor — pass content only, never a Link.
        logo={
          <span className="nav-logo">
            <span className="nav-logo-mark" aria-hidden="true" />
            Roadmapper
          </span>
        }
        logoHref="/"
        items={[
          { label: 'Home', href: '/profile', active: pathname === '/profile' },
          { label: 'Backlog', href: '/backlog', active: pathname === '/backlog' },
        ]}
        userName={me?.name}
        onAvatarClick={() => setIdentityOpen((open) => !open)}
        actions={
          me ? (
            <Button
              variant="primary"
              styleType="fill"
              size="sm"
              onClick={() => setCreating(true)}
              data-testid="new-roadmap"
            >
              New roadmap
            </Button>
          ) : undefined
        }
      />
      {identityOpen && (
        <div className="identity-popover" ref={identityRef} data-testid="identity-popover">
          <span className="identity-name">{me ? me.name : 'Not signed in'}</span>
          <span className="identity-email">
            {me
              ? me.email ?? 'No email is available from LabOS yet.'
              : 'Open this app from the PL dashboard to sign in.'}
          </span>

          {devMode && (
            <div className="identity-switcher" data-testid="dev-user-switcher">
              <span className="identity-switcher-label">Switch dev user</span>
              {DEV_USERS.map((user) => (
                <button
                  key={user.uid}
                  type="button"
                  className="identity-switch-btn"
                  aria-current={uid === user.uid}
                  disabled={uid === user.uid}
                  onClick={() => switchDevUser(user)}
                  data-testid={`switch-${user.uid}`}
                >
                  {user.name}
                  {uid === user.uid && <span className="identity-switch-active"> ✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {creating && <NewRoadmapModal open onOpenChange={setCreating} />}
    </>
  );
}
