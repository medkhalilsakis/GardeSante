/**
 * Alertes de service — ce qui attend une décision
 * ═══════════════════════════════════════════════
 * Personnel absent, garde non couverte, remplacement en attente, renfort
 * demandé, urgence, conflit détecté. Les alertes ne se créent pas ici : elles
 * naissent des signalements d'absence et des écritures du journal (incident
 * grave, demande de renfort). Ce panneau les lit, les prend en compte et les
 * résout.
 *
 * Deux formes, un seul jeu de données
 * ───────────────────────────────────
 * `variant="workspace"` garde **exactement** la structure et les classes
 * d'origine : `IncidentsPage.css` (écran déjà validé) met en page sept
 * sélecteurs `service-alerts-panel*` avec des `!important` et lit les propriétés
 * `--alert-tone` / `--alert-tone-bg` posées sur la pastille. La structure reste
 * intouchée ; seules les cinq couleurs qu'elle recevait sont passées aux jetons,
 * ce qui la fait enfin s'inverser avec le thème (phase 8).
 *
 * La forme par défaut — `/surveillant` et la supervision générale — passe sur le
 * kit : un panneau nommé, les trois vues en barre de filtres, et une liste dont
 * le filet de gauche porte la gravité. Les cinq couleurs de sévérité y
 * disparaissent : `--gs-alert` pour ce qui réclame une décision, un filet
 * effacé pour la vigilance, rien pour une information.
 *
 * `scopeNote` permet à l'écran appelant de nommer le filtre réellement appliqué,
 * pour qu'un compteur d'en-tête et le contenu du panneau ne se contredisent pas.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BellRing, CheckCircle2, Eye, GitCompareArrows, RefreshCw, ShieldAlert, ShieldCheck,
  Siren, UserPlus, UserX,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { journalAPI } from '../../../api';
import { GsPanel, GsPanelHeader, GsFilterBar, GsEmpty, GsSkeleton, GsBadge } from '../../../components/gs';
import { frenchifyIsoDates } from '../../../utils/frenchDates';
import './service-panels.css';

// Clés strictement alignées sur la contrainte chk_alert_type (migration 021).
const TYPE_META = {
  staff_absent:        { label: 'Personnel absent',        Icon: UserX },
  shift_uncovered:     { label: 'Garde non couverte',      Icon: ShieldAlert },
  replacement_pending: { label: 'Remplacement en attente', Icon: RefreshCw },
  insufficient_staff:  { label: 'Renfort demandé',         Icon: UserPlus },
  urgent_notification: { label: 'Urgence',                 Icon: Siren },
  conflict_detected:   { label: 'Conflit détecté',         Icon: GitCompareArrows },
};

/**
 * Le nom de chaque gravité, et ce qu'elle vaut dans le registre :
 *   `alert` — une décision est attendue (urgent, critique, grave) ;
 *   `watch` — à surveiller, sans blocage (avertissement) ;
 *   rien    — une information.
 */
const SEVERITY_META = {
  urgent:   { label: 'Urgent',      tone: 'alert' },
  critical: { label: 'Critique',    tone: 'alert' },
  error:    { label: 'Grave',       tone: 'alert' },
  warning:  { label: 'Vigilance',   tone: 'watch' },
  info:     { label: 'Information', tone: null },
};

/**
 * La pastille de gravité de la forme « plan de travail » — `IncidentsPage.css`
 * lit `--alert-tone` et `--alert-tone-bg`. Les trois gravités qui appellent une
 * décision partagent le degré haut de l'alerte, exactement comme le dit
 * `SEVERITY_META` : elles ne sont pas de natures différentes, c'est leur nom qui
 * les sépare. La vigilance prend le degré bas, l'information prend le cachet —
 * elle ne signale rien de fautif.
 */
const WORKSPACE_TONE = {
  urgent:   { color: 'var(--gs-alert-strong)', bg: 'var(--gs-alert-wash)' },
  critical: { color: 'var(--gs-alert-strong)', bg: 'var(--gs-alert-wash)' },
  error:    { color: 'var(--gs-alert-strong)', bg: 'var(--gs-alert-wash)' },
  warning:  { color: 'var(--gs-alert)',        bg: 'var(--gs-alert-wash)' },
  info:     { color: 'var(--gs-seal)',         bg: 'var(--gs-seal-wash)' },
};

const VIEWS = [
  { id: 'open', label: 'Ouvertes', resolved: 'false' },
  { id: 'done', label: 'Résolues', resolved: 'true' },
  { id: 'all',  label: 'Toutes',   resolved: 'all' },
];

