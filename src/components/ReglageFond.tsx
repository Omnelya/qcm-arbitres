import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { couleursDominantes, type ZoneLibre } from '../lib/zoneLibreFond';
import { miseEnPageQuestion, type CouleursTexte, type QuestionCorrection } from '../lib/exportPowerPoint';

// Prise de la zone : un côté, un coin, ou tout le cadre (pour le déplacer).
type Prise = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'deplacer';

const MIN = 0.15; // taille minimale de la zone (fraction de l'image)
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const po = (n: number) => `${(n * 100) / 13.33}cqw`; // 1 po de diapositive, en fonction de la largeur de l'aperçu
const pt = (n: number) => po(n / 72);

const POIGNEES: { prise: Prise; style: React.CSSProperties; curseur: string }[] = [
  { prise: 'n', style: { left: 8, right: 8, top: -7, height: 14 }, curseur: 'ns-resize' },
  { prise: 's', style: { left: 8, right: 8, bottom: -7, height: 14 }, curseur: 'ns-resize' },
  { prise: 'w', style: { top: 8, bottom: 8, left: -7, width: 14 }, curseur: 'ew-resize' },
  { prise: 'e', style: { top: 8, bottom: 8, right: -7, width: 14 }, curseur: 'ew-resize' },
  { prise: 'nw', style: { top: -7, left: -7, width: 16, height: 16 }, curseur: 'nwse-resize' },
  { prise: 'se', style: { bottom: -7, right: -7, width: 16, height: 16 }, curseur: 'nwse-resize' },
  { prise: 'ne', style: { top: -7, right: -7, width: 16, height: 16 }, curseur: 'nesw-resize' },
  { prise: 'sw', style: { bottom: -7, left: -7, width: 16, height: 16 }, curseur: 'nesw-resize' },
];

const ROLES: { cle: keyof CouleursTexte; libelle: string }[] = [
  { cle: 'titres', libelle: 'Titres' },
  { cle: 'enonce', libelle: 'Énoncé des questions' },
  { cle: 'reponses', libelle: 'Réponses' },
];

