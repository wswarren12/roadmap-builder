'use client';

import { memberProfileUrl, teamProfileUrl } from '@/lib/team';
import { Avatar } from './Avatar';

/**
 * Assignment display (F-13b). A person or team that resolved to a LabOS
 * profile renders as a link to that profile; one that did not (a manually
 * added person, a free-typed legacy value, or a roster row whose LabOS link
 * was never captured) renders as plain text and says so, rather than linking
 * somewhere that would 404.
 *
 * The app is framed by the LabOS portal, so profile links open in a new tab
 * instead of navigating the iframe away from the roadmap.
 */
function ProfileAnchor({
  href,
  label,
  unavailableHint,
  className,
  testId,
  children,
}: {
  href: string | null;
  label: string;
  unavailableHint: string;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <span className={className} title={unavailableHint} data-testid={testId} data-linked="false">
        {children}
      </span>
    );
  }
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${label} · open LabOS profile`}
      data-testid={testId}
      data-linked="true"
    >
      {children}
    </a>
  );
}

/** One assigned person: avatar + name, linked to their LabOS profile. */
export function PersonLink({
  name,
  image,
  uid,
  size = 20,
  showAvatar = true,
  testId,
}: {
  name: string;
  image: string | null;
  uid: string | null;
  size?: number;
  showAvatar?: boolean;
  testId?: string;
}) {
  return (
    <ProfileAnchor
      href={memberProfileUrl(uid)}
      label={name}
      unavailableHint={`${name} · no linked LabOS profile`}
      className="profile-link"
      testId={testId}
    >
      {showAvatar && <Avatar name={name} image={image} size={size} />}
      <span className="profile-link-name">{name}</span>
    </ProfileAnchor>
  );
}

/** The responsible team, linked to its LabOS team page when one was picked. */
export function TeamLink({
  name,
  uid,
  testId,
}: {
  name: string;
  uid: string | null;
  testId?: string;
}) {
  return (
    <ProfileAnchor
      href={teamProfileUrl(uid)}
      label={name}
      unavailableHint={`${name} · no linked LabOS team`}
      className="profile-link"
      testId={testId}
    >
      <span className="profile-link-name">{name}</span>
    </ProfileAnchor>
  );
}
