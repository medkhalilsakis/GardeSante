const { query } = require('../config/database');

async function reseed() {
  try {
    await query('DELETE FROM public_holidays WHERE year = 2026');
    const holidays = [
      { name: 'Nouvel An', start: '2026-01-01', end: '2026-01-01', category: 'national' },
      { name: 'Fête de la Révolution & Jeunesse', start: '2026-01-14', end: '2026-01-14', category: 'national' },
      { name: 'Fête de l\'Indépendance', start: '2026-03-20', end: '2026-03-20', category: 'national' },
      { name: 'Aïd el-Fitr', start: '2026-03-20', end: '2026-03-22', category: 'religious' },
      { name: 'Fête des Martyrs', start: '2026-04-09', end: '2026-04-09', category: 'national' },
      { name: 'Fête du Travail', start: '2026-05-01', end: '2026-05-01', category: 'national' },
      { name: 'Aïd el-Adha', start: '2026-05-27', end: '2026-05-29', category: 'religious' },
      { name: 'Fête de la République', start: '2026-07-25', end: '2026-07-25', category: 'national' },
      { name: 'Fête Nationale de la Femme', start: '2026-08-13', end: '2026-08-13', category: 'national' },
      { name: 'Mouled', start: '2026-08-26', end: '2026-08-26', category: 'religious' },
      { name: 'Fête de l\'Évacuation', start: '2026-10-15', end: '2026-10-15', category: 'national' }
    ];

    for (const h of holidays) {
      await query(
        `INSERT INTO public_holidays (name, start_date, end_date, year, category, is_recurring, multiplier)
         VALUES ($1, $2, $3, 2026, $4, TRUE, 1.5)`,
        [h.name, h.start, h.end, h.category]
      );
    }
    console.log('✅ 2026 Holidays clean re-seeded!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Reseed error:', err);
    process.exit(1);
  }
}

reseed();
