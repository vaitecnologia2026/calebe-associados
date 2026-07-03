import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const db = new PrismaClient();

const associates = await db.associate.findMany({
  where: { status: 'APPROVED' },
  select: {
    id: true,
    phone: true,
    whatsapp: true,
    user: { select: { name: true } }
  }
});

console.log(`Total ativos: ${associates.length}`);

function cleanPhone(raw) {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length === 12 || d.length === 13) return d;
  return null;
}

function getFirstName(fullName) {
  if (!fullName) return 'Corretor';
  const p = fullName.trim().split(/\s+/);
  return p[0] || 'Corretor';
}

const targets = associates
  .map(a => ({
    id: a.id,
    phone: cleanPhone(a.whatsapp || a.phone),
    name: getFirstName(a.user?.name)
  }))
  .filter(t => t.phone !== null);

const sem = associates.filter(a => !cleanPhone(a.whatsapp || a.phone)).length;
console.log(`Com telefone válido: ${targets.length}`);
console.log(`Sem telefone: ${sem}`);
console.log('\nAmostra:');
targets.slice(0, 8).forEach(t => console.log(`  ${t.name.padEnd(15)} → ${t.phone}`));

fs.writeFileSync('/tmp/calebe_app_targets.json', JSON.stringify(targets, null, 2));
console.log(`\n✅ Lista salva: /tmp/calebe_app_targets.json`);

await db.$disconnect();
