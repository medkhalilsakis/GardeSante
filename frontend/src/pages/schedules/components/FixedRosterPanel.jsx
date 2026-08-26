import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  GripVertical,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  UsersRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { jobTitlesAPI, scheduleConfigAPI } from '../../../api';
import './FixedRosterPanel.css';

const normalizeConfig = (config) => {
  if (!config) return {};
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch { return {}; }
  }
  return config;
};

const normalizeSlots = (slots) => (Array.isArray(slots) ? slots : [])
  .map((slot, index) => ({
    id: slot.id || `fixed-slot-${index + 1}`,
    jobTitleId: slot.jobTitleId || slot.job_title_id || null,
    functionName: slot.functionName || slot.function_name || slot.job_title || 'Fonction à renseigner',
    quantity: Math.min(Math.max(Number(slot.quantity) || 1, 1), 50),
    isConstant: slot.isConstant ?? slot.is_constant ?? true,
  }));

const categoryLabel = (category) => ({
  medical: 'Médical',
  administrative: 'Administratif',
  auxiliary: 'Auxiliaire',
  paramedical: 'Médical',
}[category] || 'Fonction');

export default function FixedRosterPanel({
  departmentId,
  slots = [],
  onSlotsChange,
  onTemplateLoaded,
  hasSavedSlots = false,
  disabled = false,
  collapsed = false,
  onCollapsedChange,
}) {
  const queryClient = useQueryClient();
  const [functionSearch, setFunctionSearch] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [draggingSlotId, setDraggingSlotId] = useState(null);
  const hydratedRef = useRef(false);

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['fixed-roster-template', departmentId],
    queryFn: () => scheduleConfigAPI.getTemplates({ departmentId }),
    enabled: !!departmentId,
    staleTime: 30000,
  });
  const { data: titlesData, isLoading: titlesLoading } = useQuery({
    queryKey: ['fixed-roster-job-titles'],
    queryFn: () => jobTitlesAPI.getAll().then((response) => response.data?.data || []),
    enabled: !!departmentId,
    staleTime: 60000,
  });

  const templates = useMemo(() => {
    const payload = templatesData?.data?.data || templatesData?.data;
    return Array.isArray(payload) ? payload : [];
  }, [templatesData]);
  const template = templates.find((item) => (
    String(item.department_id || item.departmentId || '') === String(departmentId)
    && item.generation_algo === 'fixed_roster'
    && normalizeConfig(item.config).kind === 'fixed_spreadsheet'
  ));
  const titles = useMemo(() => (Array.isArray(titlesData) ? titlesData : []), [titlesData]);
  const visibleTitles = useMemo(() => {
    const term = functionSearch.trim().toLocaleLowerCase('fr');
    return titles.filter((title) => !term || title.name.toLocaleLowerCase('fr').includes(term));
  }, [titles, functionSearch]);
  const normalizedSlots = useMemo(() => normalizeSlots(slots), [slots]);
  const totalPositions = normalizedSlots.reduce((total, slot) => total + slot.quantity, 0);
  const constantPositions = normalizedSlots
    .filter((slot) => slot.isConstant)
    .reduce((total, slot) => total + slot.quantity, 0);

  useEffect(() => {
    if (hydratedRef.current || templatesLoading || hasSavedSlots) return;
    if (!template) {
      hydratedRef.current = true;
      return;
    }
    hydratedRef.current = true;
    const templateSlots = normalizeSlots(normalizeConfig(template.config).slots);
    onTemplateLoaded?.(templateSlots);
  }, [template, templatesLoading, hasSavedSlots, onTemplateLoaded]);

  const saveTemplate = useMutation({
    mutationFn: async () => {
      const constantSlots = normalizedSlots.filter((slot) => slot.isConstant);
      const payload = {
        name: 'Tableur fixe',
        description: 'Fonctions constantes du tableau de garde du service',
        departmentId,
        periodType: 'monthly',
        weekMode: 'standard',
        generationAlgo: 'fixed_roster',
        config: {
          kind: 'fixed_spreadsheet',
          version: 1,
          slots: constantSlots,
        },
        isDefault: false,
      };
      if (template?.id) return scheduleConfigAPI.updateTemplate(template.id, payload);
      return scheduleConfigAPI.createTemplate(payload);
    },
    onSuccess: () => {
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ['fixed-roster-template', departmentId] });
      toast.success('Configuration du Tableur fixe enregistrée.');
    },
    onError: (error) => {
      toast.error(error.response?.data?.message || 'Impossible d’enregistrer le Tableur fixe.');
    },
  });

  const updateSlot = (slotId, patch) => {
    const next = normalizedSlots.map((slot) => (slot.id === slotId ? { ...slot, ...patch } : slot));
    onSlotsChange?.(next);
  };

  const addSlot = () => {
    const firstTitle = titles[0];
    onSlotsChange?.([
      ...normalizedSlots,
      {
        id: `fixed-slot-${Date.now()}`,
        jobTitleId: firstTitle?.id || null,
        functionName: firstTitle?.name || 'Fonction à renseigner',
        quantity: 1,
        isConstant: false,
      },
    ]);
  };

  const removeSlot = (slotId) => onSlotsChange?.(normalizedSlots.filter((slot) => slot.id !== slotId));

  const moveSlot = (targetSlotId) => {
    if (!draggingSlotId || draggingSlotId === targetSlotId) return;
    const fromIndex = normalizedSlots.findIndex(slot => slot.id === draggingSlotId);
    const targetIndex = normalizedSlots.findIndex(slot => slot.id === targetSlotId);
    if (fromIndex < 0 || targetIndex < 0) return;
    const next = [...normalizedSlots];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, moved);
    setDraggingSlotId(null);
    onSlotsChange?.(next);
  };

  return (
    <section className={`fixed-roster-panel${collapsed ? ' is-collapsed' : ''}`} aria-labelledby="fixed-roster-title">
      <div className="fixed-roster-panel__header">
        <div className="fixed-roster-panel__title">
          <span className="fixed-roster-panel__icon"><ClipboardList size={19} /></span>
          <div>
            <span className="fixed-roster-panel__eyebrow">Configuration du service</span>
            <h2 id="fixed-roster-title">Tableur fixe</h2>
            <p>Définissez les fonctions attendues pour chaque planning fixe.</p>
          </div>
        </div>
        <div className="fixed-roster-panel__header-actions">
          <div className="fixed-roster-panel__stats">
            <span><strong>{normalizedSlots.length}</strong> fonctions</span>
            <span><strong>{totalPositions}</strong> postes</span>
            <span className="is-constant"><CheckCircle2 size={13} /> {constantPositions} constants</span>
          </div>
          <button
            type="button"
            className="fixed-roster-panel__collapse"
            onClick={() => onCollapsedChange?.(!collapsed)}
            aria-expanded={!collapsed}
            aria-controls="fixed-roster-panel-content"
            title={collapsed ? 'Afficher la configuration du Tableur fixe' : 'Réduire la configuration pour agrandir le tableur'}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            <span>{collapsed ? 'Afficher' : 'Réduire'}</span>
          </button>
        </div>
      </div>

      <div
        id="fixed-roster-panel-content"
        className="fixed-roster-panel__content"
        aria-hidden={collapsed}
        inert={collapsed}
      >
        <div className="fixed-roster-panel__content-inner">
          <div className="fixed-roster-panel__notice">
            <UsersRound size={16} />
            <span>Les fonctions marquées <strong>Constante</strong> seront proposées automatiquement dans les prochains Tableurs fixes de ce service. Les autres restent propres à ce planning.</span>
          </div>

          <div className="fixed-roster-panel__toolbar">
            <label className="fixed-roster-panel__search">
              <Search size={15} />
              <input value={functionSearch} onChange={(event) => setFunctionSearch(event.target.value)} placeholder="Filtrer les fonctions" />
            </label>
            <button type="button" className="fixed-roster-panel__add" onClick={addSlot} disabled={disabled || titlesLoading}>
              <Plus size={15} /> Ajouter une fonction
            </button>
            <button type="button" className="fixed-roster-panel__save" onClick={() => saveTemplate.mutate()} disabled={disabled || saveTemplate.isPending || templatesLoading}>
              <Save size={15} /> {saveTemplate.isPending ? 'Enregistrement…' : 'Enregistrer les constantes'}
            </button>
          </div>

          <div className="fixed-roster-panel__rows">
            {templatesLoading || titlesLoading ? (
              <div className="fixed-roster-panel__empty"><SlidersHorizontal size={22} /> Chargement de la configuration…</div>
            ) : normalizedSlots.length === 0 ? (
              <div className="fixed-roster-panel__empty">
                <ClipboardList size={24} />
                <strong>Aucune fonction définie</strong>
                <span>Ajoutez un poste pour composer le canevas du service.</span>
              </div>
            ) : (
              normalizedSlots.map((slot, index) => (
                <div
                  className={`fixed-roster-row${draggingSlotId === slot.id ? ' is-dragging' : ''}`}
                  key={slot.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveSlot(slot.id)}
                >
                  <span
                    className="fixed-roster-row__drag"
                    title="Réorganiser"
                    aria-hidden="true"
                    draggable={!disabled}
                    onDragStart={() => setDraggingSlotId(slot.id)}
                    onDragEnd={() => setDraggingSlotId(null)}
                  ><GripVertical size={16} /></span>
                  <span className="fixed-roster-row__index">{index + 1}</span>
                  <div className="fixed-roster-row__function">
                    <select
                      value={slot.jobTitleId || ''}
                      disabled={disabled}
                      onChange={(event) => {
                        const selected = titles.find((title) => title.id === event.target.value);
                        updateSlot(slot.id, { jobTitleId: selected?.id || null, functionName: selected?.name || slot.functionName });
                      }}
                    >
                      <option value="">Fonction personnalisée</option>
                      {visibleTitles.map((title) => <option key={title.id} value={title.id}>{title.name} · {categoryLabel(title.category)}</option>)}
                    </select>
                    <input
                      value={slot.functionName}
                      disabled={disabled}
                      onChange={(event) => updateSlot(slot.id, { functionName: event.target.value })}
                      aria-label={`Nom de la fonction ${index + 1}`}
                    />
                  </div>
                  <label className="fixed-roster-row__quantity">
                    <span>Postes</span>
                    <input type="number" min="1" max="50" value={slot.quantity} disabled={disabled} onChange={(event) => updateSlot(slot.id, { quantity: Math.min(Math.max(Number(event.target.value) || 1, 1), 50) })} />
                  </label>
                  <label className={`fixed-roster-row__constant${slot.isConstant ? ' is-checked' : ''}`}>
                    <input type="checkbox" checked={Boolean(slot.isConstant)} disabled={disabled} onChange={(event) => updateSlot(slot.id, { isConstant: event.target.checked })} />
                    <span><Check size={12} /> Constante</span>
                  </label>
                  <button type="button" className="fixed-roster-row__remove" onClick={() => removeSlot(slot.id)} disabled={disabled} aria-label={`Supprimer ${slot.functionName}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="fixed-roster-panel__footer">
            <span>{savedAt ? `Dernière sauvegarde à ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : template ? 'Configuration constante déjà enregistrée' : 'Configuration non enregistrée'}</span>
            <span className="fixed-roster-panel__legend"><span className="dot dot--constant" /> Réutilisée automatiquement <span className="dot dot--local" /> Ce planning seulement</span>
          </div>
        </div>
      </div>
    </section>
  );
}
