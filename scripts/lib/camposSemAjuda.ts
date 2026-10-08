// Detecção de campo sem "?" (ajuda de campo, RD-95) — usada pelo gate check-ajuda-campo (Hub), pelo gate de PR
// check-ajuda-campo-pr e pelo relatório de cobertura (scripts/relatorios/cobertura-ajuda-campo.ts). Um campo conta como
// coberto quando: um elemento acima dele (até a <label>/<Campo>/<table> mais próxima) tem o atributo `ajuda`, ou essa
// <label>/<table> contém um <AjudaCampo>, ou o elemento pai direto tem um <AjudaCampo>.
import ts from 'typescript'

export const CAMPOS = new Set(['input', 'select', 'textarea'])

const tag = (n: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText()
const attrs = (n: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(n) ? n.openingElement.attributes : n.attributes)
const temAttr = (n: ts.JsxElement | ts.JsxSelfClosingElement, nome: string) => attrs(n).properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === nome)
function contemAjuda(n: ts.Node): boolean {
  let achou = false
  const visita = (x: ts.Node) => { if (achou) return; if ((ts.isJsxSelfClosingElement(x) || ts.isJsxElement(x)) && tag(x) === 'AjudaCampo') { achou = true; return } ts.forEachChild(x, visita) }
  visita(n)
  return achou
}
function filhoDiretoAjuda(n: ts.JsxElement): boolean {
  return n.children.some((c) => (ts.isJsxSelfClosingElement(c) || ts.isJsxElement(c)) && tag(c) === 'AjudaCampo')
}

function camposSemAjudaTexto(arquivo: string, texto: string): { linha: number; texto: string }[] {
  const src = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const faltando: { linha: number; texto: string }[] = []
  const visita = (n: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxElement(n)) && CAMPOS.has(tag(n))) {
      const tipo = attrs(n).properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === 'type')
      const oculto = tipo && ts.isJsxAttribute(tipo) && /["'](hidden|submit|button)["']/.test(tipo.initializer?.getText() ?? '')
      if (!oculto && !coberto(n)) faltando.push({ linha: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, texto: n.getText().slice(0, 90) })
    }
    ts.forEachChild(n, visita)
  }
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
      // não atravessa a fronteira de um componente (função declarada ou const X = () => …); o .map() dentro do JSX atravessa
      if (ts.isFunctionDeclaration(p) || (ts.isFunctionLike(p) && p.parent && ts.isVariableDeclaration(p.parent))) return false
      p = p.parent
    }
    return false
  }
  visita(src)
  return faltando
}

export function camposSemAjuda(arquivo: string, texto: string) { return camposSemAjudaTexto(arquivo, texto) }
