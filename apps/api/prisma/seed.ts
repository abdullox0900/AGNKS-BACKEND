import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Seed. By default it only makes sure a root admin exists (safe on a real server):
 *
 *   SEED_ADMIN_PHONE     +998XXXXXXXXX   (default +998900000001)
 *   SEED_ADMIN_PASSWORD  required when NODE_ENV=production (local default: admin12345)
 *   SEED_ADMIN_NAME      default "Root Admin"
 *   SEED_ADMIN_ROLE     root_admin (default, view-only) | seo (full access)
 *   SEED_DEMO=1          also creates a demo station, terminal and cashier (local testing only)
 *
 * An existing admin with the same phone is left alone unless SEED_RESET_PASSWORD=1.
 * Login uses the FIRST dashboard role it finds, so give a seo account its own phone number.
 */
const prisma = new PrismaClient();

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  const phone = process.env.SEED_ADMIN_PHONE ?? '+998900000001';
  const role = process.env.SEED_ADMIN_ROLE ?? 'root_admin';
  if (role !== 'root_admin' && role !== 'seo') throw new Error('SEED_ADMIN_ROLE must be root_admin or seo');
  const name = process.env.SEED_ADMIN_NAME ?? (role === 'seo' ? 'SEO' : 'Root Admin');
  const password = process.env.SEED_ADMIN_PASSWORD ?? (isProd ? '' : 'admin12345');
  if (!/^\+998\d{9}$/.test(phone)) throw new Error('SEED_ADMIN_PHONE must look like +998901234567');
  if (password.length < 6) throw new Error('SEED_ADMIN_PASSWORD is required (min 6 chars) when NODE_ENV=production');

  const admin = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, firstName: name },
  });
  const hasRole = await prisma.userRole.findFirst({ where: { userId: admin.id, role } });
  if (!hasRole) await prisma.userRole.create({ data: { userId: admin.id, role, terminalIds: [] } });

  const creds = await prisma.staffCredentials.findUnique({ where: { userId: admin.id } });
  if (!creds?.passwordHash || process.env.SEED_RESET_PASSWORD === '1') {
    const data = { passwordHash: await argon2.hash(password), passwordEnc: encrypt(password) };
    await prisma.staffCredentials.upsert({
      where: { userId: admin.id },
      update: { ...data, failedAttempts: 0, lockedUntil: null },
      create: { userId: admin.id, ...data },
    });
    console.log(`${role} ${phone}: password set.`);
  } else {
    console.log(`${role} ${phone} already has a password — left unchanged (SEED_RESET_PASSWORD=1 to reset).`);
  }

  if (process.env.SEED_DEMO === '1') await seedDemo();
  console.log('--- Seed complete ---');
}

async function seedDemo() {
  const station = await prisma.station.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Demo shoxobcha',
      address: "Toshkent, Chilonzor",
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

  const cashierPassword = '135790';
  const cashier = await prisma.user.upsert({
    where: { phone: '+998900000002' },
    update: {},
    create: { phone: '+998900000002', firstName: 'Demo Kassir' },
  });
  const hasRole = await prisma.userRole.findFirst({ where: { userId: cashier.id, role: 'cashier' } });
  if (!hasRole) {
    await prisma.userRole.create({ data: { userId: cashier.id, role: 'cashier', stationId: station.id, terminalIds: [terminal.id] } });
  }
  const data = { pinHash: await argon2.hash(cashierPassword), passwordEnc: encrypt(cashierPassword) };
  await prisma.staffCredentials.upsert({ where: { userId: cashier.id }, update: data, create: { userId: cashier.id, ...data } });
  console.log(`Demo: station "${station.name}", terminal ${terminal.code}, cashier +998900000002 / ${cashierPassword}`);
}

// Mirrors CryptoService (AES-256-GCM, key from ENCRYPTION_KEY or JWT_ACCESS_SECRET) without NestJS DI.
// Keep both in sync if the cipher ever changes.
function encrypt(secret: string): string {
  const { createCipheriv, createHash, randomBytes } = require('node:crypto') as typeof import('node:crypto');
  const key = createHash('sha256').update(process.env.ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || 'dev-secret').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
