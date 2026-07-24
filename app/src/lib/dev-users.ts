import type { Identity } from './types';

/**
 * Named identities for the DEV_AUTH user switcher (local testing only — never
 * used when the app authenticates through LabOS in production). The first
 * entry is the default used when no `dev_user` cookie is present. uids are
 * stable so each user's roadmaps persist in the store across switches, which
 * is what makes it possible to test sharing between two people locally: create
 * as Dev One, share the invite link, switch to Dev Two, and join.
 */
export const DEV_USERS: Identity[] = [
  { uid: 'dev-owner', name: 'Dev One', email: 'dev1@dev.test' },
  { uid: 'dev-two', name: 'Dev Two', email: 'dev2@dev.test' },
];
