import type { Client, Creative } from './constants';

// Creative ↔ Client sync rules shared by Tracker, Today and Batch:
// - With a client selected, the picker only offers that client's creatives.
// - Picking a creative auto-sets the client it belongs to.
// - Changing the client clears a creative that belongs to a different client.

export function creativesForClient(creatives: Creative[], clientId?: number): Creative[] {
  if (!clientId) return creatives;
  return creatives.filter(c => c.clientId === clientId);
}

export function clientForCreative(
  creative: Creative | undefined,
  clients: Client[]
): Client | undefined {
  if (!creative?.clientId) return undefined;
  return clients.find(c => c.id === creative.clientId);
}

export function creativeMatchesClient(
  creatives: Creative[],
  creativeId: number | undefined,
  clientId: number
): boolean {
  if (!creativeId) return true;
  const creative = creatives.find(c => c.id === creativeId);
  return !creative?.clientId || creative.clientId === clientId;
}
