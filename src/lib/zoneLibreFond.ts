// Cherche, dans une image de fond, le plus grand rectangle « libre » (clair et uni) où poser le texte,
// pour éviter logos, bandeaux et motifs foncés. Résultat en fractions de l'image (0 à 1).
export interface ZoneLibre {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GW = 64;
const GH = 36;

export function zoneLibreFond(dataUrl: string): Promise<ZoneLibre | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = GW * 4;
      canvas.height = GH * 4;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      // une case de la grille est « occupée » si l'un de ses pixels est franchement foncé ou coloré
      const occupe: boolean[][] = Array.from({ length: GH }, () => Array(GW).fill(false));
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
          if (lum < 0.8) occupe[Math.floor(y / 4)][Math.floor(x / 4)] = true;
        }
      }
      // marge d'une case autour de tout ce qui est occupé
      const libre: boolean[][] = occupe.map((l, y) =>
        l.map((_, x) => {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (occupe[y + dy]?.[x + dx]) return false;
          return true;
        })
      );

      // plus grand rectangle de cases libres (méthode de l'histogramme)
      const hauteurs = Array(GW).fill(0);
      let meilleur = { aire: 0, x: 0, y: 0, w: 0, h: 0 };
      for (let y = 0; y < GH; y++) {
        for (let x = 0; x < GW; x++) hauteurs[x] = libre[y][x] ? hauteurs[x] + 1 : 0;
        for (let x0 = 0; x0 < GW; x0++) {
          let hMin = Infinity;
          for (let x1 = x0; x1 < GW && hauteurs[x1] > 0; x1++) {
            hMin = Math.min(hMin, hauteurs[x1]);
            const aire = (x1 - x0 + 1) * hMin;
            if (aire > meilleur.aire) meilleur = { aire, x: x0, y: y - hMin + 1, w: x1 - x0 + 1, h: hMin };
          }
        }
      }
      // zone trop petite pour du texte lisible : on renonce (le fond sera alors voilé)
      if (meilleur.aire < GW * GH * 0.3) return resolve(null);
      resolve({ x: meilleur.x / GW, y: meilleur.y / GH, w: meilleur.w / GW, h: meilleur.h / GH });
    };
    img.src = dataUrl;
  });
}
