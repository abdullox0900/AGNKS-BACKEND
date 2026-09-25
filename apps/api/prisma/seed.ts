import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';

const prisma = new PrismaClient();

async function main() {
  const station = await prisma.station.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'AGNKS №4 — Chilonzor',
      address: "Chilonzor tumani, Bunyodkor shoh ko'chasi 3",
      lat: 41.2799,
      lng: 69.2069,
      radiusM: 300,
    },
  });

  const terminal = await prisma.terminal.upsert({
    where: { code: 'DEMO-TERMINAL-1' },
    update: {},
    create: { stationId: station.id, code: 'DEMO-TERMINAL-1', label: 'Kassa 1' },
  });

  const passwordHash = await argon2.hash('admin12345');
  const totpSecret = authenticator.generateSecret();

  const rootAdmin = await prisma.user.upsert({
    where: { phone: '+998900000001' },
    update: {},
    create: { phone: '+998900000001', firstName: 'Root Admin' },
  });
  const existingRootRole = await prisma.userRole.findFirst({ where: { userId: rootAdmin.id, role: 'root_admin' } });
  if (!existingRootRole) {
    await prisma.userRole.create({ data: { userId: rootAdmin.id, role: 'root_admin', terminalIds: [] } });
  }
  await prisma.staffCredentials.upsert({
    where: { userId: rootAdmin.id },
    update: { passwordHash, totpSecret: encryptPlaceholder(totpSecret) },
    create: { userId: rootAdmin.id, passwordHash, totpSecret: encryptPlaceholder(totpSecret) },
  });

  const cashierPin = '135790';
  const pinHash = await argon2.hash(cashierPin);
  const cashier = await prisma.user.upsert({
    where: { phone: '+998900000002' },
    update: {},
    create: { phone: '+998900000002', firstName: 'Aziz Karimov' },
  });
  const existingCashierRole = await prisma.userRole.findFirst({ where: { userId: cashier.id, role: 'cashier' } });
  if (!existingCashierRole) {
    await prisma.userRole.create({
      data: { userId: cashier.id, role: 'cashier', stationId: station.id, terminalIds: [terminal.id] },
    });
  }
  await prisma.staffCredentials.upsert({
    where: { userId: cashier.id },
    update: { pinHash },
    create: { userId: cashier.id, pinHash },
  });

  console.log('--- Seed complete ---');
  console.log(`Station: ${station.name} (${station.id})`);
  console.log(`Terminal code (use in a test receipt QR): ${terminal.code}`);
  console.log(`Root admin phone: +998900000001 / password: admin12345`);
  console.log(`Root admin TOTP secret (add to an authenticator app): ${totpSecret}`);
  console.log(`Cashier phone: +998900000002 / PIN: ${cashierPin}`);
}

// NOTE: this mirrors CryptoService's scheme but is deliberately inlined here so the
// seed script has no NestJS DI dependency. Keep both in sync if the cipher ever changes.
function encryptPlaceholder(secret: string): string {
  const { createCipheriv, createHash, randomBytes } = require('node:crypto') as typeof import('node:crypto');
  const key = createHash('sha256').update(process.env.ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || 'dev-secret').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
