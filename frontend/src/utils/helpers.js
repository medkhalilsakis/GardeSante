import { useUIStore } from '../store';
import translations from './translations';

/**
 * Hook de traduction — retourne une fonction t(key)
 */
export const useTranslation = () => {
  const language = useUIStore((s) => s.language);

  const t = (path, fallback = '') => {
    const keys = path.split('.');
    let value = translations[language];
    for (const key of keys) {
      if (!value) return fallback || path;
      value = value[key];
    }
    return value || fallback || path;
  };

  return { t, language, isArabic: language === 'ar' };
};

/**
 * Formater une date en FR ou AR
 */
export const formatDate = (date, lang = 'fr', options = {}) => {
  if (!date) return '';
  const locale = lang === 'ar' ? 'ar-DZ' : 'fr-FR';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options,
  }).format(new Date(date));
};

/**
 * Obtenir les initiales d'un nom
 */
export const getInitials = (firstName, lastName) => {
  return `${(firstName || '')[0] || ''}${(lastName || '')[0] || ''}`.toUpperCase();
};

/**
 * Obtenir la classe CSS d'un badge selon le statut
 */
export const getStatusBadgeClass = (status) => {
  const map = {
    planned: 'badge-planned',
    confirmed: 'badge-confirmed',
    absent: 'badge-absent',
    replaced: 'badge-replaced',
    completed: 'badge-completed',
    cancelled: 'badge-cancelled',
    draft: 'badge-draft',
    submitted: 'badge-submitted',
    under_review: 'badge-submitted',
    approved: 'badge-approved',
    rejected: 'badge-rejected',
    pending: 'badge-pending',
    active: 'badge-active',
    accepted: 'badge-confirmed',
    critical: 'badge-critical',
    high: 'badge-absent',
    normal: 'badge-planned',
    low: 'badge-cancelled',
  };
  return map[status] || 'badge-cancelled';
};

/**
 * Calculer la durée entre 2 dates en jours
 */
export const daysBetween = (start, end) => {
  const s = new Date(start);
  const e = new Date(end);
  return Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1;
};

/**
 * Export PDF via jsPDF
 */
export const exportToPDF = async (title, headers, rows, fileName) => {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, 14, 26);

  autoTable(doc, {
    startY: 32,
    head: [headers],
    body: rows,
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [27, 79, 202], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  doc.save(`${fileName}.pdf`);
};

/**
 * Export Excel via SheetJS
 */
export const exportToExcel = async (title, headers, rows, fileName) => {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.substring(0, 31));
  XLSX.writeFile(wb, `${fileName}.xlsx`);
};

/**
 * Debounce
 */
export const debounce = (fn, delay) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};
