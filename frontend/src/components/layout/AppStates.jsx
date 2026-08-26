/**
 * Les trois états de la coque — chargement, accès refusé, adresse inconnue
 * ═══════════════════════════════════════════════════════════════════════
 * Ils vivaient en styles en ligne au milieu du routeur (`App.jsx`), avec des
 * tailles et des couleurs qui n'appartenaient à aucun des trois rôles
 * typographiques. Ce sont pourtant les premiers écrans que voit un utilisateur
 * quand quelque chose ne va pas : ils méritent la même langue que le reste.
 *
 * Chacun dit ce qui se passe **et** ce qu'on peut faire ensuite. Un état vide
 * qui ne propose rien laisse l'utilisateur dans une impasse.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import './app-states.css';

/**
 * Attente du chargement d'un écran. Pas de roue qui tourne : un filet qui se
 * remplit, du même vocabulaire que les filets de mesure du reste de la
 * plateforme. Immobile si le système demande moins d'animation.
 */
export function PageLoader() {
  return (
    <div className="gss-load" role="status" aria-live="polite">
      <div className="gss-load-inner">
        <p className="gss-load-mark">GardeSante</p>
        <div className="gss-load-rule"><span /></div>
        <p className="gss-load-note">Chargement de l'écran…</p>
      </div>
    </div>
  );
}

/**
 * Le cloisonnement par rôle est une règle du métier, pas une panne : le message
 * l'énonce sans s'excuser, nomme l'autorisation attendue quand on la connaît —
 * c'est elle qu'il faudra citer pour la demander — et rouvre une porte.
 */
export function AccessDenied({ permission, home = '/dashboard' }) {
  return (
    <div className="gss-page gss-page-inset">
      <div className="gss-page-inner">
        <p className="gs-eyebrow">Accès restreint</p>
        <h1 className="gss-page-title">Cet écran ne vous est pas ouvert</h1>
        <p className="gss-page-note">
          Votre rôle ne comporte pas l'autorisation nécessaire pour consulter cette page.
          {permission ? ' Demandez son ouverture à votre direction en citant l’autorisation ci-dessous.' : ' Demandez son ouverture à votre direction si vous devez y accéder.'}
        </p>
        {permission && (
          <p className="gss-page-key">
            <span>Autorisation requise</span>
            <code>{permission}</code>
          </p>
        )}
        <Link to={home} className="gs-btn">Retour au tableau de bord</Link>
      </div>
    </div>
  );
}

/** Adresse hors registre. Le code d'erreur est une donnée : il va au registre. */
export function NotFound({ home = '/dashboard' }) {
  return (
    <div className="gss-page">
      <div className="gss-page-inner">
        <p className="gss-code">404</p>
        <h1 className="gss-page-title">Page introuvable</h1>
        <p className="gss-page-note">
          Cette adresse ne figure pas au registre. Elle a peut-être changé, ou le lien
          qui vous a mené ici est ancien.
        </p>
        <Link to={home} className="gs-btn is-primary">Retour au tableau de bord</Link>
      </div>
    </div>
  );
}
