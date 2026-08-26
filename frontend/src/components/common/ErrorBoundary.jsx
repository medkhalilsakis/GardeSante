import React from 'react';

/* Une exception levée pendant le rendu démonte l'arbre React entier : l'écran
   devient blanc, sans un mot. C'est exactement ce qui arrivait au chef de
   service quand il ouvrait la colonne « Périodes » d'une proposition — la cause
   était une valeur non affichable passée à une fenêtre, mais rien à l'écran ne
   permettait de le deviner.

   Cette barrière ne corrige aucun défaut : elle les rend lisibles. L'écran
   fautif est remplacé par un cartouche qui nomme l'erreur et laisse deux
   sorties — réessayer, ou revenir. Le reste de la plateforme continue de
   fonctionner autour. */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Trace de console : c'est là que le développeur lira la pile de composants.
    console.error('[ErrorBoundary]', this.props.label || 'écran', error, info?.componentStack);
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        margin: '24px auto', maxWidth: 620, padding: 24, borderRadius: 14,
        background: 'var(--gs-paper)', border: '1px solid var(--gs-alert)',
        boxShadow: 'var(--gs-shadow-card)',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
          color: 'var(--gs-alert)', marginBottom: 6,
        }}>
          Cet écran n'a pas pu s'afficher
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 900, color: 'var(--gs-ink)' }}>
          {this.props.label || 'Une erreur est survenue'}
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--gs-ink-soft)', lineHeight: 1.5 }}>
          Vos données ne sont pas perdues : rien n'a été enregistré. Réessayez, et
          si le message revient, signalez-le en citant la ligne ci-dessous.
        </p>
        <pre style={{
          margin: '0 0 16px', padding: '10px 12px', borderRadius: 8, overflowX: 'auto',
          background: 'var(--gs-paper-alt)', border: '1px solid var(--gs-rule)',
          fontSize: 11, color: 'var(--gs-ink-faint)', whiteSpace: 'pre-wrap',
        }}>
          {String(error?.message || error)}
        </pre>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="gs-btn is-primary" onClick={this.retry}>
            Réessayer
          </button>
          {this.props.onBack && (
            <button type="button" className="gs-btn is-quiet" onClick={this.props.onBack}>
              Revenir à la liste
            </button>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
