import type { StaffRole } from '@agnks/types';

export type ActorKind = 'client' | 'staff';

export interface ClientActor {
  kind: 'client';
  userId: string;
  cardId: string;
  tgUserId: number;
}

export interface StaffActor {
  kind: 'staff';
  userId: string;
  role: StaffRole;
  stationId: string | null;
  terminalIds: string[];
}

export type Actor = ClientActor | StaffActor;

declare module 'express' {
  interface Request {
    actor?: Actor;
  }
}
