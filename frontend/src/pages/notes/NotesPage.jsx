/**
 * Notes et circulaires — écran indépendant (point 7).
 *
 * L'énoncé demande de sortir les notes du planning des gardes et de leur donner
 * une entrée propre dans le menu de gauche. Le fil (`NotesFeed`) et le
 * compositeur (`NoteComposer`) existent déjà et sont autonomes : cette page les
 * enveloppe, elle ne les duplique pas — exactement comme `StaffLoansPage`
 * enveloppe `StaffLoansPanel`.
 *
 * Le compositeur n'apparaît que pour les rôles qui publient réellement. La liste
 * ci-dessous est le miroir de `resolveScope()`
 * (`backend/src/modules/notes/notes.controller.js`) : c'est le serveur qui
 * décide de l'audience, jamais le client. Afficher un bouton qui finirait en 403
 * serait pire que de ne pas l'afficher.
 */

import React from 'react';
import { useAuthStore } from '../../store';
import ContextBadge from '../../components/layout/ContextBadge';
import NoteComposer from '../../components/notes/NoteComposer';
import NotesFeed from '../../components/notes/NotesFeed';

/**
 * Portée de publication par rôle — miroir de `resolveScope()` côté serveur.
 * `null` = ce rôle lit les notes mais n'en publie pas.
 */
const PUBLISH_SCOPE = {
  super_admin:        'tous les directeurs de la plateforme',
  director:           'tout le personnel de l\'hôpital',
  hospital_admin:     'tout le personnel de l\'hôpital',
  general_supervisor: 'tout le personnel de l\'hôpital',
  department_head:    'le personnel du service',
};

/** Ce que chaque rôle reçoit, pour expliquer le fil sans le faire deviner. */
const READ_HINT = {
  super_admin:        'Vous voyez les notes de la plateforme.',
  director:           'Vous voyez les notes de la plateforme et celles de votre hôpital.',
  hospital_admin:     'Vous voyez les notes de la plateforme et celles de votre hôpital.',
  general_supervisor: 'Vous voyez les notes de votre hôpital et celles de ses services.',
};

export default function NotesPage() {
  const { user } = useAuthStore();
  const publishScope = PUBLISH_SCOPE[user?.roleCode] || (user?.isSuperAdmin ? PUBLISH_SCOPE.super_admin : null);
  const readHint = READ_HINT[user?.roleCode] || 'Vous voyez les notes qui concernent votre hôpital et votre service.';

  return (
    <div>
      <ContextBadge variant="header" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Notes et circulaires</h1>
          <p className="page-subtitle">
            {publishScope
              ? `Publiez et consultez les notes de service. Vos publications sont diffusées à ${publishScope}.`
              : `Consultez les notes et circulaires qui vous sont adressées. ${readHint}`}
          </p>
        </div>
      </div>

      {/* Le compositeur garde sa propre carte et sa propre marge basse. */}
      {publishScope && <NoteComposer scopeLabel={publishScope} />}

      {/* `NotesFeed` porte déjà son en-tête, ses filtres et sa modale de lecture.
          Il applique son propre padding : on l'enveloppe dans une carte sans
          padding pour ne pas doubler les marges. */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <NotesFeed />
      </div>
    </div>
  );
}
