import React from 'react';
import { BarChart3 } from 'lucide-react';
import { useAuthStore } from '../../store';
import { GsPageHeader } from '../../components/gs';
import ScopedStatsPanel from '../../components/statistics/ScopedStatsPanel';
import './statistics.css';

export default function StatisticsPage() {
  const { user } = useAuthStore();
  return (
    <div className="gss-wrap">
      <GsPageHeader
        eyebrow="Pilotage analytique"
        title="Statistiques"
        subtitle="Une lecture par portée des gardes enregistrées dans les tableurs, sans agrégat provenant de la table historique des shifts."
        meta={[{ label: 'Établissement', value: user?.establishmentName || 'Plateforme' }]}
        actions={<span className="gss-readonly"><BarChart3 size={14} /> Lecture seule</span>}
      />
      <ScopedStatsPanel title="Synthèse de votre périmètre" showExports />
    </div>
  );
}
