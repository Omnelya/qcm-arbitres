// Génère le PowerPoint de correction d'un QCM : page de garde, deux diapositives par question
// (énoncé + réponses, puis énoncé + bonnes réponses + explication), « Questions ? » et remerciements.
export interface QuestionCorrection {
  type: 'video' | 'image' | 'text';
  text: string;
  explanation: string | null;
  moyenne?: number | null; // note moyenne des arbitres sur cette question, en %
  options: { text: string; is_correct: boolean }[];
}

export interface SyntheseCorrection {
  titre: string;
  nbRepondus: number;
  nbArbitres: number;
  moyenne: number | null; // en %, répondants seulement
}

const VERT = '1F6F4A';
const VERT_CLAIR = 'E8F0EC';
const TEXTE = '1E2A24';
const GRIS = '6B7A72';

const pct = (n: number) => (Number.isInteger(n) ? `${n} %` : `${n.toFixed(1)} %`);

// taille de police selon la longueur du texte (pas de retour automatique fiable hors PowerPoint)
function taille(texte: string, grand: number, moyen: number, petit: number, seuil1: number, seuil2: number) {
  return texte.length <= seuil1 ? grand : texte.length <= seuil2 ? moyen : petit;
}

// hauteur (po) d'un texte à la police donnée, retours à la ligne compris
function hauteurTexte(texte: string, largeurPo: number, pt: number) {
  const carsParLigne = (largeurPo * 72) / (pt * 0.55);
  const lignes = texte.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / carsParLigne)), 0);
  return (lignes * pt * 1.25) / 72;
}

// plus grande police (28 → 12 pt) pour laquelle le texte, retours à la ligne compris, tient dans la zone
function policeQuiTient(texte: string, largeurPo: number, hauteurPo: number) {
  for (const pt of [28, 26, 24, 22, 20, 18, 16, 14, 12]) {
    const carsParLigne = (largeurPo * 72) / (pt * 0.55);
    const lignes = texte.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / carsParLigne)), 0);
    if ((lignes * pt * 1.25) / 72 <= hauteurPo) return pt;
  }
  return 12;
}

