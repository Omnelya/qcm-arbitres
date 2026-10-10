import type { Structure } from '../lib/structures';

// Étiquette d'une structure : pastille de sa couleur + nom, sur un fond
// légèrement teinté. Le nom reste toujours écrit (la couleur seule ne
// suffit pas, notamment pour les personnes daltoniennes).
export default function BadgeStructure({
  structure,
  className = '',
}: {
  structure: Pick<Structure, 'name' | 'color'>;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-normal text-ink rounded px-2 py-0.5 border max-w-full ${className}`}
      style={{ backgroundColor: `${structure.color}14`, borderColor: `${structure.color}66` }}
    >
      <span
        aria-hidden="true"
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: structure.color }}
      />
      <span className="truncate">{structure.name}</span>
    </span>
  );
}

// Plusieurs structures à la suite (ex. QCM ciblant des groupes de deux
// structures).
export function BadgesStructures({ structures, className = '' }: { structures: Structure[]; className?: string }) {
  if (structures.length === 0) return null;
  return (
    <span className={`flex gap-1 flex-wrap ${className}`}>
      {structures.map((s) => (
        <BadgeStructure key={s.id} structure={s} />
      ))}
    </span>
  );
}
