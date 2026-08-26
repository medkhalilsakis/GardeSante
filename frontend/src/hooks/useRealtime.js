/**
 * Hook React pour le temps réel — s'abonne aux événements socket.io et invalide les queries react-query
 * Usage: dans AppLayout, appeler useRealtime() une seule fois
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore, useNotificationStore } from '../store';
import { notificationsAPI } from '../api';
import { connect, disconnect, authenticate, joinEstablishment, joinDepartment, on, off } from '../realtime/socket';

/**
 * Retire une ligne du tableur dans une entrée de cache `['schedule-detail', id]`.
 *
 * La source de vérité du tableur est `schedule.metadata.spreadsheet.rows` (et
 * non la table `shifts`). Les écrans qui lisent cette clé y stockent la réponse
 * axios entière (`{ data: { data: { schedule, … } } }`), mais on traverse aussi
 * la forme déballée : un futur lecteur qui l'écrirait ne casserait pas ce
 * retrait. On renvoie `old` inchangé si la ligne n'y est pas — l'invalidation
 * qui suit fait foi.
 */
const dropSpreadsheetRow = (old, staffUserId) => {
  if (!old || typeof old !== 'object') return old;

  const filter = (schedule) => {
    const rows = schedule?.metadata?.spreadsheet?.rows;
    if (!Array.isArray(rows)) return null;
    const next = rows.filter((r) => r.userId !== staffUserId);
    if (next.length === rows.length) return null;
    return {
      ...schedule,
      metadata: {
        ...schedule.metadata,
        spreadsheet: { ...schedule.metadata.spreadsheet, rows: next },
      },
    };
  };

  // Forme déballée : { schedule, shifts, … }
  if (old.schedule) {
    const schedule = filter(old.schedule);
    return schedule ? { ...old, schedule } : old;
  }
  // Forme axios : { data: { success, data: { schedule, … } } }
  const inner = old.data?.data;
  if (inner?.schedule) {
    const schedule = filter(inner.schedule);
    if (!schedule) return old;
    return { ...old, data: { ...old.data, data: { ...inner, schedule } } };
  }
  return old;
};

