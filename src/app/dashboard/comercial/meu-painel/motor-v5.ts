// Motor de cálculo do Painel Comercial v5 (CEO 07/11/2026) — porte fiel de docs/prototipos/bi-comercial-v5/logica.js.
//
// É o PRIMEIRO item da reconstrução de /dashboard/comercial/meu-painel no formato v5 aprovado pelo CEO. Aqui vive
// APENAS o cálculo: funções puras, sem React, sem DOM, sem rede. A tela (próximo item) importa este módulo e só
// desenha. Separar o cálculo da tela deixa os números testáveis sem navegador — é o que permite provar, no gate e
// contra o banco real, os números de aceitação da Frioeste (01/10–06/11/2026: R$ 13.983.740 · 6.285 itens ·
// 482 clientes · 127 produtos · R$ 30,61/kg na análise padrão).
//
// O pacote de entrada (`BaseV5`) é exatamente o que a RPC `fn_bi_comercial_base(company, de, ate)` devolve (item 1,
// já em produção), com a MESMA guarda de escopo do BI: o vendedor recebe só as linhas dele. Este módulo não decide
// escopo nem acessa dados — recebe a base já filtrada e calcula.

/** Pacote de dados cru que a RPC `fn_bi_comercial_base` entrega. Índices referenciam as dimensões abaixo. */
export interface BaseV5 {
  modo: 'lider' | 'vendedor'
  de: string
  ate: string
  /** [codigo, nome] do vendedor. */
  ven: [string, string][]
  /** nome da cidade. */
  cid: string[]
  /** nome do transportador. */
  tr: string[]
  /** nome do grupo econômico. */
  grp: string[]
  /** [nome, linha, carne(0/1)] do produto. */
  prod: [string, string, number][]
  /** [prazo_medio, condicao] da nota. */
  notas: [number | null, string | null][]
  /** [nome, cidadeIdx, grupoIdx] do cliente (idx = -1 quando ausente). */
  cli: [string, number, number][]
  /** item de venda: [dia, nota, vendedor, cliente, produto, kg, valor, valor_tabela, carga(-1=sem), transportador]. */
  items: number[][]
  /** devolução: [dia, vendedor, cliente, produto(-1=sem), valor, kg, documento, nome_produto]. */
  dev: (number | string)[][]
}

/** Grupo de produto derivado da linha: 0 desossado (s/osso), 1 com osso, 2 miúdo, 3 subproduto/outros. */
export type GrupoProduto = 0 | 1 | 2 | 3

/** Estado de filtros do painel que altera o cálculo. */
export interface EstadoV5 {
  de: number
  ate: number
  /** 'todos' ou índice do vendedor (number ou string numérica, como no protótipo). */
  ven: 'todos' | number | string
  /** 'todas' ou grupo de produto (0..3). */
  lin: 'todas' | number | string
  /** 'preco' = exclusões afetam só preço/R$-por-kg; 'tudo' = exclusões saem de todo o painel. */
  escopo: 'preco' | 'tudo'
  /** produtos fora da análise (índice do produto → true). */
  excl: Record<number, boolean>
}

/** Agregado de um recorte (total, por produto, por vendedor, etc.). */
export interface Agregado {
  val: number
  kg: number
  valP: number
  kgP: number
  tab: number
  desc: number
  acima: number
  n: number
  ab: number
  notas: Set<number>
  clis: Set<number>
  dias: Set<number>
  v1: number
  v2: number
  vP1: number
  kP1: number
  vP2: number
  kP2: number
  exp: number
}

/** Linha de cliente já com recência, frequência, curva ABC e segmento. */
export interface LinhaCliente {
  ci: number
  nome: string
  cid: string
  cidI: number
  grp: number
  ven: number
  val: number
  kgP: number
  valP: number
  tab: number
  desc: number
  notas: number
  f: number
  r: number
  pri: number
  nl: number
  dev: number
  cur: 0 | 1 | 2
  acum: number
  seg: 0 | 1 | 2 | 3 | 4 | 5
}

/** Resultado do cálculo (o que a tela desenha). */
export interface ModeloV5 {
  its: number[][]
  devs: (number | string)[][]
  mid: number
  tot: Agregado
  prodM: Map<number, Agregado>
  pPrice: Map<number, number>
  venM: Map<number, Agregado>
  cliM: Map<number, Agregado>
  cidM: Map<number, Agregado>
  grpM: Map<number, Agregado>
  linM: Map<string, Agregado>
  gEcoM: Map<number, Agregado>
  diaM: Map<number, Agregado>
  cargaM: Map<number, Agregado>
  trM: Map<number, Agregado>
  cidVen: Map<number, Set<number>>
  prodItens: Map<number, number[]>
  devVen: Map<number, number>
  devProd: Map<string, number>
  devTot: number
  pz: number
  venPz: Map<number, [number, number]>
  clis: LinhaCliente[]
  inc: (pi: number) => boolean
}

/**
 * Grupo de produto por linha (mesma regra do protótipo): "s/osso" → desossado, "osso" → com osso,
 * linha que começa por "miudo" → miúdo, o resto → subproduto/outros.
 */
