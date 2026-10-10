// Detecção de emoji usado como ícone/texto de interface (CEO 09/10): compartilhada pelo gate das telas alteradas e pelo
// relatório por vertical. Olha só texto de interface (texto JSX e literais de string) em .tsx; comentário é ignorado.
// Ícone da interface = conjunto lucide-react (traço fino), ver docs/design/rubrica-visual.md.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

export const RAIZES_ICONE = ['src/app/dashboard', 'src/components']
// pictograma/emoji, menos ©®™ (texto legal) e o seletor de variação sozinho
const EMOJI = /(?![©®™])[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u

export type Achado = { linha: number; emoji: string }

export function emojisDeInterface(arquivo: string): Achado[] {
  const src = ts.createSourceFile(arquivo, readFileSync(arquivo, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: Achado[] = []
  const marca = (n: ts.Node, texto: string) => {
    const m = texto.match(EMOJI)
    if (!m) return
    const linha = src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1
    // JsxText multilinha: aponta a linha real do emoji
    const ate = texto.slice(0, m.index ?? 0)
    out.push({ linha: linha + (ate.match(/\n/g)?.length ?? 0), emoji: m[0] })
  }
  const v = (n: ts.Node) => {
    if (ts.isJsxText(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) marca(n, n.text)
    ts.forEachChild(n, v)
  }
  v(src)
  return out
}

export function arquivosTsx(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? arquivosTsx(p) : p.endsWith('.tsx') ? [p] : []
  })
}
