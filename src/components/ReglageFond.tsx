import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { couleursDominantes, type ZoneLibre } from '../lib/zoneLibreFond';

// Réglage de l'arrière-plan du support : on dessine la zone à remplir et on prélève (pipette) la couleur des titres.
export default function ReglageFond({
  fond,
  zone,
  onZone,
  zoneAuto,
  couleur,
  onCouleur,
}: {
  fond: string;
  zone: ZoneLibre;
  onZone: (z: ZoneLibre) => void;
  zoneAuto: ZoneLibre | null;
  couleur: string; // hex sans #
  onCouleur: (hex: string) => void;
}) {
  const [mode, setMode] = useState<'zone' | 'pipette'>('zone');
  const [brouillon, setBrouillon] = useState<ZoneLibre | null>(null);
  const [palette, setPalette] = useState<string[]>([]);
  const cadre = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const debut = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    couleursDominantes(fond).then(setPalette);
  }, [fond]);

  // position du pointeur en fractions de l'image (0 à 1)
  const position = (e: PointerEvent) => {
    const r = cadre.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  function prelever(p: { x: number; y: number }) {
    const el = img.current;
    if (!el || !el.naturalWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = el.naturalWidth;
    canvas.height = el.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(el, 0, 0);
    const [r, g, b] = ctx.getImageData(Math.min(canvas.width - 1, Math.floor(p.x * canvas.width)), Math.min(canvas.height - 1, Math.floor(p.y * canvas.height)), 1, 1).data;
    onCouleur([r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase());
    setMode('zone');
  }

  const rectangle = (a: { x: number; y: number }, b: { x: number; y: number }): ZoneLibre => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  function appuyer(e: PointerEvent) {
    const p = position(e);
    if (mode === 'pipette') return prelever(p);
    e.currentTarget.setPointerCapture(e.pointerId);
    debut.current = p;
    setBrouillon({ ...p, w: 0, h: 0 });
  }
  function bouger(e: PointerEvent) {
    if (debut.current) setBrouillon(rectangle(debut.current, position(e)));
  }
  function relacher(e: PointerEvent) {
    if (!debut.current) return;
    const z = rectangle(debut.current, position(e));
    debut.current = null;
    setBrouillon(null);
    if (z.w >= 0.08 && z.h >= 0.08) onZone(z); // un simple clic ou une zone minuscule ne change rien
  }

  const affichee = brouillon ?? zone;
  const bouton = (actif: boolean) =>
    'flex-1 text-sm rounded-xl py-1.5 border ' + (actif ? 'bg-pitch text-white border-pitch' : 'border-border bg-canvas');

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <div className="flex gap-2 mb-2">
        <button type="button" onClick={() => setMode('zone')} className={bouton(mode === 'zone')}>
          Dessiner la zone
        </button>
        <button type="button" onClick={() => setMode('pipette')} className={bouton(mode === 'pipette')}>
          Pipette (couleur des titres)
        </button>
      </div>
      <p className="text-xs text-muted mb-2">
        {mode === 'zone'
          ? "Fais glisser sur l'image pour entourer la zone où placer les questions et réponses (le cadre vert)."
          : "Clique sur l'image, sur la couleur voulue pour les titres."}
      </p>

      <div
        ref={cadre}
        onPointerDown={appuyer}
        onPointerMove={bouger}
        onPointerUp={relacher}
        className={'relative select-none touch-none mx-auto w-full max-w-xl ' + (mode === 'pipette' ? 'cursor-copy' : 'cursor-crosshair')}
      >
        <img ref={img} src={fond} alt="Arrière-plan" draggable={false} className="w-full rounded border border-border block" />
        <div
          aria-label="Zone où le texte sera placé"
          className="absolute border-2 border-dashed border-pitch bg-pitch/15 pointer-events-none"
          style={{ left: `${affichee.x * 100}%`, top: `${affichee.y * 100}%`, width: `${affichee.w * 100}%`, height: `${affichee.h * 100}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-2 mt-2 mb-4">
        {zoneAuto && (
          <button type="button" onClick={() => onZone(zoneAuto)} className="text-xs border border-border rounded-xl px-3 py-1.5 bg-canvas">
            Zone automatique
          </button>
        )}
        <button type="button" onClick={() => onZone({ x: 0.04, y: 0.04, w: 0.92, h: 0.92 })} className="text-xs border border-border rounded-xl px-3 py-1.5 bg-canvas">
          Toute la page
        </button>
      </div>

      <p className="text-sm font-semibold mb-1">Couleur des titres</p>
      <div className="flex flex-wrap items-center gap-2">
        {palette.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Couleur #${c}`}
            onClick={() => onCouleur(c)}
            className={'w-8 h-8 rounded-full border-2 ' + (c === couleur ? 'border-ink' : 'border-border')}
            style={{ background: `#${c}` }}
          />
        ))}
        <input
          type="color"
          aria-label="Choisir une autre couleur"
          value={`#${couleur}`}
          onChange={(e) => onCouleur(e.target.value.slice(1).toUpperCase())}
          className="w-10 h-8 p-0 border border-border rounded"
        />
        <span className="text-sm font-semibold ml-1" style={{ color: `#${couleur}` }}>
          Question 1 / 20 · #{couleur}
        </span>
      </div>
    </div>
  );
}
