import { existsSync } from 'fs';
import { join } from 'path';
import { config as loadDotenv } from 'dotenv';
import { expand } from 'dotenv-expand';
import mongoose from 'mongoose';
import { pdfKeyFromUrl } from './pdf-key-from-url';

/**
 * One-off, idempotent: converts invoices written before PDFs became private from the legacy
 * `pdfUrl` (a permanent public object URL) to `pdfKey`, and removes `pdfUrl`. Documents whose URL
 * can't be parsed are reported and left untouched for a human to look at -- regenerating the PDF
 * (POST /invoices/:id/pdf) also fixes them.
 *
 *   nx run invoice:backfill-pdf-keys              # apply
 *   nx run invoice:backfill-pdf-keys --args=--dry-run
 *
 * Self-contained (plain process.env + dotenv, no @libs/* aliases), like apps/user-access's
 * data-source.ts: ts-node doesn't have the workspace's path aliases.
 */
const workspaceRoot = join(__dirname, '../../../../..');
const nodeEnv = process.env['NODE_ENV'] ?? 'development';
if (nodeEnv !== 'production') {
  for (const file of ['.env', `.env.${nodeEnv === 'development' ? 'dev' : nodeEnv}`]) {
    const path = join(workspaceRoot, file);
    if (existsSync(path)) expand(loadDotenv({ path }));
  }
}

async function backfill(dryRun: boolean): Promise<void> {
  const uri = process.env['MONGODB_URI'];
  if (!uri) throw new Error('MONGODB_URI is not set.');

  const connection = await mongoose
    .createConnection(uri, { directConnection: process.env['MONGODB_DIRECT_CONNECTION'] === 'true' })
    .asPromise();
  const invoices = connection.collection('invoices');

  let converted = 0;
  const unparseable: string[] = [];
  try {
    const cursor = invoices.find({ pdfUrl: { $exists: true } }, { projection: { pdfUrl: 1, pdfKey: 1 } });
    for await (const doc of cursor) {
      // A document that already has a key keeps it: that key is from a newer render.
      const key = (doc['pdfKey'] as string | undefined) ?? pdfKeyFromUrl(String(doc['pdfUrl']));
      if (!key) {
        unparseable.push(String(doc._id));
        continue;
      }
      if (!dryRun) {
        await invoices.updateOne({ _id: doc._id }, { $set: { pdfKey: key }, $unset: { pdfUrl: '' } });
      }
      converted += 1;
    }
  } finally {
    await connection.close();
  }

  console.log(`${dryRun ? '[dry run] would convert' : 'Converted'} ${converted} invoice(s) from pdfUrl to pdfKey.`);
  if (unparseable.length > 0) {
    console.warn(`Left ${unparseable.length} invoice(s) untouched (pdfUrl not recognised): ${unparseable.join(', ')}`);
  }
}

backfill(process.argv.includes('--dry-run')).catch((error: unknown) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
