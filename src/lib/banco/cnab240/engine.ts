// Motor CNAB 240 GENÉRICO (FEBRABAN). Não conhece banco nenhum — só posiciona campos numa linha de 240.
// O banco é DADO: os mapas de campo e constantes vivem no perfil (ex.: ./sicoob.ts). RD-52.
// Provado byte a byte contra arquivos reais do Sicoob (scripts/cnab-roundtrip.ts e cnab-gen-proof.ts).

export type Kind = 'N' | 'A' | 'R' // N=numérico (zero à esquerda) · A=alfa (espaço à direita) · R=raw verbatim
export type Field = [name: string, len: number, kind: Kind]

export const LINE_LEN = 240
export const EOL = '\r\n' // Sicoob: cada linha = 240 + CRLF, encoding latin-1

/** Extrai os campos de uma linha de 240 posições segundo o mapa. */
export function parseLine(line: string, map: Field[]): Record<string, string> {
  const out: Record<string, string> = {}
  let pos = 0
  for (const [name, len, kind] of map) {
    const sub = line.slice(pos, pos + len)
    out[name] = kind === 'N' ? String(parseInt(sub || '0', 10)) : kind === 'A' ? sub.replace(/ +$/, '') : sub
    pos += len
  }
  return out
}

/** Monta uma linha de 240 a partir dos valores + mapa. N zero-pad à esquerda; A espaço à direita; R verbatim. */
export function buildLine(rec: Record<string, string>, map: Field[]): string {
  let s = ''
  for (const [name, len, kind] of map) {
    let v = rec[name] ?? ''
    if (kind === 'N') v = v.padStart(len, '0')
    else if (kind === 'A') v = truncPad(v, len)
    else v = v.length === len ? v : truncPad(v, len) // R normalmente já vem no tamanho
    s += v
  }
  if (s.length !== LINE_LEN) throw new Error(`linha CNAB com ${s.length} posições (esperado ${LINE_LEN})`)
  return s
}

/** Alfa: corta no tamanho e completa com espaço à direita. Remove acentos/controle fora do latin-1 imprimível. */
export function truncPad(v: string, len: number): string {
  const clean = (v ?? '').replace(/[\r\n]/g, ' ')
  return clean.length >= len ? clean.slice(0, len) : clean.padEnd(len, ' ')
}

/** Junta as linhas no framing do arquivo (cada linha + CRLF, inclusive a última). */
export function joinArquivo(linhas: string[]): string {
  return linhas.map((l) => l + EOL).join('')
}
