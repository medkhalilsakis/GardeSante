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
import CirculaireDiffusionPanel from '../superadmin/components/CirculaireDiffusionPanel';
import { BookOpen, Megaphone } from 'lucide-react';
import { GsBadge, GsPageHeader, GsPanel } from '../../components/gs';
import './notes.css';

/**
 * Portée de publication par rôle — miroir de `resolveScope()` côté serveur.
 * `null` = ce rôle lit les notes mais n'en publie pas.
 *
 * La préposition fait partie de l'intitulé : « à » se contracte en « au » devant
 * un masculin singulier, et le français ne permet pas de la calculer depuis le
 * groupe nominal. La coller ici est la seule façon d'écrire « au personnel du
 * service » sans écrire « à le personnel du service » ailleurs.
 */
const PUBLISH_SCOPE = {
  super_admin:        'à tous les directeurs de la plateforme',
  director:           'à tout le personnel de l\'hôpital',
  hospital_admin:     'à tout le personnel de l\'hôpital',
  general_supervisor: 'à tout le personnel de l\'hôpital',
  department_head:    'au personnel du service',
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
  const isSuperAdmin = user?.roleCode === 'super_admin' || user?.isSuperAdmin === true;
  const publishScope = PUBLISH_SCOPE[user?.roleCode] || (user?.isSuperAdmin ? PUBLISH_SCOPE.super_admin : null);
  const readHint = READ_HINT[user?.roleCode] || 'Vous voyez les notes qui concernent votre hôpital et votre service.';

  return (
    <div className="gsn-wrap">
      <ContextBadge variant="header" />

      <GsPageHeader eyebrow="Communication institutionnelle" title="Notes et circulaires"
        subtitle={publishScope
          ? `Publiez et consultez les notes de service. Vos publications sont diffusées ${publishScope}.`
          : `Consultez les notes et circulaires qui vous sont adressées. ${readHint}`}
        actions={<GsBadge tone={publishScope ? 'seal' : 'quiet'} icon={publishScope ? <Megaphone size={13} /> : <BookOpen size={13} />}>
          {publishScope ? 'Publication autorisée' : 'Lecture'}
        </GsBadge>}
      />

      {/* Le compositeur garde sa propre carte et sa propre marge basse. */}
      {publishScope && <NoteComposer scopeLabel={publishScope} />}

      {/* Suivi de diffusion des circulaires nationales (Lot X5). Réservé au
          Super Admin : lui seul publie à l'échelle de la plateforme, et cet
          écran doit valoir l'onglet « Notes » de son tableau de bord — une
          entrée de menu qui mènerait à moins serait un recul. Les autres rôles
          ne voient rien de plus qu'avant. */}
      {isSuperAdmin && (
        <div className="gsn-diffusion">
          <CirculaireDiffusionPanel />
        </div>
      )}

      {/* `NotesFeed` porte déjà son en-tête, ses filtres et sa modale de lecture.
          Il applique son propre padding : on l'enveloppe dans une carte sans
          padding pour ne pas doubler les marges. */}
      <GsPanel title="Fil des notes" sub="Les notes urgentes restent visibles jusqu’à leur lecture." flush>
        <NotesFeed />
      </GsPanel>
    </div>
  );
}
