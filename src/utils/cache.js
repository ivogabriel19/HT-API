import NodeCache from 'node-cache';

// Shared cache instance for the whole process.
// TTL is set per-entry at the call site (cache.set(key, val, ttlSeconds)).
export const cache = new NodeCache({ useClones: false });
