import { diffOwnedIndexes, syncOwnedIndexes } from '../index-sync';
import { openScriptConnection, runScript } from './script-connection';

/**
 * Deploy step (idempotent): makes the invoice service's Mongo indexes match its schemas. Run it on
 * every deploy that changes an index -- production has autoIndex off, so nothing else builds them.
 *
 *   nx run invoice:sync-indexes                  # apply
 *   nx run invoice:sync-indexes --args=--dry-run # report the drift only
 *
 * Runs under @swc-node/register (not ts-node, like backfill-pdf-keys), which resolves the
 * workspace's @libs/* path aliases -- so the indexes come from the real schemas, never a copy.
 */
runScript(async (dryRun) => {
  const connection = await openScriptConnection();
  try {
    const drift = (await diffOwnedIndexes(connection)).filter((d) => d.toCreate.length || d.toDrop.length);
    if (drift.length === 0) {
      console.log('Indexes match the schemas; nothing to do.');
      return;
    }
    for (const { collection, toCreate, toDrop } of drift) {
      console.log(`${collection}: create ${JSON.stringify(toCreate)}; drop ${JSON.stringify(toDrop)}`);
    }
    if (dryRun) {
      console.log('[dry run] no indexes changed.');
      return;
    }
    await syncOwnedIndexes(connection);
    console.log('Indexes synced.');
  } finally {
    await connection.close();
  }
});
