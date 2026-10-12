// Detecção de campo sem "?" (RD-95) compartilhada pelo gate das telas alteradas e pelo relatório de cobertura.
// Mesma regra do check-ajuda-campo.ts: campo coberto = `ajuda`/`data-ajuda` num ancestral, <AjudaCampo> na <label>/<table>/<Campo>
// mais próxima ou como filho direto do pai.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const CAMPOS = new Set(['input', 'select', 'textarea'])
type El = ts.JsxElement | ts.JsxSelfClosingElement
const tag = (n: El) => (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText()
const attrs = (n: El) => (ts.isJsxElement(n) ? n.openingElement.attributes : n.attributes)
const temAttr = (n: El, nome: string) => attrs(n).properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === nome)
const ehEl = (n: ts.Node): n is El => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)

function contemAjuda(n: ts.Node): boolean {
  let achou = false
  const v = (x: ts.Node) => { if (achou) return; if (ehEl(x) && tag(x) === 'AjudaCampo') { achou = true; return } ts.forEachChild(x, v) }
  v(n)
  return achou
}
const filhoDiretoAjuda = (n: ts.JsxElement) => n.children.some((c) => ehEl(c) && tag(c) === 'AjudaCampo')

export function camposSemAjuda(arquivo: string): { linha: number; total: number; texto: string }[] {
  const src = ts.createSourceFile(arquivo, readFileSync(arquivo, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const faltando: { linha: number; total: number; texto: string }[] = []
  let total = 0
  const coberto = (n: ts.Node): boolean => {
    let p: ts.Node | undefined = n.parent
    let primeiro = true
    while (p) {
      if (ts.isJsxElement(p)) {
        if (primeiro && filhoDiretoAjuda(p)) return true
        primeiro = false
        if (temAttr(p, 'ajuda') || temAttr(p, 'data-ajuda')) return true
        const t = tag(p)
        if (t === 'label' || t === 'table' || t === 'Campo') return contemAjuda(p)
      }
      if (ts.isFunctionDeclaration(p) || (ts.isFunctionLike(p) && p.parent && ts.isVariableDeclaration(p.parent))) return false
      p = p.parent
    }
    return false
  }
  const visita = (n: ts.Node) => {
    if (ehEl(n) && CAMPOS.has(tag(n))) {
      const tipo = attrs(n).properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === 'type')
      const oculto = tipo && ts.isJsxAttribute(tipo) && /["'](hidden|submit|button)["']/.test(tipo.initializer?.getText() ?? '')
      if (!oculto) {
        total++
        if (!coberto(n)) faltando.push({ linha: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, total: 0, texto: n.getText().slice(0, 90) })
      }
    }
    ts.forEachChild(n, visita)
  }
  visita(src)
  return faltando.map((f) => ({ ...f, total }))
}

export function arquivosTsx(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivosTsx(p) : p.endsWith('.tsx') ? [p.replace(/\\/g, '/')] : []
  })
}

// Telas/componentes de interface cobertos pela regra (todo o app, não só o Hub)
export const RAIZES_TELA = ['src/app/dashboard', 'src/components']
