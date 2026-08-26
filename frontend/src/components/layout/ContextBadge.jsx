/**
 * Badge de contexte — hôpital d'appartenance et service(s) de l'utilisateur.
 *
 * Point 1 de la demande : rendre ces informations visibles partout (barre de
 * menu à gauche, Tableau de bord, Profil) pour tous les personnels **sauf le
 * Super Admin**, qui est transversal à la plateforme et n'appartient ni à un
 * hôpital ni à un service.
 *
 * Deux variantes d'affichage, un seul composant :
 *   - `sidebar` : compacte, sous le logo ; masquée quand le menu est replié
 *                 (règle `.sidebar.collapsed .ctx-badge` dans layout.css).
 *   - `header`  : étendue, en tête de page (Tableau de bord).
 *
 * Sources de données déjà existantes — aucun appel réseau ici :
 *   - `user.establishmentName` (camelCase) vient de `/auth/login` ;
 *     `establishment_name` est accepté en secours car `/auth/me` renvoie du
 *     snake_case et le store peut avoir été enrichi par cette route.
 *   - `user.departments` est alimenté par `/auth/me` : `{ id, name, name_ar,
 *     code, is_head, is_primary }`. `is_head` distingue le chef de service.
 */

import React from 'react';
import { useAuthStore, useUIStore } from '../../store';

/**
 * L'émoji `🏥` tenait lieu d'icône : il ne suit ni l'encre du thème ni la
 * graisse du trait, et il se dessine différemment sur chaque système. Un glyphe
 * au trait le remplace, à la couleur du texte qu'il accompagne.
 */
const HospitalMark = () => (
  <svg className="gsh-ctx-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <path d="M4 21V8a2 2 0 012-2h12a2 2 0 012 2v13" />
    <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    <line x1="12" y1="10" x2="12" y2="16" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="2" y1="21" x2="22" y2="21" />
  </svg>
);

export default function ContextBadge({ variant = 'header', className = '' }) {
  const user = useAuthStore((s) => s.user);
  const language = useUIStore((s) => s.language);

  // Le Super Admin n'a ni hôpital ni service à afficher.
  if (!user || user.roleCode === 'super_admin') return null;

  const isAr = language === 'ar';
  const establishment = isAr
    ? user.establishmentNameAr || user.establishment_name_ar || user.establishmentName || user.establishment_name
    : user.establishmentName || user.establishment_name;

  const departments = Array.isArray(user.departments) ? user.departments : [];
  if (!establishment && departments.length === 0) return null;

  const deptLabel = (d) => (isAr ? d.name_ar || d.name : d.name);

  // La couronne `👑` disait « chef de service » ; c'est un état, pas un ornement.
  // Un point rempli le porte, avec son intitulé lu à voix haute.
  const chip = (d) => (
    <span
      key={d.id}
      className={`ctx-chip${d.is_head ? ' ctx-chip-head' : ''}`}
      title={d.is_head ? `${deptLabel(d)} — chef de service` : deptLabel(d)}
    >
      {d.is_head && (
        <span className="gsh-chip-mark" aria-label="chef de service" role="img">●</span>
      )}
      {deptLabel(d)}
    </span>
  );

  if (variant === 'sidebar') {
    return (
      <div className={`ctx-badge ctx-badge-sidebar ${className}`.trim()}>
        {establishment && (
          <span className="ctx-hospital" title={establishment}>
            <HospitalMark />
            {establishment}
          </span>
        )}
        {departments.length > 0 && (
          <span className="ctx-depts">
            {departments.map(chip)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`ctx-badge ctx-badge-header ${className}`.trim()}>
      {establishment && (
        <span className="ctx-hospital ctx-hospital-lg" title={establishment}>
          <HospitalMark />
          {establishment}
        </span>
      )}
      {departments.length > 0 && (
        <span className="ctx-depts">
          <span className="ctx-depts-label">{isAr ? 'المصالح' : 'Service(s)'}</span>
          {departments.map(chip)}
        </span>
      )}
    </div>
  );
}
