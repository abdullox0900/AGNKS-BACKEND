import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { installBigIntJsonSupport, installProcessGuards } from './bootstrap-common';

// Dev-only: self-signed HTTPS so phones on the LAN can reach the API without
// a "mixed content" block when the webapps also run over https (needed for
// camera/getUserMedia access). Generate certs with:
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout apps/api/certs/dev-key.pem \
//     -out apps/api/certs/dev-cert.pem -days 365 -subj "/CN=agnks-dev" \
//     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:<your-lan-ip>"
function loadDevHttpsOptions(logger: Logger) {
  const certPath = join(__dirname, '..', 'certs', 'dev-cert.pem');
  const keyPath = join(__dirname, '..', 'certs', 'dev-key.pem');
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    logger.warn('DEV_HTTPS=true but certs/dev-{cert,key}.pem not found — falling back to HTTP');
    return undefined;
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

async function bootstrap() {
  installBigIntJsonSupport();
  const logger = new Logger('Bootstrap');
  installProcessGuards(logger);

  const useDevHttps = process.env.DEV_HTTPS === 'true';
  const httpsOptions = useDevHttps ? loadDevHttpsOptions(logger) : undefined;

  const app = await NestFactory.create(AppModule, { bufferLogs: true, httpsOptions });
  const config = app.get(ConfigService);

  // The API and its frontends (client webapp, cashier webapp, dashboard) intentionally
  // live on different origins — cross-origin embedding (e.g. <img> for receipt photos)
  // must be allowed, so the default same-origin resource policy would break that.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  // API responses are per-actor and change frequently (balance, shift state, etc.) —
  // never let the browser or an intermediary cache/reuse them across requests.
  app.use((_req: import('express').Request, res: import('express').Response, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const corsOrigins = config.get<string>('CORS_ORIGINS', '').split(',').filter(Boolean);
  app.enableCors({ origin: corsOrigins.length > 0 ? corsOrigins : true, credentials: true });

  const prefix = config.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(prefix, { exclude: ['health', 'health/ready'] });

  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`AGNKS API listening on ${httpsOptions ? 'https' : 'http'}://0.0.0.0:${port}/${prefix}`);
}

bootstrap();