// Réglage de l'arrière-plan du support : zone à remplir (déformable aux côtés), aperçu de la 1re question, couleurs des polices.
export default function ReglageFond({
  fond,
  zone,
  onZone,
  zoneAuto,
  couleurs,
  onCouleurs,
  apercu,
  total,
}: {
  fond: string;
  zone: ZoneLibre;
  onZone: (z: ZoneLibre) => void;
  zoneAuto: ZoneLibre | null;
  couleurs: CouleursTexte;
  onCouleurs: (c: CouleursTexte) => void;
  apercu: QuestionCorrection | null; // première question, montrée dans la zone
  total: number;
}) {
  const [palette, setPalette] = useState<string[]>([]);
  const cadre = useRef<HTMLDivElement>(null);
  const prise = useRef<{ type: Prise; x: number; y: number; z: ZoneLibre } | null>(null);

  useEffect(() => {
    couleursDominantes(fond).then((c) => setPalette([...c, '1E2A24', 'FFFFFF']));
  }, [fond]);

  function saisir(e: PointerEvent, type: Prise) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = cadre.current!.getBoundingClientRect();
    prise.current = { type, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, z: zone };
  }
  function bouger(e: PointerEvent) {
    const p = prise.current;
    if (!p) return;
    const r = cadre.current!.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - p.x;
    const dy = (e.clientY - r.top) / r.height - p.y;
    let { x, y, w, h } = p.z;
    if (p.type === 'deplacer') {
      x = clamp(x + dx, 0, 1 - w);
      y = clamp(y + dy, 0, 1 - h);
    } else {
      if (p.type.includes('w')) {
        const nx = clamp(x + dx, 0, x + w - MIN);
        w = x + w - nx;
        x = nx;
      }
      if (p.type.includes('e')) w = clamp(w + dx, MIN, 1 - x);
      if (p.type.includes('n')) {
        const ny = clamp(y + dy, 0, y + h - MIN);
        h = y + h - ny;
        y = ny;
      }
      if (p.type.includes('s')) h = clamp(h + dy, MIN, 1 - y);
    }
    onZone({ x, y, w, h });
  }

  // Aperçu de la 1re question, avec la même mise en page que le PowerPoint
  const Zi = { x: zone.x * 13.33, y: zone.y * 7.5, w: zone.w * 13.33, h: zone.h * 7.5 };
  const X0 = Zi.x + 0.15;
  const W = Zi.w - 0.3;
  const L = apercu ? miseEnPageQuestion(apercu, { W, yContenu: Zi.y + 0.75, bas: Zi.y + Zi.h - 0.1 }) : null;
  const abs = (x: number, y: number, w: number, h: number): React.CSSProperties => ({ position: 'absolute', left: po(x), top: po(y), width: po(w), height: po(h), overflow: 'hidden' });

  return (
    <div className="bg-surface rounded-2xl border border-border p-4">
      <p className="text-xs text-muted mb-2">
        Le cadre vert est la zone des questions et réponses. Approchez la souris d'un côté ou d'un coin pour l'étirer (double flèche), ou glissez à l'intérieur pour le
        déplacer.
      </p>

      <div ref={cadre} className="relative select-none touch-none mx-auto w-full max-w-xl" style={{ containerType: 'inline-size' }} onPointerMove={bouger} onPointerUp={() => (prise.current = null)}>
        <img src={fond} alt="Arrière-plan" draggable={false} className="w-full rounded border border-border block" />

        {apercu && L && (
          <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ fontFamily: 'Calibri, Carlito, sans-serif', lineHeight: 1.2 }}>
            <div style={{ ...abs(X0, Zi.y + 0.05, W - 2.6, 0.55), display: 'flex', alignItems: 'center', fontSize: pt(18), fontWeight: 700, color: `#${couleurs.titres}` }}>
              Question 1 / {total} · Réponses
            </div>
            {apercu.moyenne != null && (
              <div
                style={{ ...abs(X0 + W - 2.5, Zi.y + 0.1, 2.5, 0.45), display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: po(0.2), background: `#${couleurs.titres}`, color: '#fff', fontSize: pt(16), fontWeight: 700 }}
              >
                Moyenne : {apercu.moyenne} %
              </div>
            )}
            <div style={{ ...abs(X0, Zi.y + 0.65, W, 0.02), background: `#${couleurs.titres}` }} />
            <div style={{ ...abs(X0, Zi.y + 0.75, W, L.hEnonce), fontSize: pt(L.police), fontWeight: 700, color: `#${couleurs.enonce}`, whiteSpace: 'pre-line' }}>{L.enonce}</div>
            {apercu.options.map((o, i) => (
              <div
                key={i}
                style={{
                  ...abs(X0, L.yOpt + i * L.hauteurLigne, W, L.hauteurLigne - 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  padding: `0 ${po(0.2)}`,
                  boxSizing: 'border-box',
                  background: 'rgba(255,255,255,.9)',
                  border: '1px solid #C9D3E3',
                  borderRadius: po(0.08),
                  fontSize: pt(L.policeOpt),
                  color: `#${couleurs.reponses}`,
                }}
              >
                {o.text}
              </div>
            ))}
          </div>
        )}

        <div
          aria-label="Zone où le texte sera placé"
          onPointerDown={(e) => saisir(e, 'deplacer')}
          className="absolute border-2 border-dashed border-pitch bg-pitch/10"
          style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `${zone.w * 100}%`, height: `${zone.h * 100}%`, cursor: 'move' }}
        >
          {POIGNEES.map(({ prise: t, style, curseur }) => (
            <div key={t} data-prise={t} onPointerDown={(e) => saisir(e, t)} className="absolute" style={{ ...style, cursor: curseur, zIndex: 2 }} />
          ))}
        </div>
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

      <p className="text-sm font-semibold mb-2">Couleurs des polices</p>
      <div className="flex flex-col gap-3">
        {ROLES.map(({ cle, libelle }) => (
          <div key={cle}>
            <p className="text-xs text-muted mb-1">{libelle}</p>
            <div className="flex flex-wrap items-center gap-2">
              {palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`${libelle} : #${c}`}
                  onClick={() => onCouleurs({ ...couleurs, [cle]: c })}
                  className={'w-7 h-7 rounded-full border-2 ' + (c === couleurs[cle] ? 'border-ink' : 'border-border')}
                  style={{ background: `#${c}` }}
                />
              ))}
              <input
                type="color"
                aria-label={`${libelle} : autre couleur`}
                value={`#${couleurs[cle]}`}
                onChange={(e) => onCouleurs({ ...couleurs, [cle]: e.target.value.slice(1).toUpperCase() })}
                className="w-9 h-7 p-0 border border-border rounded"
              />
              <span className="text-xs text-muted">#{couleurs[cle]}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
