#!/usr/bin/env bash
# Vérifie qu'aucun jeton --gs-* utilisé dans les fichiers passés en argument
# n'est inconnu du calque de jetons, et compte les hex restants.
# Usage : bash scripts/check-tokens.sh src/pages/.../fichier.css [autres...]
set -u
cd "$(dirname "$0")/.." || exit 1
TOKENS=src/styles/gardesante-design.css
tmp=$(mktemp -d)
grep -oE -- "--gs-[a-z0-9-]+" "$TOKENS" | sort -u > "$tmp/known.txt"

status=0
for f in "$@"; do
  grep -oE -- "--gs-[a-z0-9-]+" "$f" | sort -u > "$tmp/used.txt"
  unknown=$(comm -23 "$tmp/used.txt" "$tmp/known.txt")
  hex=$(grep -oEi "#[0-9a-f]{3,8}\b" "$f" | grep -viE "^#fff$|^#ffffff$" | sort | uniq -c | tr '\n' ' ')
  grad=$(grep -ocEi "linear-gradient|radial-gradient" "$f")
  printf '%-64s jetons=%-3s hex=%s gradients=%s\n' "$(basename "$f")" "$(wc -l < "$tmp/used.txt")" "${hex:-0}" "$grad"
  if [ -n "$unknown" ]; then
    echo "   ✗ jetons inconnus : $(echo "$unknown" | tr '\n' ' ')"
    status=1
  fi
done
rm -rf "$tmp"
exit $status