// fond : image (adresse « data: ») qui remplace l'arrière-plan d'origine.
// zone : rectangle libre de cet arrière-plan (fractions 0-1, voir zoneLibreFond). Avec une zone, la mise en page
// est « sobre » (texte foncé, sans bandeau ni voile) et tient dans ce rectangle ; sans zone, un voile garde le texte lisible.
export interface ZoneFond {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function genererPowerPoint(
  synthese: SyntheseCorrection,
  questions: QuestionCorrection[],
  nomFichier: string,
  fond?: string,
  zone?: ZoneFond | null
) {
  const module = await import('pptxgenjs');
  const PptxGenJS = module.default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13,33 x 7,5 po (16:9)
  pptx.title = synthese.titre;

  const sobre = !!(fond && zone);
  const Z = zone ? { x: zone.x * 13.33, y: zone.y * 7.5, w: zone.w * 13.33, h: zone.h * 7.5 } : { x: 0, y: 0, w: 13.33, h: 7.5 };
  const MARINE = '1B3A6B'; // couleur d'accent en mode sobre
  const accent = sobre ? MARINE : VERT;
  const txtClair = sobre ? GRIS : 'CFE3D8';
  const txtTitre = sobre ? MARINE : 'FFFFFF';

  // fond d'une diapositive : couleur d'origine, ou image (+ voile si aucune zone libre n'a été trouvée)
  const habiller = (s: ReturnType<typeof pptx.addSlide>, couleur: string, voile: { couleur: string; y: number; h: number; transparence: number }) => {
    if (!fond) {
      s.background = { color: couleur };
      return;
    }
    s.background = { data: fond };
    if (sobre) return;
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: voile.y, w: 13.33, h: voile.h, fill: { color: voile.couleur, transparency: voile.transparence }, line: { color: voile.couleur, transparency: 100 },
    });
  };
  const voileVert = { couleur: VERT, y: 0, h: 7.5, transparence: 30 };

  // ---- Page de garde ----
  const garde = pptx.addSlide();
  habiller(garde, VERT, voileVert);
  const gx = sobre ? Z.x + 0.2 : 0.8;
  const gw = sobre ? Z.w - 0.4 : 11.7;
  const gy = sobre ? Z.y + 0.2 : 0.9;
  garde.addText('Correction du QCM', { x: gx, y: gy, w: gw, h: 0.6, fontSize: 22, color: txtClair, fontFace: 'Calibri' });
  garde.addText(synthese.titre, {
    x: gx, y: gy + 0.7, w: gw, h: sobre ? Z.h * 0.35 : 2.2, fontSize: taille(synthese.titre, 44, 36, 28, 50, 100) - (sobre ? 6 : 0),
    bold: true, color: txtTitre, fontFace: 'Calibri', valign: 'top',
  });
  const taux = synthese.nbArbitres > 0 ? Math.round((synthese.nbRepondus / synthese.nbArbitres) * 100) : 0;
  const cartes: [string, string][] = [
    ['Taux de participation', `${taux} %`],
    ['Répondants', `${synthese.nbRepondus} / ${synthese.nbArbitres}`],
    ['Moyenne générale', synthese.moyenne === null ? '—' : pct(synthese.moyenne)],
  ];
  const cw = (gw - 0.4) / 3;
  const cy = sobre ? Z.y + Z.h * 0.52 : 4.4;
  const ch = sobre ? Math.min(1.9, Z.h * 0.3) : 1.9;
  cartes.forEach(([libelle, valeur], i) => {
    const x = gx + i * (cw + 0.2);
    garde.addShape(pptx.ShapeType.roundRect, { x, y: cy, w: cw, h: ch, fill: { color: 'FFFFFF' }, line: { color: sobre ? 'C9D3E3' : 'FFFFFF' }, rectRadius: 0.15 });
    garde.addText(valeur, { x, y: cy + 0.1, w: cw, h: ch * 0.55, align: 'center', valign: 'middle', fontSize: 40, bold: true, color: accent, fontFace: 'Calibri' });
    garde.addText(libelle, { x, y: cy + ch * 0.62, w: cw, h: ch * 0.3, align: 'center', valign: 'top', fontSize: 16, color: GRIS, fontFace: 'Calibri' });
  });
  garde.addText('Moyenne calculée sur les arbitres ayant répondu.', { x: gx, y: sobre ? Z.y + Z.h - 0.5 : 6.6, w: gw, h: 0.4, fontSize: 12, color: txtClair, fontFace: 'Calibri' });

  // ---- Deux diapositives par question ----
  const total = questions.length;
  const X0 = sobre ? Z.x + 0.15 : 0.5; // bord gauche du contenu
  const W = sobre ? Z.w - 0.3 : 12.3; // largeur du contenu
  const yContenu = sobre ? Z.y + 0.75 : 0.85;
  const bas = sobre ? Z.y + Z.h - 0.1 : 7.2;
  const dispo = bas - yContenu;
  questions.forEach((q, index) => {
    const enonce = q.text.replace(/\r\n?/g, '\n').trim();
    const expl = q.explanation?.replace(/\r\n?/g, '\n').trim() ?? '';
    // énoncé : plus grande police qui tient dans la moitié de la place, et zone réduite à la hauteur du texte
    const hMax = Math.min(3.1, dispo * 0.5);
    const police = [28, 26, 24, 22, 20, 18, 16, 14, 12].find((pt) => hauteurTexte(enonce, W - 0.2, pt) <= hMax) ?? 12;
    const hEnonce = Math.min(hMax, hauteurTexte(enonce, W - 0.2, police) + 0.1);
    const yOpt = yContenu + hEnonce + 0.1;
    const hExpl = expl ? Math.min(1.45, dispo * 0.25) : 0;
    const finOpt = bas - (expl ? hExpl + 0.1 : 0);
    const nbOpt = Math.max(1, q.options.length);
    const hauteurLigne = Math.min(0.85, (finOpt - yOpt) / nbOpt);
    // plus grande police pour laquelle chaque réponse tient dans sa ligne
    const policeOpt =
      [20, 18, 16, 14, 12].find((pt) =>
        q.options.every((o) => {
          const lignes = Math.max(1, Math.ceil((o.text.length * pt * 0.55) / 72 / (W - 0.6)));
          return (lignes * pt * 1.2) / 72 <= hauteurLigne - 0.15;
        })
      ) ?? 12;
    const media = q.type === 'video' ? 'Question vidéo' : q.type === 'image' ? 'Question image' : '';

    for (const correction of [false, true]) {
      const s = pptx.addSlide();
      habiller(s, 'FFFFFF', { couleur: 'FFFFFF', y: 0.7, h: 6.8, transparence: 12 });
      const titreQ = `Question ${index + 1} / ${total}${media ? ' · ' + media : ''}`;
      if (sobre) {
        // en-tête sans bandeau : titre à gauche, moyenne dans une pastille à droite, filet dessous
        const largeurPastille = q.moyenne != null ? 2.5 : 0;
        s.addText(`${titreQ}  ·  ${correction ? 'Correction' : 'Réponses'}`, {
          x: X0, y: Z.y + 0.05, w: W - largeurPastille - 0.1, h: 0.55, fontSize: 18, bold: true, color: MARINE, fontFace: 'Calibri', valign: 'middle',
        });
        if (q.moyenne != null) {
          s.addShape(pptx.ShapeType.roundRect, { x: X0 + W - largeurPastille, y: Z.y + 0.1, w: largeurPastille, h: 0.45, fill: { color: MARINE }, line: { color: MARINE }, rectRadius: 0.2 });
          s.addText(`Moyenne : ${pct(q.moyenne)}`, {
            x: X0 + W - largeurPastille, y: Z.y + 0.1, w: largeurPastille, h: 0.45, fontSize: 16, bold: true, color: 'FFFFFF', fontFace: 'Calibri', align: 'center', valign: 'middle',
          });
        }
        s.addShape(pptx.ShapeType.line, { x: X0, y: Z.y + 0.65, w: W, h: 0, line: { color: MARINE, width: 1.5 } });
      } else {
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.7, fill: { color: VERT }, line: { color: VERT } });
        s.addText(titreQ, { x: 0.5, y: 0, w: 5.6, h: 0.7, fontSize: 18, bold: true, color: 'FFFFFF', fontFace: 'Calibri', valign: 'middle' });
        if (q.moyenne != null) {
          s.addText(`Moyenne : ${pct(q.moyenne)}`, {
            x: 6.0, y: 0, w: 3.2, h: 0.7, fontSize: 18, bold: true, color: 'FFFFFF', fontFace: 'Calibri', align: 'right', valign: 'middle',
          });
        }
        s.addText(correction ? 'Correction' : 'Réponses', {
          x: 9.3, y: 0, w: 3.6, h: 0.7, fontSize: 16, color: 'CFE3D8', fontFace: 'Calibri', align: 'right', valign: 'middle',
        });
      }
      s.addText(enonce, { x: X0, y: yContenu, w: W, h: hEnonce, fontSize: police, bold: true, color: TEXTE, fontFace: 'Calibri', valign: 'top' });

      // mêmes emplacements sur les deux diapositives ; en correction, les mauvaises réponses restent vides
      q.options.forEach((o, i) => {
        const y = yOpt + i * hauteurLigne;
        if (correction && !o.is_correct) return;
        s.addShape(pptx.ShapeType.roundRect, {
          x: X0, y, w: W, h: hauteurLigne - 0.1,
          fill: correction ? { color: VERT_CLAIR } : sobre ? { color: 'FFFFFF', transparency: 10 } : { color: 'F4F6F5' },
          line: { color: correction ? VERT : sobre ? 'C9D3E3' : 'D5DCD8', width: correction ? 2 : 1 }, rectRadius: 0.08,
        });
        s.addText((correction ? '✓  ' : '') + o.text.trim(), {
          x: X0 + 0.2, y, w: W - 0.4, h: hauteurLigne - 0.1, fontSize: policeOpt, color: TEXTE, bold: correction, fontFace: 'Calibri', valign: 'middle',
        });
      });

      if (correction && expl) {
        s.addText([{ text: 'Explication : ', options: { bold: true, color: accent } }, { text: expl, options: { color: TEXTE } }], {
          x: X0, y: bas - hExpl, w: W, h: hExpl, fontSize: policeQuiTient(expl, W - 0.2, hExpl - 0.1), fontFace: 'Calibri', valign: 'top',
        });
      }
    }
  });

  // ---- Questions ? / Remerciements ----
  for (const texte of ['Questions ?', 'Merci de votre attention']) {
    const s = pptx.addSlide();
    habiller(s, VERT, voileVert);
    const my = sobre ? Z.y + Z.h * 0.3 : 2.6;
    s.addText(texte, { x: gx, y: my, w: gw, h: 1.6, align: 'center', valign: 'middle', fontSize: sobre ? 48 : 54, bold: true, color: txtTitre, fontFace: 'Calibri' });
    s.addText(synthese.titre, { x: gx, y: my + 1.8, w: gw, h: 0.8, align: 'center', fontSize: 20, color: txtClair, fontFace: 'Calibri' });
  }

  await pptx.writeFile({ fileName: nomFichier });
}
