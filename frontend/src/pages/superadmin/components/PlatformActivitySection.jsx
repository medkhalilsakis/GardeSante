/**
 * Activité réelle de la plateforme (Lot X3) — Super Admin.
 *
 * Les statistiques du tableau de bord ne comptaient que des établissements et des
 * comptes : rien du travail réellement fait sur la plateforme. Ce panneau affiche
 * les chiffres du terrain, tous calculés côté serveur par
 * `admin-platform.controller.js` :
 *
 *   • les gardes sont lues dans `schedules.metadata.spreadsheet` — la table
 *     `shifts` n'est pas alimentée par le flux tableur et renverrait zéro ;
 *   • les plannings sont classés par `planning_state()`, la même fonction SQL que
 *     les badges d'état affichés partout ailleurs ;
 *   • la date de référence est celle du **serveur** (`data.today`), jamais une
 *     date reconstruite dans le navigateur.
 *
 * Fichier NEUF, en lecture seule. Le panneau existant `StatsSection` n'est pas
 * modifié : il garde ses graphiques d'annuaire, celui-ci s'affiche au-dessus.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Building2, CalendarCheck, CalendarDays, CheckCircle2,
  ClipboardList, Clock3, FileText, Home, Layers, RefreshCw, Repeat2, ScrollText,
  ShieldCheck, Stethoscope, UserCheck, UserX, Users,
} from 'lucide-react';
import { adminAPI } from '../../../api';
import { PLANNING_STATES, PLANNING_STATE_COLOR } from '../../../components/planning/PlanningStateBadge';
import './PlatformActivitySection.css';

// Rafraîchissement autonome : le Super Admin n'est abonné à aucune salle socket
// d'établissement, donc aucun événement temps réel ne lui parvient. Un intervalle
// propre au panneau évite de toucher au hook partagé `useRealtime`.
const REFRESH_MS = 30000;

/**
 * Le liseré d'une carte dit la **condition** du chiffre, jamais son sujet : la
 * plateforme n'a que trois tons, et un compteur n'est pas une taxonomie. Chaque
 * carte se range donc dans l'une de ces quatre lectures :
 *
 *   ALERT  un arbitrage attend quelqu'un    (ouvert, en attente, absence, retard)
 *   DUTY   c'est en service maintenant      (de garde, en cours, actif, accordé)
 *   SEAL   un acte institutionnel enregistré (en vigueur, publié, journalisé, lu)
 *   PLAIN  un dénombrement de structure     (brouillons, services, congés, totaux)
 *
 * Onze teintes inventées disaient jusqu'ici l'inverse de cette règle : le même
 * violet nommait « services » dans une section et « en attente de validation »
 * deux sections plus bas, et deux rouges distincts séparaient une alerte d'une
 * alerte critique — alors que la nuance tient dans le libellé, pas dans l'encre.
 */
const TONE = {
  alert: 'var(--gs-alert)',
  duty: 'var(--gs-duty)',
  seal: 'var(--gs-seal)',
  plain: 'var(--gs-ink-faint)',
};

/**
 * Le cycle de vie d'un planning est déclaré une seule fois, dans
 * `PlanningStateBadge`. Ce panneau en tenait une troisième copie manuelle (gris,
 * bleu, vert, gris) avec ses propres intitulés : trois occasions de voir la règle
 * dériver. La clé du serveur est en camelCase, l'état de la plateforme en
 * serpent — cette table ne sert qu'à faire le pont.
 */
const PLAN_STATES = [
  { key: 'brouillon', state: 'brouillon' },
  { key: 'soumis', state: 'soumis' },
  { key: 'enCours', state: 'en_cours' },
  { key: 'termine', state: 'termine' },
];

const nf = (n) => Number(n || 0).toLocaleString('fr-FR');

/** Jour affiché en clair, à partir de la chaîne serveur 'YYYY-MM-DD'. */
const longDate = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '—';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
};

const monthLabel = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return 'ce mois';
  return new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

const Card = ({ icon: Icon, label, value, unit, sub, tone = TONE.seal }) => (
  <div className="pa-card" style={{ '--pa-accent': tone }}>
    <div className="pa-card-top">
      <Icon size={15} aria-hidden="true" />
      <span className="pa-card-label">{label}</span>
    </div>
    <div className="pa-card-value">
      {nf(value)}
      {unit && <span className="pa-card-unit">{unit}</span>}
    </div>
    {sub && <div className="pa-card-sub">{sub}</div>}
  </div>
);