export const useRealtime = () => {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuthStore();
  const setNotifications = useNotificationStore((s) => s.setNotifications);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    // Connexion + authentification + rooms
    connect();
    authenticate(user.id);
    if (user.establishmentId) {
      joinEstablishment(user.establishmentId);
    }
    // Services de l'acteur. `user.departments[]` est alimenté par `/auth/me`
    // (même source que `ContextBadge`) ; `user.departmentId` n'existe QUE côté
    // serveur (`middleware/auth.js`) et n'est jamais envoyé au client — s'y
    // fier revenait à ne jamais rejoindre `department:<service>`, la room visée
    // par le retrait de ligne après refus d'un prêt. Il reste toléré en secours.
    const myDepartments = Array.isArray(user.departments) ? user.departments : [];
    myDepartments.forEach((d) => { if (d?.id) joinDepartment(d.id); });
    if (user.departmentId) {
      joinDepartment(user.departmentId);
    }

    // Notifications — le store Zustand alimente le badge du Header (pas react-query)
    const handleNotification = async () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      try {
        const res = await notificationsAPI.getAll({ unreadOnly: true, limit: 5 });
        setNotifications(res.data.data, res.data.unreadCount);
      } catch {}
    };

    // Remplacements
    const handleReplacement = (payload) => {
      queryClient.invalidateQueries({ queryKey: ['replacements'] });
      if (payload?.scheduleId) {
        queryClient.invalidateQueries({ queryKey: ['schedules', payload.scheduleId] });
      }
    };

    // Absences
    const handleAbsence = (payload) => {
      queryClient.invalidateQueries({ queryKey: ['absences'] });
      // En react-query v5 le préfixe se compare élément par élément : `['absences']`
      // ne couvre PAS `['absences-shift', …]`. Les absences déclarées à l'appel du
      // jour vivent sur cette seconde clé (badge de l'onglet « Absences » du chef,
      // panneau des signalements) — sans cette ligne, elles n'arrivaient qu'au
      // rafraîchissement périodique de 60 s.
      queryClient.invalidateQueries({ queryKey: ['absences-shift'] });
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal-overview'] });
      if (payload?.scheduleId) {
        queryClient.invalidateQueries({ queryKey: ['schedules', payload.scheduleId] });
      }
      if (payload?.userId) {
        queryClient.invalidateQueries({ queryKey: ['portfolio', payload.userId] });
      }
    };

    // Notes
    const handleNote = () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    };

    // Alertes
    const handleAlert = () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    };

    // Journal de service
    const handleShiftEvent = (payload) => {
      queryClient.invalidateQueries({ queryKey: ['shift-events'] });
      if (payload?.scheduleId) {
        queryClient.invalidateQueries({ queryKey: ['schedules', payload.scheduleId] });
      }
    };

    // Prêts de personnel — une décision change aussi la couleur (ou l'existence)
    // de la ligne correspondante dans le tableur du service demandeur.
    const handleStaffLoan = (payload) => {
      queryClient.invalidateQueries({ queryKey: ['staff-loans'] });
      if (payload?.scheduleId) {
        queryClient.invalidateQueries({ queryKey: ['schedule-detail', payload.scheduleId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['schedule-detail'] });
      }
    };

    // Ligne retirée après refus d'un prêt : le planning garde son état, seule la
    // ligne disparaît. On la retire d'abord du cache (l'agent quitte le tableur
    // immédiatement, sans attendre l'aller-retour réseau), puis on invalide pour
    // que le serveur confirme. `SmartSpreadsheet` recalcule ses lignes dès que
    // `scheduleDetail` change, la disparition est donc automatique.
    const handleStaffRemoved = (payload) => {
      const { scheduleId, staffUserId } = payload || {};
      if (scheduleId && staffUserId) {
        queryClient.setQueriesData(
          { queryKey: ['schedule-detail', scheduleId] },
          (old) => dropSpreadsheetRow(old, staffUserId)
        );
      }
      queryClient.invalidateQueries({ queryKey: ['schedule-detail'] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    };

    // Compte archivé par le Super Admin : la session doit tomber tout de suite,
    // sans attendre la prochaine requête HTTP.
    const handleAccountArchived = () => {
      try { useAuthStore.getState().logout(); } catch {}
      window.location.href = '/login';
    };

    // Journal et alertes — noms réellement émis par le backend
    // (`journal:event`, `alert:updated`). Les clés react-query du Lot 4 sont
    // `journal-events`, `journal-alerts` et `journal-overview`.
    const handleJournal = () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal-events'] });
      queryClient.invalidateQueries({ queryKey: ['journal-overview'] });
    };
    const handleAlertChange = () => {
      queryClient.invalidateQueries({ queryKey: ['journal-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['journal-overview'] });
    };

    // Supervision hôpital (Lot 5) — tout ce qui bouge dans un service change la
    // vue d'ensemble, la cohérence inter-services ou les prêts de personnel.
    //
    // Les deux vues de pilotage ajoutées depuis (directeur, Lot Y1 ; chef de
    // service, Lot Z3) lisent les MÊMES faits en un seul appel : elles doivent
    // donc se rafraîchir sur exactement les mêmes événements, sinon un chef lit
    // 8 gardes pendant que son surveillant en voit 9. `deptDetail` suit, car
    // l'effectif du service change avec les mêmes actions.
    const handleSupervision = () => {
      queryClient.invalidateQueries({ queryKey: ['supervision-overview'] });
      queryClient.invalidateQueries({ queryKey: ['supervision-conflicts'] });
      queryClient.invalidateQueries({ queryKey: ['supervision-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['supervision-loans'] });
      queryClient.invalidateQueries({ queryKey: ['chef-overview'] });
      queryClient.invalidateQueries({ queryKey: ['director-overview'] });
      queryClient.invalidateQueries({ queryKey: ['deptDetail'] });
    };
    const SUPERVISION_EVENTS = [
      'absence:reported', 'absence:updated', 'leave:created', 'leave:cancelled',
      'replacement:created', 'replacement:confirmed', 'replacement:rejected',
      'alert:new', 'alert:updated', 'journal:event',
      'staff-loan:requested', 'staff-loan:decided', 'supervision:report',
      'schedule:submitted', 'schedule:activated',
      // Ajouts : un planning créé ou modifié change le nombre de brouillons, la
      // garde du jour et l'équité de la charge ; une alerte acquittée fait
      // baisser « non acquittées ». Aucun de ces trois événements ne rafraîchissait
      // quoi que ce soit d'un tableau de bord.
      'schedule:created', 'schedule:updated', 'alert:acknowledged',
      // Une proposition déposée ou arbitrée change le compteur « en attente »
      // des tableaux de bord chef et surveillance.
      'schedule:change-proposal',
    ];

    // Cycle de vie du planning — l'envoi le met en vigueur et la date de début
    // le met en cours (job `schedule-activation`). Les deux doivent apparaître
    // sans rechargement chez le chef, les surveillants et le SG.
    const handleScheduleLifecycle = (payload) => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['supervision-schedules'] });
      if (payload?.scheduleId) {
        queryClient.invalidateQueries({ queryKey: ['schedule', String(payload.scheduleId)] });
        queryClient.invalidateQueries({ queryKey: ['schedule-detail', payload.scheduleId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['schedule-detail'] });
      }
    };

    // Propositions de modification d'un planning en vigueur : la liste vit sous
    // sa propre clé, qu'aucun autre gestionnaire n'invalide. Le surveillant voit
    // la décision du chef, et le chef voit la proposition arriver.
    const handleChangeProposal = (payload) => {
      queryClient.invalidateQueries({ queryKey: ['schedule-change-proposals'] });
      handleScheduleLifecycle(payload);
    };

    // Enregistrement des listeners
    on('notification:new', handleNotification);
    on('replacement:created', handleReplacement);
    on('replacement:confirmed', handleReplacement);
    on('replacement:rejected', handleReplacement);
    on('absence:reported', handleAbsence);
    on('absence:updated', handleAbsence);
    on('leave:created', handleAbsence);
    on('leave:cancelled', handleAbsence);
    on('note:published', handleNote);
    on('alert:new', handleAlert);
    on('alert:acknowledged', handleAlert);
    on('shift-event:created', handleShiftEvent);
    on('staff-loan:requested', handleStaffLoan);
    on('staff-loan:decided', handleStaffLoan);
    on('schedule:staff-removed', handleStaffRemoved);
    on('schedule:updated', handleStaffRemoved);
    on('schedule:submitted', handleScheduleLifecycle);
    on('schedule:activated', handleScheduleLifecycle);
    on('schedule:change-proposal', handleChangeProposal);
    on('account:archived', handleAccountArchived);
    on('journal:event', handleJournal);
    on('alert:updated', handleAlertChange);
    on('alert:new', handleAlertChange);
    SUPERVISION_EVENTS.forEach((e) => on(e, handleSupervision));

    // Cleanup
    return () => {
      off('notification:new', handleNotification);
      off('replacement:created', handleReplacement);
      off('replacement:confirmed', handleReplacement);
      off('replacement:rejected', handleReplacement);
      off('absence:reported', handleAbsence);
      off('absence:updated', handleAbsence);
      off('leave:created', handleAbsence);
      off('leave:cancelled', handleAbsence);
      off('note:published', handleNote);
      off('alert:new', handleAlert);
      off('alert:acknowledged', handleAlert);
      off('shift-event:created', handleShiftEvent);
      off('staff-loan:requested', handleStaffLoan);
      off('staff-loan:decided', handleStaffLoan);
      off('schedule:staff-removed', handleStaffRemoved);
      off('schedule:updated', handleStaffRemoved);
      off('schedule:submitted', handleScheduleLifecycle);
      off('schedule:activated', handleScheduleLifecycle);
      off('schedule:change-proposal', handleChangeProposal);
      off('account:archived', handleAccountArchived);
      off('journal:event', handleJournal);
      off('alert:updated', handleAlertChange);
      off('alert:new', handleAlertChange);
      SUPERVISION_EVENTS.forEach((e) => off(e, handleSupervision));
      disconnect();
    };
    // `user.departments` est un tableau : on dépend de la liste de ses ids, pas
    // de sa référence, sinon l'effet se relancerait à chaque `/auth/me`.
  }, [isAuthenticated, user?.id, user?.establishmentId, user?.departmentId,
      (user?.departments || []).map((d) => d.id).join(','),
      queryClient, setNotifications]);
};
