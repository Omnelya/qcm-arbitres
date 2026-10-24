import type { QuestionCorrection, SyntheseCorrection } from './exportPowerPoint';

// Lit un export de résultats « Synthese / Sans réponse / une feuille par question » et en tire
// ce qu'il faut pour le PowerPoint de correction.
export interface ExportLu {
  synthese: SyntheseCorrection;
  questions: QuestionCorrection[];
  nbReponsesFausses: number; // réponses fausses retrouvées (celles qu'au moins un arbitre a cochées)
  avertissements: string[];
}

type Ligne = unknown[];

const texte = (v: unknown) => (v == null ? '' : String(v).replace(/\r\n?/g, '\n').trim());
const nombre = (v: unknown): number | null => {
  const n = parseFloat(texte(v).replace(',', '.').replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

// Dans l'export, les retours à la ligne de l'énoncé sont perdus (« …zone d'engagementL'équipe… ») :
// on les rétablit là où une minuscule, un chiffre ou un signe est collé à une majuscule.
// shortcut: heuristique, peut couper un mot à majuscule interne ; à revoir si l'export garde un jour ses retours.
const retablirLignes = (t: string) => t.replace(/([a-zà-ÿ0-9.?!)])([A-ZÀ-Ý])/g, '$1\n$2');

export async function lireExportCorrection(fichier: File): Promise<ExportLu> {
  const XLSX = await import('xlsx');
  const classeur = XLSX.read(await fichier.arrayBuffer(), { type: 'array' });
  const lignes = (nom: string): Ligne[] => {
    const f = classeur.Sheets[nom];
    return f ? (XLSX.utils.sheet_to_json(f, { header: 1, raw: true, defval: null }) as Ligne[]) : [];
  };
  const avertissements: string[] = [];

  // ---- Synthèse : titre, participants, moyenne générale ----
  const syn = lignes('Synthese');
  if (syn.length === 0) throw new Error("Ce fichier n'a pas de feuille « Synthese » : ce n'est pas un export de résultats reconnu.");
  const titre = texte(syn[0]?.[1]) || texte(syn[1]?.[1]) || fichier.name.replace(/\.xlsx?$/i, '');
  const iEntete = syn.findIndex((l) => texte(l[0]) === 'Participant');
  if (iEntete < 0) throw new Error('Tableau des participants introuvable dans la feuille « Synthese ».');
  const iMoy = syn[iEntete].findIndex((c) => texte(c) === 'Moyenne globale');
  let nbRepondus = 0;
  const notes: number[] = [];
  let moyenneDuTest: number | null = null;
  for (const l of syn.slice(iEntete + 1)) {
    const nom = texte(l[0]);
    if (!nom) continue;
    if (nom === 'Moyenne du test') {
      moyenneDuTest = iMoy >= 0 ? nombre(l[iMoy]) : null;
      continue;
    }
    nbRepondus++;
    const n = iMoy >= 0 ? nombre(l[iMoy]) : null;
    if (n !== null) notes.push(n);
  }
  const moyenne = moyenneDuTest ?? (notes.length > 0 ? notes.reduce((a, b) => a + b, 0) / notes.length : null);

  // ---- Arbitres sans réponse ----
  const sans = lignes('Sans réponse');
  const iSans = sans.findIndex((l) => texte(l[0]) === 'Nom');
  const nbSansReponse = iSans < 0 ? 0 : sans.slice(iSans + 1).filter((l) => texte(l[0]) || texte(l[1])).length;
  if (iSans < 0) avertissements.push("Feuille « Sans réponse » absente : le taux de participation est calculé sans les non-répondants.");

  // ---- Une feuille par question ----
  let nbReponsesFausses = 0;
  const questions: QuestionCorrection[] = [];
  for (const nom of classeur.SheetNames) {
    if (nom === 'Synthese' || nom === 'Sans réponse') continue;
    const l = lignes(nom);
    const valeur = (etiquette: string) => texte(l.find((r) => texte(r[0]) === etiquette)?.[1]);
    const enonce = valeur('Énoncé');
    if (!enonce) {
      avertissements.push(`Feuille « ${nom} » ignorée (pas d'énoncé).`);
      continue;
    }
    const justes = valeur('Réponses justes').split('\n').map((x) => x.trim()).filter(Boolean);

    // réponses données par les arbitres : « V - texte » (case juste cochée), « X - texte » (case fausse cochée)
    const iTable = l.findIndex((r) => texte(r[0]) === 'Participant');
    const iRep = iTable < 0 ? -1 : l[iTable].findIndex((c) => texte(c).startsWith('Réponses données'));
    const fausses = new Set<string>();
    const autresJustes = new Set<string>();
    if (iRep >= 0) {
      for (const r of l.slice(iTable + 1)) {
        let courant: { v: boolean; t: string } | null = null;
        const fin = () => {
          if (!courant) return;
          (courant.v ? autresJustes : fausses).add(courant.t);
        };
        for (const ligne of texte(r[iRep]).split('\n')) {
          const m = /^([VX]) - (.*)$/.exec(ligne);
          if (m) {
            fin();
            courant = { v: m[1] === 'V', t: m[2].trim() };
          } else if (courant) courant.t += ' ' + ligne.trim(); // réponse sur plusieurs lignes
        }
        fin();
      }
    }
    // une bonne réponse que personne n'a cochée n'apparaît que dans « Réponses justes »
    const toutesJustes = new Set([...justes, ...autresJustes]);
    const options = [
      ...[...toutesJustes].map((t) => ({ text: t, is_correct: true })),
      ...[...fausses].filter((t) => !toutesJustes.has(t)).map((t) => ({ text: t, is_correct: false })),
    ].sort((a, b) => a.text.localeCompare(b.text, 'fr')); // ordre d'origine inconnu : tri alphabétique, qui ne trahit pas les bonnes réponses
    nbReponsesFausses += options.filter((o) => !o.is_correct).length;
    questions.push({
      type: 'text',
      text: retablirLignes(enonce),
      explanation: null,
      moyenne: nombre(valeur('Moyenne question')),
      options,
    });
  }
  if (questions.length === 0) throw new Error('Aucune question trouvée dans ce fichier.');

  return {
    synthese: { titre, nbRepondus, nbArbitres: nbRepondus + nbSansReponse, moyenne },
    questions,
    nbReponsesFausses,
    avertissements,
  };
}