const Section = ({ icon: Icon, title, note, children }) => (
  <section>
    <h3 className="pa-section-title">
      <Icon size={14} aria-hidden="true" />
      {title}
    </h3>
    {note && <p className="pa-section-note">{note}</p>}
    {children}
  </section>
);

/** Ligne de couverture : « N sur M » avec sa jauge. */
const Gauge = ({ label, value, total, tone }) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="pa-row-head">
        <span className="pa-row-label">{label}</span>
        <span className="pa-row-value">{nf(value)} <span>/ {nf(total)} · {pct}%</span></span>
      </div>
      <div className="pa-gauge">
        {/* La largeur voyage en propriété personnalisée, comme la teinte : le CSS
            fait le calcul, le JavaScript ne fabrique aucun style. */}
        <div className="pa-gauge-fill" style={{ '--pa-fill': pct, '--pa-seg': tone }} />
      </div>
    </div>
  );
};

export default function PlatformActivitySection() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['admin-platform-activity'],
    queryFn: () => adminAPI.getPlatformActivity().then((r) => r.data.data),
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: true,
    staleTime: 10000,
  });

  if (isLoading) {
    return <div className="pa-state">Calcul de l'activité de la plateforme…</div>;
  }
  if (isError || !data) {
    return (
      <div className="pa-state">
        L'activité de la plateforme n'a pas pu être chargée.
        <p className="pa-empty-hint">Réessayez dans un instant — aucune donnée n'a été modifiée.</p>
      </div>
    );
  }

  const {
    today, month, services, plannings, guards, absences,
    replacements, loans, alerts, notes, traceability, coverage,
  } = data;

  const planTotal = plannings.total || 0;
  const syncedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  // Plateforme encore vierge : le dire explicitement plutôt qu'aligner des zéros.
  const isFresh = planTotal === 0 && services.total === 0;

  return (
    <div className="pa-wrap">
      {/* ── En-tête ────────────────────────────────────────── */}
      <div className="pa-head">
        <div>
          <h2 className="pa-head-title">Activité réelle de la plateforme</h2>
          <p className="pa-head-sub">
            {longDate(today)} · chiffres calculés depuis les tableurs de garde, les absences et les
            remplacements réellement enregistrés · synchronisé à {syncedAt}
          </p>
        </div>
        <div className="pa-head-actions">
          <span className="pa-live">
            <span className="pa-live-dot" aria-hidden="true" />
            En direct
          </span>
          <button
            type="button"
            className="pa-refresh"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw size={13} className={isFetching ? 'pa-spin' : undefined} aria-hidden="true" />
            {isFetching ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      </div>

      {guards.spreadsheetsTruncated > 0 && (
        <div className="pa-warn">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>
            {nf(guards.spreadsheetsTruncated)} planning(s) du mois au-delà du plafond de lecture :
            l'effectif du jour et les gardes du mois sont comptés sur {nf(guards.spreadsheetsScanned)} tableurs.
            Les autres compteurs de cette page restent complets.
          </span>
        </div>
      )}

      {isFresh && (
        // Une plateforme vierge n'attend pas d'arbitrage : elle n'a simplement
        // rien encore. Le filet en pointillé le dit — la même forme que le
        // brouillon, et non l'ambre de ce qui appelle une décision.
        <div className="pa-warn is-note">
          <ClipboardList size={15} aria-hidden="true" />
          <span>
            Aucun service ni planning n'existe encore sur la plateforme. Les compteurs ci-dessous
            se rempliront dès qu'un directeur aura créé ses services et qu'un chef de service aura
            soumis son premier tableur de garde.
          </span>
        </div>
      )}

      {/* ── Le terrain aujourd'hui ─────────────────────────── */}
      {/* Tout est ici « en service maintenant » : la section entière porte le ton
          du service, ce qui rend visible d'un coup d'œil ce qui tourne à cette
          minute par rapport au reste de la page. */}
      <Section
        icon={ShieldCheck}
        title="Le terrain aujourd'hui"
        note="Effectif lu dans les tableurs des plannings en cours, période de participation comprise — même règle que l'Appel du jour. Les brouillons sont exclus."
      >
        <div className="pa-grid">
          <Card
            icon={UserCheck} label="Agents de garde" value={guards.staffOnDutyToday} tone={TONE.duty}
            sub={`${nf(guards.dutySlotsToday)} affectation(s) sur la journée`}
          />
          <Card
            icon={Stethoscope} label="Services de garde" value={guards.departmentsOnDutyToday} tone={TONE.duty}
            sub={`sur ${nf(services.active)} service(s) actif(s)`}
          />
          <Card
            icon={Building2} label="Hôpitaux de garde" value={guards.establishmentsOnDutyToday} tone={TONE.duty}
            sub={`sur ${nf(coverage.active)} établissement(s) actif(s)`}
          />
          <Card
            icon={Home} label="Gardes à domicile" value={guards.atHomeToday} tone={TONE.duty}
            sub="astreintes du jour"
          />
          <Card
            icon={CalendarCheck} label="Plannings en cours" value={plannings.enCours} tone={TONE.duty}
            sub={`${nf(guards.spreadsheetsScanned)} tableur(s) lu(s) ce mois`}
          />
        </div>
      </Section>

      {/* ── Plannings ──────────────────────────────────────── */}
      <Section icon={CalendarDays} title="Plannings de garde">
        <div className="pa-grid">
          <Card icon={Layers} label="Plannings au total" value={planTotal} tone={TONE.plain}
            sub={`${nf(plannings.enCours)} en cours · ${nf(plannings.soumis)} à venir`} />
          <Card icon={CalendarCheck} label="En cours" value={plannings.enCours} tone={TONE.duty}
            sub="mis en marche, période courante" />
          {/* « Soumis » était le mot de la base ; le badge d'état affiche « En
              vigueur » sur dix-sept écrans. Un planning envoyé n'attend plus
              d'approbation : il engage. Un seul mot pour un seul état. */}
          <Card icon={ClipboardList} label="En vigueur" value={plannings.soumis} tone={TONE.seal}
            sub="validés, période à venir" />
          <Card icon={FileText} label="Brouillons" value={plannings.brouillon} tone={TONE.plain}
            sub="chez les chefs de service" />
          <Card icon={Stethoscope} label="Services" value={services.active} tone={TONE.plain}
            sub={`${nf(services.establishmentsWithService)} établissement(s) équipé(s)`} />
        </div>

        {planTotal > 0 && (
          <div className="pa-panel">
            <div className="pa-bar">
              {PLAN_STATES.map(({ key, state }) => {
                const v = plannings[key] || 0;
                if (!v) return null;
                return (
                  <div
                    key={key}
                    className={`pa-bar-seg${state === 'brouillon' ? ' is-open' : ''}`}
                    style={{ '--pa-seg-w': (v / planTotal) * 100, '--pa-seg': PLANNING_STATE_COLOR[state] }}
                  />
                );
              })}
            </div>
            <div className="pa-legend">
              {PLAN_STATES.map(({ key, state }) => (
                <span key={key} className="pa-legend-item">
                  <span
                    className={`pa-legend-dot${state === 'brouillon' ? ' is-open' : ''}`}
                    style={{ '--pa-seg': PLANNING_STATE_COLOR[state] }}
                  />
                  {PLANNING_STATES[state].label} <span className="pa-legend-value">{nf(plannings[key])}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── Le mois en cours ───────────────────────────────── */}
      {/* Un mois écoulé n'est plus « en service » : ce sont des actes enregistrés,
          donc le sceau. */}
      <Section
        icon={Activity}
        title={`Gardes de ${monthLabel(month?.start)}`}
        note={`Du ${month?.start} au ${month?.end}. Une seule notion dans le tableur : l'agent est de service, ou il ne l'est pas. Les jours cochés font foi quand la ligne en porte, sa période de participation sinon — c'est la règle appliquée par l'Appel du jour.`}
      >
        <div className="pa-grid">
          <Card icon={ShieldCheck} label="Journées de garde" value={guards.dutySlotsThisMonth} tone={TONE.seal}
            sub="agent × jour, sur tout le mois" />
          <Card icon={Users} label="Agents mobilisés" value={guards.staffThisMonth} tone={TONE.seal}
            sub="agents distincts affectés" />
          <Card icon={Layers} label="Tableurs lus" value={guards.spreadsheetsScanned} tone={TONE.seal}
            sub="plannings validés du mois" />
        </div>
      </Section>

      {/* ── Absences, congés et retards ────────────────────── */}
      {/* Un congé accordé est un dénombrement ; une absence de garde, un retard,
          une demande en attente appellent tous les trois une décision. */}
      <Section
        icon={UserX}
        title="Absences, congés et retards du jour"
        note="Déclarations en cours à la date du jour, toutes natures confondues."
      >
        <div className="pa-grid">
          <Card icon={CalendarDays} label="Congés en cours" value={absences.leavesToday} tone={TONE.plain} />
          <Card icon={UserX} label="Absences de garde" value={absences.shiftAbsencesToday} tone={TONE.alert} />
          <Card icon={Clock3} label="Retards signalés" value={absences.latesToday} tone={TONE.alert} />
          <Card icon={ClipboardList} label="En attente de validation" value={absences.pending} tone={TONE.alert}
            sub="toutes dates" />
        </div>
      </Section>

      {/* ── Remplacements et prêts ─────────────────────────── */}
      <Section
        icon={Repeat2}
        title="Remplacements et prêts de personnel"
        note="Les remplacements sont une surcouche : le tableur validé n'est jamais réécrit."
      >
        <div className="pa-grid">
          <Card icon={Repeat2} label="Actifs aujourd'hui" value={replacements.activeToday} tone={TONE.duty} />
          <Card icon={Clock3} label="En attente du chef" value={replacements.pendingChef} tone={TONE.alert}
            sub="créés par un surveillant" />
          <Card icon={Repeat2} label="Sur 30 jours" value={replacements.last30d} tone={TONE.seal}
            sub={`${nf(replacements.total)} depuis l'origine`} />
          <Card icon={Users} label="Prêts en attente" value={loans.pending} tone={TONE.alert}
            sub={`${nf(loans.thisMonth)} prêt(s) ce mois`} />
          <Card icon={CheckCircle2} label="Prêts accordés" value={loans.approved} tone={TONE.duty}
            sub={`${nf(loans.rejected)} refusé(s)`} />
        </div>
      </Section>

      {/* ── Alertes et circulaires ─────────────────────────── */}
      {/* Une alerte critique reste une alerte : la gravité tient dans le libellé
          « dont critiques » et dans le chiffre, pas dans une seconde teinte. */}
      <Section icon={AlertTriangle} title="Alertes ouvertes et circulaires">
        <div className="pa-grid">
          <Card icon={AlertTriangle} label="Alertes ouvertes" value={alerts.open} tone={TONE.alert}
            sub={`${nf(alerts.unacknowledged)} non prise(s) en compte`} />
          <Card icon={AlertTriangle} label="Dont critiques" value={alerts.critical} tone={TONE.alert} />
          <Card icon={ScrollText} label="Notes et circulaires" value={notes.total} tone={TONE.seal}
            sub={`${nf(notes.platform)} circulaire(s) plateforme`} />
          <Card icon={ScrollText} label="Publiées sur 30 jours" value={notes.last30d} tone={TONE.seal} />
        </div>
      </Section>

      {/* ── Couverture nationale ───────────────────────────── */}
      {/* Les trois premières jauges comptent des actes posés une fois pour toutes
          (activé, service créé, planning validé) : le sceau. La dernière compte
          ce qui tourne aujourd'hui : le service. */}
      <Section
        icon={Building2}
        title="Couverture nationale"
        note="Où la plateforme est réellement utilisée, et non seulement enregistrée."
      >
        <div className="pa-panel pa-rows">
          <Gauge label="Établissements actifs"
            value={coverage.active} total={coverage.establishments} tone={TONE.seal} />
          <Gauge label="Avec au moins un service créé"
            value={coverage.withService} total={coverage.establishments} tone={TONE.seal} />
          <Gauge label="Avec au moins un planning validé"
            value={coverage.withSchedule} total={coverage.establishments} tone={TONE.seal} />
          <Gauge label="Avec un planning en cours aujourd'hui"
            value={coverage.withActiveSchedule} total={coverage.establishments} tone={TONE.duty} />
        </div>
      </Section>

      {/* ── Traçabilité ────────────────────────────────────── */}
      <Section
        icon={ScrollText}
        title="Traçabilité"
        note="Historique constant et non modifiable — chaque action enregistrée reste consultable."
      >
        <div className="pa-grid">
          <Card icon={Activity} label="Actions sur 24 h" value={traceability.last24h} tone={TONE.seal} />
          <Card icon={Activity} label="Actions sur 7 jours" value={traceability.last7d} tone={TONE.seal} />
          <Card icon={Users} label="Acteurs sur 7 jours" value={traceability.actors7d} tone={TONE.seal}
            sub="comptes ayant agi" />
          <Card icon={ScrollText} label="Actions enregistrées" value={traceability.total} tone={TONE.seal}
            sub="depuis l'origine" />
        </div>
      </Section>
    </div>
  );
}