export default function ServiceAlertsPanel({
  departmentId,
  canAct = false,
  title = 'Alertes de service',
  variant = 'default',
  scopeNote,
}) {
  const qc = useQueryClient();
  const [view, setView] = useState('open');

  const params = useMemo(() => {
    const p = { limit: 100, resolved: VIEWS.find((v) => v.id === view)?.resolved };
    if (departmentId) p.departmentId = departmentId;
    return p;
  }, [view, departmentId]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['journal-alerts', params],
    queryFn: () => journalAPI.getAlerts(params),
  });

  const act = useMutation({
    mutationFn: ({ id, action }) => journalAPI.updateAlert(id, action),
    onSuccess: (_r, { action }) => {
      toast.success(action === 'resolve' ? 'Alerte résolue' : 'Alerte prise en compte');
      qc.invalidateQueries({ queryKey: ['journal-alerts'] });
      qc.invalidateQueries({ queryKey: ['journal-overview'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Action impossible'),
  });

  const payload = data?.data?.data;
  const alerts = payload?.alerts || [];
  const isForbidden = error?.response?.status === 403;

  const critical = alerts.filter((a) => ['critical', 'urgent'].includes(a.severity)).length;

  /* ── Forme « plan de travail » — structure d'origine, intouchée ─────────── */
  if (variant === 'workspace') {
    return (
      <div className="service-alerts-panel service-alerts-panel-workspace" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="service-alerts-panel-heading" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="service-alerts-panel-title-block" style={{ flex: 1, minWidth: 200 }}>
            <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--gs-ink)' }}>{title}</h3>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--gs-ink-faint)', marginTop: 2 }}>
              {payload?.scopeLabel || 'Portée déduite de votre rôle'}
              {critical > 0 ? ` · ${critical} critique(s)` : ''}
            </p>
          </div>
          <div className="service-alerts-panel-tabs" style={{ display: 'flex', gap: 6 }}>
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={view === v.id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {isForbidden ? (
          <div style={{
            padding: 32, textAlign: 'center', color: 'var(--gs-ink-faint)', fontSize: 'var(--font-sm)',
            background: 'var(--gs-paper)', border: '1px dashed var(--gs-rule)', borderRadius: 'var(--border-radius-lg)',
          }}>
            Les alertes ne sont pas accessibles avec votre rôle.
          </div>
        ) : isError ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--gs-alert-strong)', fontSize: 'var(--font-sm)' }}>
            Les alertes n'ont pas pu être chargées.
          </div>
        ) : isLoading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--gs-ink-faint)', fontSize: 'var(--font-sm)' }}>
            Chargement des alertes…
          </div>
        ) : alerts.length === 0 ? (
          <div style={{
            padding: 40, textAlign: 'center', color: 'var(--gs-ink-faint)', fontSize: 'var(--font-sm)',
            background: 'var(--gs-paper)', border: '1px dashed var(--gs-rule)', borderRadius: 'var(--border-radius-lg)',
          }}>
            {view === 'open' ? 'Aucune alerte ouverte' : 'Aucune alerte'}
          </div>
        ) : (
          <div className="service-alerts-panel-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map((a) => {
              const meta = TYPE_META[a.type] || { label: a.type, Icon: BellRing };
              const sev = SEVERITY_META[a.severity] || SEVERITY_META.info;
              const tone = WORKSPACE_TONE[a.severity] || WORKSPACE_TONE.info;
              const TypeIcon = meta.Icon;
              return (
                <div key={a.id} className="service-alerts-panel-item" style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  background: a.resolvedAt ? 'var(--gs-paper)' : tone.bg,
                  border: '1px solid var(--gs-rule)',
                  borderInlineStart: `3px solid ${a.resolvedAt ? 'var(--gs-rule)' : tone.color}`,
                  borderRadius: 'var(--border-radius-sm)', padding: '12px 14px',
                  opacity: a.resolvedAt ? 0.75 : 1,
                }}>
                  <span className="service-alerts-panel-type-icon" style={{ '--alert-tone': tone.color, '--alert-tone-bg': tone.bg }}>
                    <TypeIcon size={15} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--gs-ink)' }}>
                        {a.title}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: tone.color,
                        border: `1px solid ${tone.color}`, borderRadius: 6, padding: '1px 6px',
                      }}>
                        {sev.label}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--gs-ink-faint)', fontWeight: 600 }}>
                        {meta.label}
                      </span>
                    </div>
                    {a.message && (
                      <p style={{ fontSize: 'var(--font-xs)', color: 'var(--gs-ink-soft)', marginTop: 3 }}>
                        {a.message}
                      </p>
                    )}
                    <p style={{ fontSize: 10, color: 'var(--gs-ink-faint)', marginTop: 3 }}>
                      {a.departmentName || '—'}
                      {a.acknowledgedBy ? ` · pris en compte par ${a.acknowledgedBy}` : ''}
                      {a.resolvedAt ? ' · résolue' : ''}
                    </p>
                  </div>
                  {canAct && !a.resolvedAt && (
                    <div className="service-alerts-panel-actions" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {!a.acknowledgedAt && (
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: a.id, action: 'acknowledge' })}
                        >
                          <Eye size={13} />
                          Prendre en compte
                        </button>
                      )}
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: a.id, action: 'resolve' })}
                      >
                        <CheckCircle2 size={13} />
                        Résoudre
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ── Forme du registre ─────────────────────────────────────────────────── */

  const body = () => {
    if (isForbidden) {
      return (
        <GsEmpty
          bare
          icon={<ShieldAlert size={26} strokeWidth={1.6} />}
          title="Alertes non accessibles"
          hint="Le suivi des alertes est réservé aux surveillants, aux chefs de service et à la supervision générale."
        />
      );
    }
    if (isError) {
      return (
        <GsEmpty
          bare
          title="Les alertes n'ont pas pu être chargées"
          hint="La connexion au serveur a échoué. Rechargez la page pour réessayer."
        />
      );
    }
    if (isLoading) return <GsSkeleton variant="rows" count={3} />;
    if (alerts.length === 0) {
      return view === 'open' ? (
        <GsEmpty
          bare
          icon={<ShieldCheck size={26} strokeWidth={1.6} />}
          title="Aucune alerte ouverte"
          hint="Rien n'attend de décision dans ce périmètre. Une alerte naît d'un signalement d'absence ou d'un incident consigné au journal."
          actions={<button type="button" className="gs-btn is-quiet" onClick={() => setView('all')}>Voir l'historique</button>}
        />
      ) : (
        <GsEmpty
          bare
          icon={<ShieldCheck size={26} strokeWidth={1.6} />}
          title={view === 'done' ? 'Aucune alerte résolue' : 'Aucune alerte enregistrée'}
          hint="Ce périmètre n'a encore produit aucune alerte."
        />
      );
    }

    return (
      <ul className="gsv-alerts">
        {alerts.map((a) => {
          const meta = TYPE_META[a.type] || { label: a.type, Icon: BellRing };
          const sev = SEVERITY_META[a.severity] || SEVERITY_META.info;
          const AlertIcon = meta.Icon;
          const resolved = Boolean(a.resolvedAt);
          return (
            <li
              key={a.id}
              data-tone={resolved ? undefined : (sev.tone || undefined)}
              data-resolved={resolved ? 'true' : undefined}
            >
              <span
                className="gsv-mark"
                data-tone={!resolved && sev.tone === 'alert' ? 'alert' : undefined}
                title={meta.label}
              >
                <AlertIcon size={14} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <div className="gsv-alert-main">
                <div className="gsv-body">
                  <div className="gsv-top">
                    <span className="gsv-title">{a.title}</span>
                    {sev.tone ? <GsBadge tone={resolved ? 'quiet' : 'alert'}>{sev.label}</GsBadge> : null}
                    <span className="gsv-kind">{meta.label}</span>
                  </div>
                  {a.message ? <p className="gsv-desc">{frenchifyIsoDates(a.message)}</p> : null}
                  <p className="gsv-meta">
                    <span>{a.departmentName || 'Service non précisé'}</span>
                    {a.acknowledgedBy ? <span>pris en compte par {a.acknowledgedBy}</span> : null}
                    {resolved ? <span>résolue</span> : null}
                  </p>
                </div>
                {canAct && !resolved ? (
                  <div className="gsv-alert-acts">
                    {!a.acknowledgedAt ? (
                      <button
                        type="button"
                        className="gs-btn is-quiet"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: a.id, action: 'acknowledge' })}
                      >
                        <Eye size={13} strokeWidth={2} aria-hidden="true" />
                        Prendre en compte
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="gs-btn is-primary"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ id: a.id, action: 'resolve' })}
                    >
                      <CheckCircle2 size={13} strokeWidth={2} aria-hidden="true" />
                      Résoudre
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <GsPanel
      header={(
        <>
          <GsPanelHeader
            title={title}
            sub={scopeNote || payload?.scopeLabel || 'Portée déduite de votre rôle'}
          />
          {/* Trois vues, pas trois onglets : elles restreignent la même liste. */}
          <GsFilterBar
            inset
            label="État des alertes"
            filters={VIEWS}
            value={view}
            onChange={setView}
            end={critical > 0
              ? <GsBadge tone="alert" dot title="Alertes urgentes ou critiques">{critical} critique{critical > 1 ? 's' : ''}</GsBadge>
              : null}
          />
        </>
      )}
    >
      {body()}
    </GsPanel>
  );
}
