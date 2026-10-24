import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import AppLayout from '../../components/AppLayout';
import { lireExportCorrection, type ExportLu } from '../../lib/lireExportCorrection';

// Zone où l'on glisse un fichier (ou que l'on clique pour le choisir).
function ZoneDepot({
  titre,
  aide,
  accept,
  nom,
  onFichier,
  enfant,
}: {
  titre: string;
  aide: string;
  accept: string;
  nom: string | null;
  onFichier: (f: File) => void;
  enfant?: ReactNode;
}) {
  const [survol, setSurvol] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const deposer = (e: DragEvent) => {
    e.preventDefault();
    setSurvol(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFichier(f);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setSurvol(true);
      }}
      onDragLeave={() => setSurvol(false)}
      onDrop={deposer}
      className={'rounded-2xl border-2 border-dashed p-4 text-center ' + (survol ? 'border-pitch bg-pitch-light' : 'border-border bg-surface')}
    >
      <p className="font-semibold text-sm">{titre}</p>
      <p className="text-xs text-muted mb-3">{aide}</p>
      {enfant}
      {nom && <p className="text-sm text-pitch mb-2 break-all">{nom}</p>}
      <button type="button" onClick={() => input.current?.click()} className="text-sm border border-border rounded-xl px-3 py-1.5 bg-canvas">
        {nom ? 'Choisir un autre fichier' : 'Choisir un fichier'}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={titre}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFichier(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

const lireImage = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('lecture impossible'));
    r.readAsDataURL(f);
  });

export default function SupportCorrection() {
  const [excel, setExcel] = useState<ExportLu | null>(null);
  const [nomExcel, setNomExcel] = useState<string | null>(null);
  const [titre, setTitre] = useState('');
  const [fond, setFond] = useState<string | null>(null);
  const [nomFond, setNomFond] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lecture, setLecture] = useState(false);
  const [generation, setGeneration] = useState(false);

  async function choisirExcel(f: File) {
    setErreur(null);
    if (!/\.xlsx?$/i.test(f.name)) {
      setErreur('Dépose un fichier Excel (.xlsx).');
      return;
    }
    setLecture(true);
    try {
      const lu = await lireExportCorrection(f);
      setExcel(lu);
      setNomExcel(f.name);
      setTitre(lu.synthese.titre);
    } catch (e) {
      setExcel(null);
      setNomExcel(null);
      setErreur(e instanceof Error ? e.message : 'Ce fichier ne peut pas être lu.');
    } finally {
      setLecture(false);
    }
  }

  async function choisirFond(f: File) {
    setErreur(null);
    if (!f.type.startsWith('image/')) {
      setErreur('Dépose une image (JPG ou PNG).');
      return;
    }
    try {
      setFond(await lireImage(f));
      setNomFond(f.name);
    } catch {
      setErreur("Cette image n'a pas pu être lue.");
    }
  }

  async function generer() {
    if (!excel) return;
    setErreur(null);
    setGeneration(true);
    try {
      const { genererPowerPoint } = await import('../../lib/exportPowerPoint');
      const t = titre.trim() || excel.synthese.titre;
      await genererPowerPoint({ ...excel.synthese, titre: t }, excel.questions, `${t} - Correction.pptx`, fond ?? undefined);
    } catch {
      setErreur('La création du PowerPoint a échoué. Réessaie dans un instant.');
    } finally {
      setGeneration(false);
    }
  }

  const s = excel?.synthese;
  const taux = s && s.nbArbitres > 0 ? Math.round((s.nbRepondus / s.nbArbitres) * 100) : 0;

  return (
    <AppLayout>
      <h1 className="text-lg font-semibold mb-1">Support de correction</h1>
      <p className="text-sm text-muted mb-4">
        Transforme un export Excel de résultats en PowerPoint pour animer une correction en visio.
      </p>

      <div className="flex flex-col gap-3 mb-4">
        <ZoneDepot
          titre="1. Fichier Excel des résultats"
          aide="Glisse ici l'export (feuilles « Synthese », « Sans réponse » et une feuille par question)."
          accept=".xlsx,.xls"
          nom={lecture ? 'Lecture du fichier…' : nomExcel}
          onFichier={choisirExcel}
        />
        <ZoneDepot
          titre="2. Image d'arrière-plan (facultatif)"
          aide="Remplace l'arrière-plan d'origine sur toutes les diapositives. Format 16:9 conseillé."
          accept="image/*"
          nom={nomFond}
          onFichier={choisirFond}
          enfant={fond ? <img src={fond} alt="Aperçu de l'arrière-plan" className="mx-auto mb-2 max-h-28 rounded" /> : undefined}
        />
        {fond && (
          <button
            type="button"
            onClick={() => {
              setFond(null);
              setNomFond(null);
            }}
            className="text-xs text-muted underline self-start"
          >
            Retirer l'image (retour à l'arrière-plan d'origine)
          </button>
        )}
      </div>

      {erreur && (
        <p role="alert" className="text-sm text-card-red bg-card-red-bg rounded px-3 py-2 mb-4">
          {erreur}
        </p>
      )}

      {excel && s && (
        <div className="bg-surface rounded-2xl border border-border p-4 mb-4">
          <label className="block text-sm text-muted mb-1" htmlFor="titre-support">
            Titre affiché sur la page de garde
          </label>
          <input
            id="titre-support"
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            className="w-full border border-border rounded px-3 py-2 mb-3"
          />
          <ul className="text-sm flex flex-col gap-1 mb-3">
            <li>
              {excel.questions.length} question(s) → {excel.questions.length * 2 + 3} diapositives
            </li>
            <li>
              Participation : {s.nbRepondus} / {s.nbArbitres} ({taux} %)
            </li>
            <li>Moyenne générale : {s.moyenne === null ? '—' : `${s.moyenne} %`} (répondants seulement)</li>
          </ul>
          <p className="text-xs text-muted mb-3">
            Le fichier ne donne pas l'ordre d'origine des réponses : elles sont classées par ordre alphabétique. Seules les réponses fausses
            cochées par au moins un arbitre apparaissent ({excel.nbReponsesFausses} retrouvée(s)).
          </p>
          {excel.avertissements.map((a) => (
            <p key={a} className="text-xs text-card-yellow mb-1">
              {a}
            </p>
          ))}
          <button
            type="button"
            onClick={generer}
            disabled={generation}
            className="w-full bg-pitch text-white font-medium rounded py-2 disabled:opacity-60"
          >
            {generation ? 'Génération…' : 'Créer le PowerPoint'}
          </button>
        </div>
      )}
    </AppLayout>
  );
}