export function gruposProduto(base: BaseV5): GrupoProduto[] {
  return base.prod.map((p) => {
    const l = (p[1] || '').toLowerCase()
    return (l.indexOf('s/osso') >= 0 ? 0 : l.indexOf('osso') >= 0 ? 1 : l.indexOf('miudo') === 0 ? 2 : 3) as GrupoProduto
  })
}

/** Maior "dia desde o início" presente na base (serve de limite superior do período). */
export function maxDia(base: BaseV5): number {
  return base.items.reduce((m, x) => Math.max(m, x[0]), 0)
}

/**
 * Exclusão padrão da "análise padrão": fica fora quem NÃO é carne/miúdo (despojo e subprodutos),
 * exatamente como o protótipo inicializa `state.excl`.
 */
export function exclusaoPadrao(base: BaseV5): Record<number, boolean> {
  const excl: Record<number, boolean> = {}
  base.prod.forEach((p, i) => {
    if (!p[2]) excl[i] = true
  })
  return excl
}

/** Estado inicial do painel (análise padrão: período inteiro, todos os vendedores/linhas, exclusão padrão). */
export function estadoPadrao(base: BaseV5): EstadoV5 {
  return { de: 0, ate: maxDia(base), ven: 'todos', lin: 'todas', escopo: 'preco', excl: exclusaoPadrao(base) }
}

function novoAgregado(): Agregado {
  return {
    val: 0, kg: 0, valP: 0, kgP: 0, tab: 0, desc: 0, acima: 0, n: 0, ab: 0,
    notas: new Set<number>(), clis: new Set<number>(), dias: new Set<number>(),
    v1: 0, v2: 0, vP1: 0, kP1: 0, vP2: 0, kP2: 0, exp: 0,
  }
}

/**
 * Calcula o modelo do painel a partir da base e do estado de filtros. Porte fiel de `Component.model()`:
 * mesmos recortes, mesma conta de preço (produto a produto), mesmas metades por dias corridos, mesma
 * curva ABC e os mesmos segmentos de cliente.
 */
