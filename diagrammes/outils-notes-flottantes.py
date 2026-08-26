"""Convertit les notes attachees a un paquet en notes flottantes reliees a un cas.

Motif : avec le moteur de mise en page smetana (PlantUML sans Graphviz), une
note ancree sur un paquet est placee hors du cadre — ordonnee negative — donc
rognee au rendu, et elle entraine le titre avec elle. Une note flottante reliee
a un noeud est un sommet du graphe : elle est positionnee a l'interieur.

Le script ne touche que les notes dont la cible est un paquet declare dans le
meme fichier. Les notes ancrees sur un acteur ou sur un cas sont laissees en
place : leur rendu est correct.
"""
import re
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent / 'puml'


def paquets_et_premier_cas(texte):
    """Associe chaque alias de paquet a l'alias de son premier cas d'utilisation."""
    resultat = {}
    paquet_courant = None
    for ligne in texte.splitlines():
        m_paquet = re.match(r'\s*package\s+".*?"\s+as\s+(\w+)\s*\{', ligne)
        if m_paquet:
            paquet_courant = m_paquet.group(1)
            continue
        if paquet_courant and re.match(r'\s*\}', ligne):
            paquet_courant = None
            continue
        m_cas = re.match(r'\s*usecase\s+".*?"\s+as\s+(\w+)', ligne)
        if m_cas and paquet_courant and paquet_courant not in resultat:
            resultat[paquet_courant] = m_cas.group(1)
    return resultat


def convertir(chemin):
    texte = chemin.read_text(encoding='utf-8')
    cibles = paquets_et_premier_cas(texte)
    lignes = texte.splitlines()
    sortie, liens, compteur = [], [], 0

    i = 0
    while i < len(lignes):
        m = re.match(r'\s*note\s+(?:bottom|top|left|right)\s+of\s+(\w+)\s*$', lignes[i])
        if m and m.group(1) in cibles:
            compteur += 1
            alias_note = f'N{compteur}'
            sortie.append(f'note as {alias_note}')
            liens.append(f'{alias_note} .. {cibles[m.group(1)]}')
            i += 1
            while i < len(lignes) and not re.match(r'\s*end note\s*$', lignes[i]):
                sortie.append(lignes[i])
                i += 1
            sortie.append('end note')
            i += 1
            continue
        sortie.append(lignes[i])
        i += 1

    if not liens:
        return 0

    # Les liens sont poses juste avant @enduml, apres toutes les declarations.
    fin = max(idx for idx, l in enumerate(sortie) if l.strip() == '@enduml')
    sortie[fin:fin] = ['', "' Ancrage des notes flottantes"] + liens + ['']
    chemin.write_text('\n'.join(sortie) + '\n', encoding='utf-8')
    return len(liens)


if __name__ == '__main__':
    total = 0
    for fichier in sorted(RACINE.glob('*.puml')):
        n = convertir(fichier)
        total += n
        print(f'{fichier.name:44s} {n} note(s) converties')
    print(f'\n{total} note(s) au total')
    sys.exit(0)
