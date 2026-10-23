// Lecture d'un fichier Excel de questions pour la banque.
// Format attendu (une seule feuille, deux colonnes) :
//   colonne A « Q12.  Énoncé de la question »   (colonne B vide)
//   colonne A « [X]  A » ou « [ ]  B »           colonne B : texte de la proposition
// [X] = bonne réponse. Les lignes avant la première question (en-tête) sont ignorées.

export interface QuestionBanque {
  numero: number;
  text: string;
  options: { text: string; is_correct: boolean }[];
}

export interface ResultatLecture {
  questions: QuestionBanque[];
  // numéros ignorés car identiques à une question déjà lue (même énoncé, mêmes propositions, mêmes bonnes réponses)
  doublons: number[];
  // questions inutilisables (moins de 2 propositions ou aucune bonne réponse)
  invalides: string[];
}

function normaliser(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function lireQuestionsBanque(lignes: unknown[][]): ResultatLecture {
  const brutes: QuestionBanque[] = [];
  let courante: QuestionBanque | null = null;

  for (const ligne of lignes) {
    const a = String(ligne[0] ?? '').trim();
    const b = String(ligne[1] ?? '').trim();
    const q = /^Q\s*(\d+)\s*[.)]\s*([\s\S]*)$/i.exec(a);
    if (q) {
      courante = { numero: Number(q[1]), text: q[2].trim(), options: [] };
      brutes.push(courante);
    } else if (courante && /^\[\s*[xX]?\s*\]/.test(a)) {
      courante.options.push({ text: b, is_correct: /^\[\s*[xX]\s*\]/.test(a) });
    }
  }

  const questions: QuestionBanque[] = [];
  const doublons: number[] = [];
  const invalides: string[] = [];
  const vues = new Set<string>();

  for (const q of brutes) {
    const options = q.options.filter((o) => o.text !== '');
    if (!q.text || options.length < 2 || !options.some((o) => o.is_correct)) {
      invalides.push(`Q${q.numero}`);
      continue;
    }
    const cle =
      normaliser(q.text) +
      '|' +
      options
        .map((o) => (o.is_correct ? '1' : '0') + normaliser(o.text))
        .sort()
        .join('|');
    if (vues.has(cle)) {
      doublons.push(q.numero);
      continue;
    }
    vues.add(cle);
    questions.push({ numero: q.numero, text: q.text, options });
  }

  return { questions, doublons, invalides };
}
