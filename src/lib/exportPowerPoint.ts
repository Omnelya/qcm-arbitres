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

// plus grande police (28 → 12 pt) pour laquelle le texte, retours à la ligne compris, tient dans la zone
function policeQuiTient(texte: string, largeurPo: number, hauteurPo: number) {
  for (const pt of [28, 26, 24, 22, 20, 18, 16, 14, 12]) {
    const carsParLigne = (largeurPo * 72) / (pt * 0.55);
    const lignes = texte.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / carsParLigne)), 0);
    if ((lignes * pt * 1.25) / 72 <= hauteurPo) return pt;
  }
  return 12;
}

// fond : image (adresse « data: ») qui remplace l'arrière-plan d'origine ; un voile garde le texte lisible.
export async function genererPowerPoint(synthese: SyntheseCorrection, questions: QuestionCorrection[], nomFichier: string, fond?: string) {
  const module = await import('pptxgenjs');
  const PptxGenJS = module.default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13,33 x 7,5 po (16:9)
  pptx.title = synthese.titre;

  // fond d'une diapositive : couleur d'origine, ou image + voile (vert foncé / blanc) pour la lisibilité
  const habiller = (s: ReturnType<typeof pptx.addSlide>, couleur: string, voile: { couleur: string; y: number; h: number; transparence: number }) => {
    if (!fond) {
      s.background = { color: couleur };
      return;
    }
    s.background = { data: fond };
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: voile.y, w: 13.33, h: voile.h, fill: { color: voile.couleur, transparency: voile.transparence }, line: { color: voile.couleur, transparency: 100 },
    });
  };
  const voileVert = { couleur: VERT, y: 0, h: 7.5, transparence: 30 };

  // ---- Page de garde ----
  const garde = pptx.addSlide();
  habiller(garde, VERT, voileVert);
  garde.addText('Correction du QCM', { x: 0.8, y: 0.9, w: 11.7, h: 0.6, fontSize: 22, color: 'CFE3D8', fontFace: 'Calibri' });
  garde.addText(synthese.titre, {
    x: 0.8, y: 1.6, w: 11.7, h: 2.2, fontSize: taille(synthese.titre, 44, 36, 28, 50, 100),
    bold: true, color: 'FFFFFF', fontFace: 'Calibri', valign: 'top',
  });
  const taux = synthese.nbArbitres > 0 ? Math.round((synthese.nbRepondus / synthese.nbArbitres) * 100) : 0;
  const cartes: [string, string][] = [
    ['Taux de participation', `${taux} %`],
    ['Répondants', `${synthese.nbRepondus} / ${synthese.nbArbitres}`],
    ['Moyenne générale', synthese.moyenne === null ? '—' : pct(synthese.moyenne)],
  ];
  cartes.forEach(([libelle, valeur], i) => {
    const x = 0.8 + i * 4.0;
    garde.addShape(pptx.ShapeType.roundRect, { x, y: 4.4, w: 3.7, h: 1.9, fill: { color: 'FFFFFF' }, line: { color: 'FFFFFF' }, rectRadius: 0.15 });
    garde.addText(valeur, { x, y: 4.55, w: 3.7, h: 1.0, align: 'center', valign: 'middle', fontSize: 40, bold: true, color: VERT, fontFace: 'Calibri' });
    garde.addText(libelle, { x, y: 5.5, w: 3.7, h: 0.6, align: 'center', valign: 'top', fontSize: 16, color: GRIS, fontFace: 'Calibri' });
  });
  garde.addText('Moyenne calculée sur les arbitres ayant répondu.', { x: 0.8, y: 6.6, w: 11.7, h: 0.4, fontSize: 12, color: 'CFE3D8', fontFace: 'Calibri' });

  // ---- Deux diapositives par question ----
  const total = questions.length;
  questions.forEach((q, index) => {
    const enonce = q.text.replace(/\r\n?/g, '\n').trim();
    // énoncé long : la zone du texte grandit (jusqu'à 3,1 po) au détriment des réponses
    const hEnonce = policeQuiTient(enonce, 12.1, 1.95) >= 18 ? 1.95 : 3.1;
    const police = policeQuiTient(enonce, 12.1, hEnonce);
    const yOpt = 0.95 + hEnonce;
    const finOpt = q.explanation?.trim() ? 5.65 : 7.2;
    const nbOpt = Math.max(1, q.options.length);
    const hauteurLigne = Math.min(0.85, (finOpt - yOpt) / nbOpt);
    const tousTextes = q.options.map((o) => o.text).join(' ');
    const policeOpt = nbOpt > 6 || tousTextes.length > 900 ? 15 : nbOpt > 5 || tousTextes.length > 450 ? 18 : 20;
    const media = q.type === 'video' ? 'Question vidéo' : q.type === 'image' ? 'Question image' : '';

    for (const correction of [false, true]) {
      const s = pptx.addSlide();
      habiller(s, 'FFFFFF', { couleur: 'FFFFFF', y: 0.7, h: 6.8, transparence: 12 });
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.7, fill: { color: VERT }, line: { color: VERT } });
      s.addText(`Question ${index + 1} / ${total}${media ? ' · ' + media : ''}`, {
        x: 0.5, y: 0, w: 5.6, h: 0.7, fontSize: 18, bold: true, color: 'FFFFFF', fontFace: 'Calibri', valign: 'middle',
      });
      if (q.moyenne != null) {
        s.addText(`Moyenne : ${pct(q.moyenne)}`, {
          x: 6.0, y: 0, w: 3.2, h: 0.7, fontSize: 18, bold: true, color: 'FFFFFF', fontFace: 'Calibri', align: 'right', valign: 'middle',
        });
      }
      s.addText(correction ? 'Correction' : 'Réponses', {
        x: 9.3, y: 0, w: 3.6, h: 0.7, fontSize: 16, color: 'CFE3D8', fontFace: 'Calibri', align: 'right', valign: 'middle',
      });
      s.addText(enonce, { x: 0.5, y: 0.85, w: 12.3, h: hEnonce, fontSize: police, bold: true, color: TEXTE, fontFace: 'Calibri', valign: 'top' });

      // mêmes emplacements sur les deux diapositives ; en correction, les mauvaises réponses restent vides
      q.options.forEach((o, i) => {
        const y = yOpt + i * hauteurLigne;
        if (correction && !o.is_correct) return;
        s.addShape(pptx.ShapeType.roundRect, {
          x: 0.5, y, w: 12.3, h: hauteurLigne - 0.1,
          fill: { color: correction ? VERT_CLAIR : 'F4F6F5' }, line: { color: correction ? VERT : 'D5DCD8', width: correction ? 2 : 1 }, rectRadius: 0.08,
        });
        s.addText((correction ? '✓  ' : '') + o.text.trim(), {
          x: 0.7, y, w: 11.9, h: hauteurLigne - 0.1, fontSize: policeOpt, color: TEXTE, bold: correction, fontFace: 'Calibri', valign: 'middle',
        });
      });

      if (correction && q.explanation?.trim()) {
        const expl = q.explanation.replace(/\r\n?/g, '\n').trim();
        s.addText([{ text: 'Explication : ', options: { bold: true, color: VERT } }, { text: expl, options: { color: TEXTE } }], {
          x: 0.5, y: 5.75, w: 12.3, h: 1.55, fontSize: policeQuiTient(expl, 12.1, 1.4), fontFace: 'Calibri', valign: 'top',
        });
      }
    }
  });

  // ---- Questions ? / Remerciements ----
  for (const texte of ['Questions ?', 'Merci de votre attention']) {
    const s = pptx.addSlide();
    habiller(s, VERT, voileVert);
    s.addText(texte, { x: 0.8, y: 2.6, w: 11.7, h: 1.6, align: 'center', valign: 'middle', fontSize: 54, bold: true, color: 'FFFFFF', fontFace: 'Calibri' });
    s.addText(synthese.titre, { x: 0.8, y: 4.4, w: 11.7, h: 0.8, align: 'center', fontSize: 20, color: 'CFE3D8', fontFace: 'Calibri' });
  }

  await pptx.writeFile({ fileName: nomFichier });
}
