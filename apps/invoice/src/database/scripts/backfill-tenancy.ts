import { backfillTenancy } from '../tenancy-backfill';
import { openScriptConnection, runScript } from './script-connection';

/**
 * One-off, idempotent: moves pre-tenancy invoices into the default organization. Run it with the
 * invoice service stopped, after user-access's migrations, then `nx run invoice:sync-indexes`.
 *
 *   nx run invoice:backfill-tenancy                       # apply
 *   nx run invoice:backfill-tenancy --args="--dry-run"
 *   nx run invoice:backfill-tenancy --args="--prefix=ACME" # if the default org's prefix isn't INV
 */
runScript(async (dryRun) => {
  const prefixArg = process.argv.find((arg) => arg.startsWith('--prefix='));
  const prefix = prefixArg ? prefixArg.slice('--prefix='.length) : 'INV';

  const connection = await openScriptConnection();
  try {
    const report = await backfillTenancy(connection.db as never, { dryRun, prefix });
    console.log(`${dryRun ? '[dry run] would apply' : 'Applied'}:`, JSON.stringify(report, null, 2));
    if (report.draftNumbersDropped.length > 0) {
      console.warn(
        `These drafts already had a reference, so their old client-chosen number was dropped ` +
          `(drafts are numbered on issue now): ${report.draftNumbersDropped.join(', ')}`,
      );
    }
  } finally {
    await connection.close();
  }
});
