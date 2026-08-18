const day = 24 * 60 * 60 * 1000;

export function getExpiryStatus(expiryDate, today = dateOnly(new Date())) {
  const diff = Math.round((parseDate(expiryDate) - parseDate(today)) / day);
  if (diff < 0) return 'expired';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'soon';
  return 'normal';
}

export function dateOnly(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const date = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

function parseDate(value) {
  const [year, month, date] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}
