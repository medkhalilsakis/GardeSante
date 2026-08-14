const dateKey = (value) => {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
};

const normalizePeriods = (row, fallbackStart = '', fallbackEnd = '') => {
  const hasExplicitPeriods = Array.isArray(row?.periods);
  const source = hasExplicitPeriods
    ? row.periods
    : [{ startDate: row?.periodStart || row?.period_start || fallbackStart, endDate: row?.periodEnd || row?.period_end || fallbackEnd }];

  const periods = source
    .map((period) => ({
      startDate: dateKey(period?.startDate || period?.start || period?.periodStart || period?.period_start),
      endDate: dateKey(period?.endDate || period?.end || period?.periodEnd || period?.period_end),
    }))
    .filter((period) => period.startDate || period.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));

  return periods.filter((period, index) => (
    index === 0
    || period.startDate !== periods[index - 1].startDate
    || period.endDate !== periods[index - 1].endDate
  ));
};

const periodBounds = (periods = []) => ({
  startDate: periods[0]?.startDate || '',
  endDate: periods.at(-1)?.endDate || '',
});

const dateInPeriods = (date, periods = []) => {
  const day = dateKey(date);
  return Boolean(day && periods.some((period) => day >= period.startDate && day <= period.endDate));
};

module.exports = { dateKey, normalizePeriods, periodBounds, dateInPeriods };