export function calcularModelo(base: BaseV5, estado: EstadoV5, pg?: GrupoProduto[]): ModeloV5 {
  const st = estado
  const B = base
  const PG = pg ?? gruposProduto(base)
  const inc = (pi: number) => !st.excl[pi]

  const its = B.items.filter(
    (x) =>
      x[0] >= st.de && x[0] <= st.ate &&
      (st.ven === 'todos' || x[2] === +st.ven) &&
      (st.lin === 'todas' || PG[x[4]] === +st.lin) &&
      (st.escopo !== 'tudo' || inc(x[4])),
  )
  const devs = B.dev.filter(
    (x) =>
      (x[0] as number) >= st.de && (x[0] as number) <= st.ate &&
      (st.ven === 'todos' || x[1] === +st.ven) &&
      (st.lin === 'todas' || ((x[3] as number) >= 0 && PG[x[3] as number] === +st.lin)) &&
      (st.escopo !== 'tudo' || (x[3] as number) < 0 || inc(x[3] as number)),
  )
  const mid = st.de + Math.floor((st.ate - st.de + 1) / 2)

  const add = (a: Agregado, x: number[]) => {
    a.val += x[6]; a.kg += x[5]; a.tab += x[7]; a.n++; a.notas.add(x[1]); a.clis.add(x[3]); a.dias.add(x[0])
    if (x[7] > x[6] + 0.005) { a.desc += x[7] - x[6]; a.ab++ } else if (x[6] > x[7] + 0.005) a.acima += x[6] - x[7]
    const h2 = x[0] >= mid
    if (h2) a.v2 += x[6]; else a.v1 += x[6]
    if (inc(x[4]) && x[5] > 0) {
      a.valP += x[6]; a.kgP += x[5]
      if (h2) { a.vP2 += x[6]; a.kP2 += x[5] } else { a.vP1 += x[6]; a.kP1 += x[5] }
    }
  }
  const by = <K>(f: (x: number[]) => K | null | undefined): Map<K, Agregado> => {
    const m = new Map<K, Agregado>()
    its.forEach((x) => {
      const k = f(x)
      if (k === null || k === undefined) return
      let a = m.get(k)
      if (!a) { a = novoAgregado(); m.set(k, a) }
      add(a, x)
    })
    return m
  }

  const tot = novoAgregado()
  its.forEach((x) => add(tot, x))
  const prodM = by((x) => x[4])
  const pPrice = new Map<number, number>()
  prodM.forEach((a, k) => { if (a.kgP > 0) pPrice.set(k, a.valP / a.kgP) })
  const venM = by((x) => x[2])
  its.forEach((x) => { if (inc(x[4]) && x[5] > 0 && pPrice.has(x[4])) venM.get(x[2])!.exp += x[5] * pPrice.get(x[4])! })
  const cliM = by((x) => x[3])
  const cidM = by((x) => B.cli[x[3]][1])
  const grpM = by((x) => PG[x[4]])
  const linM = by((x) => B.prod[x[4]][1])
  const gEcoM = by((x) => (B.cli[x[3]][2] >= 0 ? B.cli[x[3]][2] : null))
  const diaM = by((x) => x[0])
  const cargaM = by((x) => (x[8] >= 0 ? x[8] : null))
  const trM = by((x) => (x[8] >= 0 ? x[9] : null))

  const cliVen = new Map<number, Map<number, number>>()
  its.forEach((x) => { let m = cliVen.get(x[3]); if (!m) { m = new Map(); cliVen.set(x[3], m) } m.set(x[2], (m.get(x[2]) || 0) + x[6]) })
  const cliPG = new Map<number, Set<number>>()
  its.forEach((x) => { if (PG[x[4]] < 3) { let s = cliPG.get(x[3]); if (!s) { s = new Set(); cliPG.set(x[3], s) } s.add(PG[x[4]]) } })
  const cidVen = new Map<number, Set<number>>()
  its.forEach((x) => { const c = B.cli[x[3]][1]; let s = cidVen.get(c); if (!s) { s = new Set(); cidVen.set(c, s) } s.add(x[2]) })
  const prodItens = new Map<number, number[]>()
  its.forEach((x) => { if (x[5] > 0) { let a = prodItens.get(x[4]); if (!a) { a = []; prodItens.set(x[4], a) } a.push(x[6] / x[5]) } })

  const devVen = new Map<number, number>()
  const devCli = new Map<number, number>()
  const devProd = new Map<string, number>()
  let devTot = 0
  devs.forEach((x) => {
    const valor = x[4] as number
    devTot += valor
    devVen.set(x[1] as number, (devVen.get(x[1] as number) || 0) + valor)
    devCli.set(x[2] as number, (devCli.get(x[2] as number) || 0) + valor)
    devProd.set(x[7] as string, (devProd.get(x[7] as string) || 0) + valor)
  })

  const notaVal = new Map<number, number>()
  its.forEach((x) => notaVal.set(x[1], (notaVal.get(x[1]) || 0) + x[6]))
  let pzNum = 0, pzDen = 0
  notaVal.forEach((v, n) => { const pz = B.notas[n][0]; if (pz !== null && pz !== undefined) { pzNum += pz * v; pzDen += v } })
  const venPz = new Map<number, [number, number]>()
  its.forEach((x) => {
    const pz = B.notas[x[1]][0]
    if (pz !== null && pz !== undefined) { let a = venPz.get(x[2]); if (!a) { a = [0, 0]; venPz.set(x[2], a) } a[0] += pz * x[6]; a[1] += x[6] }
  })

  const clis: LinhaCliente[] = []
  cliM.forEach((a, ci) => {
    let ult = -1, pri = 1e9
    a.dias.forEach((d) => { if (d > ult) ult = d; if (d < pri) pri = d })
    let vmax = -1, vv = -1
    ;(cliVen.get(ci) || new Map<number, number>()).forEach((v, k) => { if (v > vmax) { vmax = v; vv = k } })
    clis.push({
      ci, nome: B.cli[ci][0], cid: B.cid[B.cli[ci][1]], cidI: B.cli[ci][1], grp: B.cli[ci][2], ven: vv,
      val: a.val, kgP: a.kgP, valP: a.valP, tab: a.tab, desc: a.desc, notas: a.notas.size, f: a.dias.size,
      r: st.ate - ult, pri, nl: (cliPG.get(ci) || new Set()).size, dev: devCli.get(ci) || 0,
      cur: 0, acum: 0, seg: 5,
    })
  })
  clis.sort((a, b) => b.val - a.val)
  let acc = 0
  clis.forEach((c) => { const antes = acc; acc += c.val; c.cur = antes < 0.8 * tot.val ? 0 : antes < 0.95 * tot.val ? 1 : 2; c.acum = acc / (tot.val || 1) })
  const novoLim = st.ate - 17
  const temNovo = st.de < novoLim
  clis.forEach((c) => {
    c.seg = c.r <= 7 && c.f >= 8 ? 0 : c.r <= 14 && c.f >= 4 ? 1 : temNovo && c.pri >= novoLim ? 2 : c.r <= 14 ? 3 : c.r <= 30 && c.f >= 3 ? 4 : 5
  })

  return {
    its, devs, mid, tot, prodM, pPrice, venM, cliM, cidM, grpM, linM, gEcoM, diaM, cargaM, trM,
    cidVen, prodItens, devVen, devProd, devTot, pz: pzDen ? pzNum / pzDen : 0, venPz, clis, inc,
  }
}

/** Números de topo da "Visão geral" (os mesmos provados contra o banco). */
export interface ResumoV5 {
  totalValor: number
  itens: number
  clientes: number
  produtos: number
  /** R$ por kg da análise (Σ valor ÷ Σ kg dos produtos incluídos com kg > 0). */
  precoPorKg: number
}

/** Extrai os indicadores de topo do modelo — o painel os exibe e o gate/banco os conferem. */
export function resumo(modelo: ModeloV5): ResumoV5 {
  const t = modelo.tot
  return {
    totalValor: t.val,
    itens: modelo.its.length,
    clientes: modelo.cliM.size,
    produtos: modelo.prodM.size,
    precoPorKg: t.kgP ? t.valP / t.kgP : 0,
  }
}
