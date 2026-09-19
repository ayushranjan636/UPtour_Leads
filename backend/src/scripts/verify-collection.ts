/**
 * One-off verification: does the Data Collector actually pull real data from
 * Google Maps?
 *
 * Runs inside a standalone Nest context so the API key is loaded by
 * ConfigModule exactly as it is in production — the key is never passed on a
 * command line, printed, or otherwise exposed.
 *
 * Usage:  node dist/scripts/verify-collection.js
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { GooglePlacesProvider } from '../modules/collection/google-places.provider';

async function main() {
  const logger = new Logger('VerifyCollection');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const places = app.get(GooglePlacesProvider);

    if (!places.isConfigured()) {
      logger.error('GOOGLE_MAPS_API_KEY is not configured — cannot verify.');
      process.exitCode = 1;
      return;
    }

    const textQuery = process.argv[2] ?? 'travel agency in Tokyo, Japan';
    console.log(`\nQuerying Google Places: "${textQuery}"\n`);

    const { places: results, nextPageToken } = await places.searchText({
      textQuery,
      pageSize: 5,
    });

    console.log(`Google returned ${results.length} place(s).`);
    console.log(`More pages available: ${nextPageToken ? 'yes' : 'no'}\n`);

    for (const p of results) {
      console.log(`  ${p.name}`);
      console.log(`    phone   : ${p.phone ?? '(none listed)'}`);
      console.log(`    address : ${p.address ?? '(none)'}`);
      console.log(`    website : ${p.website ?? '(none)'}`);
      console.log(`    placeId : ${p.placeId}`);
      console.log(`    rating  : ${p.rating ?? 'n/a'} (${p.userRatingCount ?? 0} reviews)`);
      console.log('');
    }

    const withPhone = results.filter((p) => p.phone).length;
    console.log(
      `${withPhone}/${results.length} have a phone number (usable for WhatsApp outreach).`,
    );
    console.log('\nRESULT: Google Maps collection is WORKING.\n');
  } catch (err) {
    console.error(`\nRESULT: collection FAILED — ${(err as Error).name}`);
    console.error(`${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
