// Gate (CEO 01/10, regra de TODO o Hub de Projetos): cada campo (input, seleção, caixa de marcar, texto) das telas de
// /dashboard/projetos/* tem o "?" da ajuda de campo (<AjudaCampo chave="..."> ou <Campo ajuda="...">) e a chave existe
// no banco (seed em supabase/migrations). Vale já na Mão de obra e em toda tela nova; as telas do Hub que ainda não têm
// a ajuda ficam em PENDENTES, que só pode diminuir (zera na H0). Sem rede.
//
// Um campo conta como coberto quando: um elemento acima dele (até a <label>/<Campo>/<table> mais próxima) tem o
// atributo `ajuda`, ou essa <label>/<table> contém um <AjudaCampo>, ou o elemento pai direto tem um <AjudaCampo>.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

// Telas do Hub ainda sem ajuda de campo (H0). Só pode DIMINUIR: tela que ganhou ajuda sai da lista (o gate avisa);
// tela nova não entra aqui — já nasce com o "?".
const PENDENTES = [
  'src/app/dashboard/projetos/catalogo/[id]/page.tsx',
  'src/app/dashboard/projetos/catalogo/page.tsx',
  'src/app/dashboard/projetos/clientes/page.tsx',
  'src/app/dashboard/projetos/configuracoes/page.tsx',
  'src/app/dashboard/projetos/desempenho/page.tsx',
  'src/app/dashboard/projetos/engenharia/page.tsx',
  'src/app/dashboard/projetos/insumos/page.tsx',
  'src/app/dashboard/projetos/obras/page.tsx',
  'src/app/dashboard/projetos/oportunidades/OportunidadeFormModal.tsx',
  'src/app/dashboard/projetos/oportunidades/OportunidadesKanban.tsx',
  'src/app/dashboard/projetos/oportunidades/[id]/page.tsx',
  'src/app/dashboard/projetos/oportunidades/page.tsx',
  'src/app/dashboard/projetos/simulador/page.tsx',
  'src/app/dashboard/projetos/takeoff/page.tsx',
  'src/components/projetos/BdiSlider.tsx',
  'src/components/projetos/BomEditor.tsx',
  'src/components/projetos/CatalogoForm.tsx',
  'src/components/projetos/MaoObraCatalogoLegado.tsx',
  'src/components/projetos/PrecificacaoConfigPanel.tsx',
  'src/components/projetos/ProdutividadePanel.tsx',
  'src/components/projetos/SeletorItemModal.tsx',
]
const MAX_PENDENTES = 21   // tamanho da lista no dia da regra (01/10) — não pode crescer

const RAIZES = ['src/app/dashboard/projetos', 'src/components/projetos']
const CAMPOS = new Set(['input', 'select', 'textarea'])

let falhas = 0
const erro = (msg: string) => { falhas++; console.error('✗', msg) }

function arquivos(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.tsx') ? [p] : []
  })
}

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

function camposSemAjuda(arquivo: string): { linha: number; texto: string }[] {
  const src = ts.createSourceFile(arquivo, readFileSync(arquivo, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
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
        if (temAttr(p, 'ajuda')) return true
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

// ── chaves existem no banco ──
const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(join('supabase/migrations', f), 'utf8')).join('\n')
const chavesBanco = new Set([...migs.matchAll(/'(projetos\.[a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g)].map((m) => m[1]))

const todos = RAIZES.flatMap(arquivos).map((f) => f.replace(/\\/g, '/'))
if (PENDENTES.length > MAX_PENDENTES) erro(`a lista de telas pendentes só pode diminuir (máx. ${MAX_PENDENTES}); tela nova já nasce com o "?"`)
for (const p of PENDENTES) if (!todos.includes(p)) erro(`PENDENTES cita ${p}, que não existe mais — tire da lista`)

let cobertas = 0
for (const f of todos) {
  const faltando = camposSemAjuda(f)
  const pendente = PENDENTES.includes(f)
  if (pendente) {
    if (faltando.length === 0) erro(`${f} já tem ajuda em todos os campos — tire de PENDENTES (a lista só diminui)`)
    else console.log(`· ${f}: pendente da H0 (${faltando.length} campo(s) sem "?")`)
    continue
  }
  if (faltando.length) {
    for (const c of faltando) erro(`${f}:${c.linha} campo sem ajuda ("?"): ${c.texto}`)
  } else cobertas++
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/["'`](projetos\.[a-z0-9_]+(?:\.[a-z0-9_]+)+)["'`]/g)) {
    if (!chavesBanco.has(m[1])) erro(`${f}: chave de ajuda "${m[1]}" não existe no banco (seed em supabase/migrations)`)
  }
}
const mo = 'src/app/dashboard/projetos/mao-obra/page.tsx'
if (PENDENTES.includes(mo)) erro('a Mão de obra não pode ficar em PENDENTES (CEO 01/10: trava já vale nela)')
const usadas = new Set([...readFileSync(mo, 'utf8').matchAll(/["'`](projetos\.mao_obra\.[a-z0-9_.]+)["'`]/g)].map((m) => m[1]))
if (usadas.size < 70) erro(`Mão de obra usa só ${usadas.size} chaves de ajuda — esperado ≥ 70 dos 82 textos aprovados`)
const comp = readFileSync('src/components/ajuda/AjudaCampo.tsx', 'utf8')
for (const b of ['O que preencher', 'Para que serve no cálculo', 'Exemplo', 'Erro comum']) if (!comp.includes(`"${b}"`)) erro(`AjudaCampo sem o bloco "${b}"`)
if (!comp.includes('fn_ajuda_campo_listar') || !comp.includes('fn_ajuda_campo_uso')) erro('AjudaCampo deve ler os textos do banco e registrar o clique')

if (falhas) { console.error(`\ncheck-ajuda-campo: ${falhas} falha(s)`); process.exit(1) }
console.log(`\nAjuda de campo: ok — ${cobertas} arquivo(s) do Hub sem campo pendente, ${usadas.size} chaves na Mão de obra, ${PENDENTES.length} pendente(s) da H0`)
