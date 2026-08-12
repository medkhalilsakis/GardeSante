/**
 * Assistant Intelligent V2 (Lot 7) — conteneur.
 *
 * Écran neuf, monté à côté de `WizardAssistant` (V1) qui reste inchangé et
 * accessible : les deux cohabitent, l'utilisateur choisit à l'étape « méthode ».
 *
 * Trois étapes seulement, contre sept en V1 : l'équipe et les contraintes sur un
 * même écran, le mode, puis la relecture. La différence de fond n'est pas là —
 * elle est dans le fait que les congés sont écartés à la génération et que la
 * grille passe par une validation serveur avant de devenir un planning.
 *
 * Aucun état de garde n'est calculé ici : le navigateur affiche et édite, le
 * serveur génère, valide et corrige.
 */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assistantAPI } from '../../../../api';
import toast from 'react-hot-toast';
import { Steps, Btn, Section } from './ui';
import StepTeam from './StepTeam';
import StepMode from './StepMode';
import StepReview from './StepReview';

const STEPS = ['Équipe & contraintes', 'Mode de génération', 'Relecture & envoi'];

export default function WizardAssistantV2({
  departmentId, scheduleId, startDate, endDate, name, onBack, onDone,
}) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState([]);
  const [requirements, setRequirements] = useState({ minPerDay: 1, seniorCount: 0 });
  const [mode, setMode] = useState('balanced');
  const [proposal, setProposal] = useState(null);   // { rows, days, metrics, notes, validation }
  const [dirty, setDirty] = useState(false);
  const queryClient = useQueryClient();

  const { data: context, isLoading } = useQuery({
    queryKey: ['assistant-context', departmentId, startDate, endDate],
    queryFn: () => assistantAPI.getContext({ departmentId, startDate, endDate }).then((r) => r.data.data),
    enabled: !!departmentId && !!startDate && !!endDate,
  });

  const staff = context?.staff || [];
  const modes = context?.modes || [];

  // Le rang dans `selected` EST l'ordre de relais envoyé au serveur.
  const members = useMemo(
    () => selected.map((s, position) => ({ ...s, position })),
    [selected]
  );

  const refreshBriefs = () =>
    queryClient.invalidateQueries({ queryKey: ['assistant-context', departmentId] });

  // ── Génération ──────────────────────────────────────────────
  const generate = useMutation({
    mutationFn: () => assistantAPI.generate({
      departmentId, startDate, endDate, scheduleId, mode,
      selectedStaff: members, serviceRequirements: requirements,
    }).then((r) => r.data.data),
    onSuccess: (data) => {
      setProposal(data);
      setDirty(false);
      setStep(2);
      const errs = data.validation?.counts?.errors || 0;
      if (errs) toast(`Proposition générée — ${errs} anomalie(s) à corriger avant envoi`, { icon: '⚠️' });
      else toast.success('Proposition générée et vérifiée');
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec de la génération'),
  });

  // ── Revalidation d'une grille éditée à la main ──────────────
  const revalidate = useMutation({
    mutationFn: () => assistantAPI.validate({
      rows: proposal.rows, startDate, endDate, serviceRequirements: requirements,
    }).then((r) => r.data.data),
    onSuccess: (data) => {
      setProposal((p) => ({ ...p, validation: data.validation, metrics: data.metrics }));
      setDirty(false);
      const errs = data.validation?.counts?.errors || 0;
      toast[errs ? 'error' : 'success'](
        errs ? `${errs} anomalie(s) bloquante(s)` : 'Grille conforme'
      );
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec de la vérification'),
  });

  // ── Corrections proposées ───────────────────────────────────
  const applyFixes = useMutation({
    mutationFn: (fixes) => assistantAPI.applyFixes({
      rows: proposal.rows, fixes, startDate, endDate, serviceRequirements: requirements,
    }).then((r) => r.data.data),
    onSuccess: (data) => {
      setProposal((p) => ({ ...p, rows: data.rows, validation: data.validation, metrics: data.metrics }));
      setDirty(false);
      const done = data.applied?.length || 0;
      if (!done) toast('Aucune correction applicable en l\'état', { icon: 'ℹ️' });
      else toast.success(`${done} correction(s) appliquée(s)`);
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec des corrections'),
  });

  // ── Création du planning (brouillon) ────────────────────────
  const confirm = useMutation({
    mutationFn: () => assistantAPI.confirm({
      departmentId, name, startDate, endDate, scheduleId,
      rows: proposal.rows, mode, serviceRequirements: requirements,
    }).then((r) => r.data.data),
    onSuccess: (data) => {
      toast.success('Planning créé en brouillon');
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      onDone?.(data.scheduleId);
    },
    onError: (e) => {
      const v = e?.response?.data?.data?.validation;
      if (v) setProposal((p) => ({ ...p, validation: v }));
      toast.error(e?.response?.data?.message || 'Échec de la création du planning');
    },
  });

  // ── Briefs ──────────────────────────────────────────────────
  const saveBrief = useMutation({
    mutationFn: (briefName) => assistantAPI.saveBrief({
      departmentId, name: briefName, mode,
      brief: { members, requirements },
    }),
    onSuccess: () => { toast.success('Brief enregistré'); refreshBriefs(); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec de l\'enregistrement'),
  });

  const useBrief = useMutation({
    mutationFn: (id) => assistantAPI.useBrief(id, {}).then((r) => r.data.data),
    onSuccess: (data) => {
      const b = data.brief?.brief || data.brief || {};
      // Les bornes du brief sont recalées sur la période courante : un brief de
      // mars rejoué en avril ne doit pas replacer des dates de mars.
      if (Array.isArray(b.members)) {
        setSelected(b.members.map((m) => ({
          ...m,
          periodStart: m.periodStart && m.periodStart >= startDate && m.periodStart <= endDate ? m.periodStart : startDate,
          periodEnd: m.periodEnd && m.periodEnd >= startDate && m.periodEnd <= endDate ? m.periodEnd : endDate,
        })));
      }
      if (b.requirements) setRequirements(b.requirements);
      if (data.brief?.mode) setMode(data.brief.mode);
      setProposal(null);
      setStep(0);
      toast.success('Brief chargé — congés relus pour la période en cours');
      refreshBriefs();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec du chargement'),
  });

  const deleteBrief = useMutation({
    mutationFn: (id) => assistantAPI.deleteBrief(id),
    onSuccess: () => { toast.success('Brief supprimé'); refreshBriefs(); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec de la suppression'),
  });

  // Le mode par défaut suit ce que le serveur expose, si « balanced » disparaît.
  useEffect(() => {
    if (modes.length && !modes.some((m) => m.id === mode)) setMode(modes[0].id);
  }, [modes, mode]);

  // Édition d'une case : purement locale, puis revalidation serveur explicite.
  const toggleCell = (userId, date, code) => {
    setProposal((p) => ({
      ...p,
      rows: p.rows.map((r) => {
        if (r.userId !== userId) return r;
        const shifts = { ...r.shifts };
        if (code) shifts[date] = code;
        else delete shifts[date];
        return { ...r, shifts };
      }),
    }));
    setDirty(true);
  };

  const busy = generate.isPending || revalidate.isPending || applyFixes.isPending || confirm.isPending;
  const blocking = (proposal?.validation?.counts?.errors || 0) > 0;

  if (isLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement du service…</div>;
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <Btn variant="ghost" onClick={onBack}>← Retour</Btn>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
            Assistant Intelligent V2
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {context?.department?.name} · {startDate} → {endDate} · {context?.daysCount || 0} jour(s)
          </div>
        </div>
      </div>

      <Steps steps={STEPS} current={step} onGo={setStep} />

      {step === 0 && (
        <StepTeam
          staff={staff}
          leaves={context?.leaves || []}
          startDate={startDate}
          endDate={endDate}
          selected={selected}
          setSelected={setSelected}
          requirements={requirements}
          setRequirements={setRequirements}
        />
      )}

      {step === 1 && (
        <StepMode
          modes={modes}
          mode={mode}
          setMode={setMode}
          briefs={context?.briefs || []}
          saving={saveBrief.isPending}
          onSaveBrief={(n) => saveBrief.mutate(n)}
          onUseBrief={(b) => useBrief.mutate(b.id)}
          onDeleteBrief={(b) => window.confirm(`Supprimer le brief « ${b.name} » ?`) && deleteBrief.mutate(b.id)}
        />
      )}

      {step === 2 && proposal && (
        <StepReview
          rows={proposal.rows}
          days={proposal.days}
          metrics={proposal.metrics}
          notes={proposal.notes}
          validation={proposal.validation}
          dirty={dirty}
          busy={busy}
          onToggleCell={toggleCell}
          onRevalidate={() => revalidate.mutate()}
          onApplyFix={(a) => applyFixes.mutate([a.fix])}
          onApplyAll={() => applyFixes.mutate(
            (proposal.validation?.anomalies || []).filter((a) => a.fix).map((a) => a.fix)
          )}
        />
      )}

      {step === 2 && !proposal && (
        <Section title="Aucune proposition">
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Revenez à l'étape « Mode de génération » pour lancer l'assistant.
          </div>
        </Section>
      )}

      {/* Barre d'action */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
        {step > 0 && <Btn variant="ghost" onClick={() => setStep(step - 1)}>Précédent</Btn>}

        {step === 0 && (
          <Btn onClick={() => setStep(1)} disabled={selected.length === 0}>
            Continuer ({selected.length} agent{selected.length > 1 ? 's' : ''})
          </Btn>
        )}

        {step === 1 && (
          <Btn onClick={() => generate.mutate()} disabled={busy || selected.length === 0}>
            {generate.isPending ? 'Génération…' : 'Générer la proposition'}
          </Btn>
        )}

        {step === 2 && proposal && (
          <>
            <Btn variant="ghost" onClick={() => generate.mutate()} disabled={busy}>
              Regénérer
            </Btn>
            <Btn
              onClick={() => confirm.mutate()}
              disabled={busy || blocking || dirty}
              style={blocking || dirty ? undefined : { background: '#059669' }}
            >
              {confirm.isPending ? 'Création…'
                : blocking ? `${proposal.validation.counts.errors} anomalie(s) à corriger`
                : dirty ? 'Revérifiez avant d\'envoyer'
                : 'Créer le planning'}
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}
