/**
 * Kit partagé — point d'entrée
 * ════════════════════════════
 * Les neuf assemblages que chaque écran de la plateforme redessinait à la main.
 * Écrits une fois, consommés par les phases suivantes ; rien d'existant n'a été
 * modifié pour les créer.
 *
 * ```jsx
 * import { GsPageHeader, GsPanel, GsStat, GsStatRail, GsTabRail,
 *          GsTable, GsBadge, GsFilterBar, GsEmpty, GsSkeleton } from '../../components/gs';
 * ```
 *
 * Ce qu'ils ne remplacent pas, volontairement : `PlanningStateBadge` (il connaît
 * les états d'un planning), `ContextBadge`, `PortfolioGrid`, `NotesFeed`,
 * `ScopedStatsPanel`, `StaffLoanStatsPanel`, `HospitalGuardCalendar`. Ces
 * composants portent une logique métier et sont réutilisés tels quels.
 *
 * Les boutons (`.gs-btn`), le surtitre (`.gs-eyebrow`), le titre (`.gs-title`)
 * et les chiffres tabulaires (`.gs-num`) restent des classes de
 * `styles/gardesante-design.css` : une classe suffit, un composant serait de
 * l'emballage.
 */

export { default as GsPageHeader } from './GsPageHeader';
export { default as GsPanel, GsPanelHeader } from './GsPanel';
export { default as GsStat, GsStatRail } from './GsStat';
export { default as GsTabRail } from './GsTabRail';
export { default as GsTable } from './GsTable';
export { default as GsBadge } from './GsBadge';
export { default as GsFilterBar } from './GsFilterBar';
export { default as GsEmpty } from './GsEmpty';
export { default as GsSkeleton } from './GsSkeleton';
