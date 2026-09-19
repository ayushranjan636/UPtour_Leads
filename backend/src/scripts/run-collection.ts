/**
 * Runs a real collection job end-to-end (Google Maps → companies/contacts/results).
 *
 * Runs inside a standalone Nest context so the API key is loaded by ConfigModule
 * exactly as in production and never touches a command line.
 *
 * Usage:  node dist/scripts/run-collection.js "<job name>"
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CollectionRunnerService } from '../modules/collection/collection-runner.service';
import { CollectionJob } from '../entities/collection-job.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const jobName = process.argv[2] ?? 'Japan Buddhist Agencies';
    const repo = app.get<Repository<CollectionJob>>(
      getRepositoryToken(CollectionJob),
    );
    const runner = app.get(CollectionRunnerService);

    const job = await repo.findOne({ where: { name: jobName } });
    if (!job) {
      console.error(`No collection job named "${jobName}".`);
      process.exitCode = 1;
      return;
    }

    console.log(`\nRunning "${job.name}" — ${job.city}, ${job.country}`);
    console.log(`Limit: ${job.daily_limit} new contacts\n`);

    const summary = await runner.executeJob(job);

    console.log('\n--- SUMMARY ---');
    console.log(`imported   : ${summary.imported}`);
    console.log(`duplicates : ${summary.duplicates}`);
    console.log(`invalid    : ${summary.invalid} (no usable phone)`);
    console.log(`scanned    : ${summary.scanned}`);
    console.log(`API calls  : ${summary.requests}`);
    console.log(`exhausted  : ${summary.exhausted}`);
  } catch (err) {
    console.error(`\nFAILED — ${(err as Error).name}: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
