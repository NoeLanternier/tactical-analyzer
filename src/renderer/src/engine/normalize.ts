/** Normalise un nom pour comparer sans accents, espaces ni ponctuation ("Dr. Mundo" → "drmundo"). */
export function norm(str: string | undefined | null): string {
  return (str ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
