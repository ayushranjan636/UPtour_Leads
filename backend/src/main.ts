import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true is REQUIRED — the OpenWA webhook controller verifies an
  // HMAC-SHA256 signature over the exact raw payload. Without it,
  // `req.rawBody` is undefined and every inbound webhook is rejected 401,
  // which kills the entire inbound half of the pipeline (replies, acks,
  // AI analysis, lead creation, opt-outs).
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Global prefix
  app.setGlobalPrefix('api');

  // CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('UP Heritage Tours API')
    .setDescription('B2B WhatsApp Outreach + CRM Platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.APP_PORT || 3000;
  await app.listen(port);
  console.log(`
  ┌─────────────────────────────────────────────────┐
  │       UP HERITAGE TOURS — API Server             │
  │                                                  │
  │  API:     http://localhost:${port}/api            │
  │  Swagger: http://localhost:${port}/api/docs       │
  │  Health:  http://localhost:${port}/api/health      │
  └─────────────────────────────────────────────────┘
  `);
}
bootstrap();
