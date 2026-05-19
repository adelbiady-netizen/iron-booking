import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg }     from '@prisma/adapter-pg';

dotenv.config();

const RESTAURANT_ID = '25be8dc0-9d68-4811-b4c2-c4e0e0206baa';

async function verify() {
  const connectionString = process.env.DATABASE_URL!;
  const adapter = new PrismaPg({ connectionString });
  const prisma  = new PrismaClient({ adapter, log: ['error'] });

  try {
    // 1. Guest search — Hebrew name
    const byName = await prisma.guest.findMany({
      where:  { restaurantId: RESTAURANT_ID, firstName: { contains: 'ג', mode: 'insensitive' } },
      select: { firstName: true, lastName: true, phone: true, email: true },
      take:   3,
    });
    console.log('1. Guest search (firstName contains "ג"):');
    byName.forEach(g =>
      console.log(`     ${g.firstName} ${g.lastName} | ${g.phone}${g.email ? ' | ' + g.email : ''}`)
    );
    console.log(`   → ${byName.length} result(s) returned`);

    // 2. Caller-ID lookup — simulate incoming +972 call normalized to 05X
    const callerRaw  = '+972505586719';
    const normalized = '0' + callerRaw.slice(4).replace(/\D/g, '');
    const byPhone = await prisma.guest.findFirst({
      where:  { restaurantId: RESTAURANT_ID, phone: normalized },
      select: { firstName: true, lastName: true, phone: true, email: true },
    });
    console.log(`\n2. Caller-ID lookup (${callerRaw} → ${normalized}):`);
    console.log(byPhone
      ? `     MATCHED: ${byPhone.firstName} ${byPhone.lastName} | ${byPhone.phone}`
      : '     NOT FOUND');

    // 3. Reservation autocomplete — partial phone prefix
    const partial = '05045';
    const byPartial = await prisma.guest.findMany({
      where:  { restaurantId: RESTAURANT_ID, phone: { startsWith: partial } },
      select: { firstName: true, lastName: true, phone: true },
      take:   3,
    });
    console.log(`\n3. Autocomplete partial phone (${partial}...):`);
    byPartial.forEach(g => console.log(`     ${g.firstName} ${g.lastName} | ${g.phone}`));
    console.log(`   → ${byPartial.length} result(s)`);

    // 4. Duplicate phone check
    type DupeRow = { phone: string; cnt: bigint };
    const dupes = await prisma.$queryRaw<DupeRow[]>`
      SELECT phone, COUNT(*) AS cnt
      FROM guests
      WHERE "restaurantId" = ${RESTAURANT_ID}
        AND phone IS NOT NULL
      GROUP BY phone
      HAVING COUNT(*) > 1
      LIMIT 5
    `;
    console.log('\n4. Duplicate phone check:');
    if (dupes.length === 0) {
      console.log('     CLEAN — no duplicate phones');
    } else {
      console.log(`     WARNING: ${dupes.length} duplicate phone(s) found:`);
      dupes.forEach(d => console.log(`     ${d.phone}  (count: ${d.cnt})`));
    }

    // 5. Email search
    const byEmail = await prisma.guest.findFirst({
      where:  { restaurantId: RESTAURANT_ID, email: { contains: 'gmail.com' } },
      select: { firstName: true, lastName: true, phone: true, email: true },
    });
    console.log('\n5. Email search (contains "gmail.com"):');
    console.log(byEmail
      ? `     ${byEmail.firstName} ${byEmail.lastName} | ${byEmail.phone} | ${byEmail.email}`
      : '     No gmail.com email found');

  } finally {
    await prisma.$disconnect();
  }
}

verify().catch(err => {
  console.error('Verify error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
