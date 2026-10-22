import { backfillMinorUnits } from '../minor-units-backfill';
import { openScriptConnection, runScript } from './script-connection';

/**
 * One-off, idempotent: converts invoices stored with float amounts to integer minor units. Run it
 * with the invoice service stopped, before starting the version that reads minor units.
 *
 *   nx run invoice:backfill-minor-units --args="--dry-run"          # report only
 *   nx run invoice:backfill-minor-units                             # apply
 *   nx run invoice:backfill-minor-units --args="--accept-recomputed" # also rewrite issued invoices
 *                                                                    # whose amounts would change
 *
 * Exits non-zero when anything is left unconverted: the new version can't read those invoices,
 * so the deploy must not continue until a human has looked at the report.
 */
runScript(async (dryRun) => {
  const acceptRecomputed = process.argv.includes('--accept-recomputed');

  const connection = await openScriptConnection();
  try {
    const report = await backfillMinorUnits(connection.db as never, { dryRun, acceptRecomputed });
    console.log(`${dryRun ? '[dry run] would apply' : 'Applied'}:`, JSON.stringify(report, null, 2));

    if (report.draftsRecomputed.length > 0) {
      console.warn(
        `${report.draftsRecomputed.length} draft(s) changed on recompute (listed above); drafts are converted anyway.`,
      );
    }
    const blocked = (acceptRecomputed ? 0 : report.mismatches.length) + report.unconvertible.length;
    if (blocked > 0) {
      const message =
        `${blocked} invoice(s) were not converted: see "mismatches" (issued invoices whose amounts would ` +
        `change -- re-run with --accept-recomputed once reviewed) and "unconvertible".`;
      if (!dryRun) throw new Error(message);
      console.warn(message);
    }
  } finally {
    await connection.close();
  }
});
