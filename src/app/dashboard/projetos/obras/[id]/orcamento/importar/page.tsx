'use client'
// Tela 334 (Hub · Onda C-2) — Importar o orçamento por EAP de uma planilha (.xlsx) do cliente.
// A planilha entra sem redigitar: lê o arquivo no navegador (SheetJS), autodetecta o layout tipo
// Gaia (código "1.2.3", descrição, unidade, quantidade, material, mão de obra, local), mostra a
// PRÉVIA com validação e só grava depois de "Confirmar". A gravação é idempotente por hash do
// arquivo. Nada acessa tabela direto: a prévia usa fn_projetos_orcamento_eap_importar_validar e a
// gravação fn_projetos_orcamento_eap_importar (SECURITY DEFINER, guarda por empresa, REVOKE anon).
// RD-95: "?" no campo. RD-96/RD-100: design próprio PS, sem nome de outro sistema. Mobile-first.
import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { comPrazo } from '@/lib/comPrazo'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CheckSquare, Square } from 'lucide-react'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'
const CARD: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18, boxShadow: '0 1px 2px rgba(61,35,20,0.04)' }
const brl = (n: number) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Converte número no formato BR ("1.234,50") para o canônico com ponto ("1234.50"). Vazio → ''.
function numCanonico(raw: string): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const limpo = s.replace(/[R$\s]/g, '')
  // "1.234,50" → tira o ponto de milhar e troca a vírgula decimal
  if (/,/.test(limpo)) return limpo.replace(/\./g, '').replace(',', '.')
  return limpo
}
const numBR = (raw: string): number => { const n = Number(numCanonico(raw)); return Number.isFinite(n) ? n : 0 }

// §334 — normaliza a unidade da planilha para a grafia canônica do orçamento (un, m, m², m³, kg, pç, vb, mês, h).
// Planilhas de cliente escrevem a MESMA unidade de formas diferentes ("UND", "unid.", "M2", "m²", "pç", "peça",
// "verba", "hr"…). Sem isto, o mesmo insumo entra com unidades diferentes e não soma/compara. Só reescreve o que
// RECONHECE; unidade desconhecida fica como veio (trim), para não perder informação do cliente. Sem rede: função pura.
function normalizarUnidade(raw: string): string {
  const orig = String(raw ?? '').trim()
  if (!orig) return ''
  // minúsculo, sem acento, sem ponto/espaço, para casar grafias (ex.: "M²." → "m2"; "Mês" → "mes")
  const k = orig.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.\s]/g, '')
  const mapa: Record<string, string> = {
    // unidade
    un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un', u: 'un', pcto: 'un',
    // peça
    pc: 'pç', pca: 'pç', peca: 'pç', pecas: 'pç', pec: 'pç', 'pç': 'pç',
    // metro linear
    m: 'm', ml: 'm', metro: 'm', metros: 'm', metrolinear: 'm', mlinear: 'm',
    // metro quadrado
    m2: 'm²', 'm²': 'm²', mq: 'm²', metroquadrado: 'm²', metrosquadrados: 'm²',
    // metro cúbico
    m3: 'm³', 'm³': 'm³', mc: 'm³', metrocubico: 'm³', metroscubicos: 'm³',
    // quilograma
    kg: 'kg', quilo: 'kg', quilos: 'kg', kilo: 'kg', kilograma: 'kg', quilograma: 'kg', kgs: 'kg',
    // verba
    vb: 'vb', verba: 'vb', verbaglobal: 'vb', gl: 'vb', global: 'vb',
    // mês
    mes: 'mês', meses: 'mês', 'mês': 'mês',
    // hora
    h: 'h', hr: 'h', hrs: 'h', hora: 'h', horas: 'h', hs: 'h',
    // litro (comum em planilhas de obra; mantém como 'L')
    l: 'L', lt: 'L', litro: 'L', litros: 'L',
    // tonelada
    t: 't', ton: 't', tonelada: 't', toneladas: 't',
    // saco / cento / par / conjunto
    sc: 'sc', saco: 'sc', sacos: 'sc',
    cto: 'cto', cento: 'cto',
    par: 'par', pares: 'par',
    cj: 'cj', conj: 'cj', conjunto: 'cj', jogo: 'cj', kit: 'cj',
  }
  return mapa[k] ?? orig
}

// §334 — conferência do total (acceptance C-2): a soma importada tem de bater, centavo a centavo, com o total
// que a própria planilha declara. Procura, nas linhas da planilha, uma linha de "TOTAL" (geral/global/do orçamento/
// final) e devolve o MAIOR valor numérico dela (o grande total costuma ser o maior número da linha). Sem rede: só
// lê a matriz já carregada. Devolve null quando não há um total declarado reconhecível (aí a tela só mostra a soma
// importada para o usuário conferir na mão).
function detectarTotalPlanilha(matriz: string[][]): number | null {
  let melhor: { peso: number; valor: number } | null = null
  for (const row of matriz) {
    if (!Array.isArray(row)) continue
    const texto = row.map((c) => String(c ?? '')).join(' ')
    if (!/\btotal\b/i.test(texto)) continue
    // dá preferência à linha do total "forte" (geral/global/orçamento/final/investimento)
    const peso = /(geral|global|or[çc]amento|final|investimento|do\s+or[çc]amento)/i.test(texto) ? 2 : 1
    let maior = 0
    for (const c of row) {
      const v = numBR(String(c ?? ''))
      if (v > maior) maior = v
    }
    if (maior > 0 && (!melhor || peso > melhor.peso || (peso === melhor.peso && maior > melhor.valor))) {
      melhor = { peso, valor: maior }
    }
  }
  return melhor ? melhor.valor : null
}

// §334 — nível hierárquico da EAP pela quantidade de pontos do código ("1"=1, "1.2"=2, "1.2.3"=3…), limitado a 6.
// Código sem ponto reconhecível = nível 1. Só conta blocos numéricos (ignora sufixos como "1.2-A"). Função pura.
function nivelEap(codigo: string): number {
  const c = String(codigo ?? '').trim()
  if (!c) return 0
  const blocos = c.split('.').map((b) => b.trim()).filter((b) => /^\d+[a-z]?$/i.test(b))
  if (!blocos.length) return 1
  return Math.min(blocos.length, 6)
}

type Linha = {
  eap_codigo: string; descricao: string; unidade: string
  quantidade: string; custo_material_unit: string; custo_mao_obra_unit: string
  local_tipo: string; local_nome: string
}
type LinhaValidada = Linha & { idx: number; status: 'ok' | 'erro'; motivos: string[] }
type Passo = 'upload' | 'preview' | 'resultado'

// Acha, nas primeiras linhas, qual é o cabeçalho e o índice de cada coluna que conhecemos.
function mapearColunas(matriz: string[][]): { headerRow: number; col: Record<string, number> } | null {
  const alvos: Record<string, RegExp> = {
    eap_codigo: /c[oó]d|eap|item/i,
    descricao: /descri|servi[çc]o|insumo/i,
    unidade: /unid|^un\.?$|^und/i,
    quantidade: /qtd|quant/i,
    custo_material_unit: /material|mat\.?$|insumo/i,
    custo_mao_obra_unit: /m[aã]o.?de.?obra|m\.?o\.?|\bmo\b|servi[çc]o unit/i,
    // §334: planilha "simples" (prestadora/pessoa física) traz UM valor por item, sem separar material × mão de obra.
    // Casamos "Preço/Valor/Custo Unitário", "P. Unit.", "V. Unit", "Vlr Unit", "Unitário". Só é usado quando NÃO há
    // coluna de material NEM de mão de obra (ver `modoValorUnico`), para não atrapalhar a planilha detalhada.
    preco_unit: /(pre[çc]o|valor|vlr|custo|p|v)\.?\s*unit|unit[aá]ri/i,
    local_tipo: /local|pavimento|ambiente|zona/i,
  }
  for (let r = 0; r < Math.min(matriz.length, 15); r++) {
    const linha = matriz[r] ?? []
    const col: Record<string, number> = {}
    for (const [chave, rx] of Object.entries(alvos)) {
      const idx = linha.findIndex((c) => rx.test(String(c ?? '')))
      if (idx >= 0 && col[chave] === undefined) col[chave] = idx
    }
    // precisa pelo menos de código, descrição e quantidade pra valer como cabeçalho
    if (col.eap_codigo !== undefined && col.descricao !== undefined && col.quantidade !== undefined) {
      return { headerRow: r, col }
    }
  }
  return null
}

export default function ImportarOrcamentoEapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [orcamentoId, setOrcamentoId] = useState<string | null>(null)
  const [obraNome, setObraNome] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [passo, setPasso] = useState<Passo>('upload')
  const [arquivoNome, setArquivoNome] = useState('')
  const [hash, setHash] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [validadas, setValidadas] = useState<LinhaValidada[]>([])
  const [resumo, setResumo] = useState<{ validos: number; com_erro: number } | null>(null)
  const [resultado, setResultado] = useState<{ importados: number; ignorados: number; erros: number; ja_importado?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [aviso, setAviso] = useState('')
  // §334: o CÓDIGO É TEXTO. Quando a célula do código veio NUMÉRICA na planilha (ex.: "23,10" gravado como número 23.1),
  // o zero à direita se perde (23.1 ≠ 23.10). Guardamos os índices (base 0 em `linhas`) dessas linhas para avisar e pedir
  // confirmação antes de gravar. Detecção pelo TIPO da célula (SheetJS `cell.t === 'n'`), não pelo texto já formatado.
  const [codigosNumericos, setCodigosNumericos] = useState<Set<number>>(new Set())
  const [cienteNumerico, setCienteNumerico] = useState(false)
  // §334: relatório consolidado de códigos EAP repetidos no arquivo (ex.: "1.2.9" quatro vezes). Cada repetição já
  // entra como "com erro" na validação; aqui mostramos o resumo porque a tabela só exibe as primeiras 300 linhas.
  const [codigosRepetidos, setCodigosRepetidos] = useState<{ codigo: string; vezes: number }[]>([])
  // §334: linhas da planilha SEM código e SEM descrição (títulos/agrupadores/linhas vazias) que foram puladas.
  const [linhasIgnoradas, setLinhasIgnoradas] = useState(0)
  // §334: quantas linhas tiveram a unidade padronizada para a grafia canônica (ex.: "UND"→"un", "M2"→"m²").
  const [unidadesNormalizadas, setUnidadesNormalizadas] = useState(0)
  // §334: linhas de ESTRUTURA (agrupador/título) da EAP — têm código, mas sem unidade, sem quantidade e sem custo
  // (ex.: "1 SERVIÇOS PRELIMINARES"). Não são item do orçamento: não entram e NÃO contam como "linha com erro".
  const [agrupadoresEstrutura, setAgrupadoresEstrutura] = useState(0)
  // §334: planilha trouxe um único valor por item (sem separar material × mão de obra) — usado como custo do item.
  const [valorUnicoAviso, setValorUnicoAviso] = useState(false)
  // §334: qual aba da planilha foi usada, quando o arquivo tem mais de uma (a EAP pode não estar na 1ª aba).
  // `ignoradas` = nomes das demais abas que NÃO entram na EAP ("Outros Custos"/"Análise"/… vão para a Viabilidade 316).
  const [abaImportada, setAbaImportada] = useState<{ nome: string; total: number; ignoradas: string[] } | null>(null)
  // §334 conferência do total: soma importada (Σ qtd × (material + mão de obra)) × total declarado na planilha.
  const [totalImportado, setTotalImportado] = useState(0)
  const [totalPlanilha, setTotalPlanilha] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.from('projetos_obras').select('orcamento_id, nome').eq('id', id).maybeSingle()
    setLoading(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível abrir a obra.')); return }
    if (!data) { setErro('Esta obra não existe ou você não tem acesso a ela na empresa ativa.'); return }
    setObraNome((data as { nome: string | null }).nome ?? '')
    setOrcamentoId((data as { orcamento_id: string | null }).orcamento_id ?? null)
  }, [id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  async function hashArquivo(buf: ArrayBuffer): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  const lerArquivo = async (f: File) => {
    if (!orcamentoId) return
    setBusy(true); setAviso('Lendo a planilha…'); setErro(null)
    try {
      const buf = await f.arrayBuffer()
      const XLSX = await import('xlsx')
      const wb = XLSX.read(buf, { type: 'array' })
      // §334: a planilha do cliente costuma ter VÁRIAS abas — a EAP numa, e "Outros Custos"/"Análise"/"Resumo"/"Capa"
      // noutras (essas vão para a viabilidade, não para a EAP). Em vez de ler sempre a 1ª aba (que pode ser uma capa),
      // procuramos a PRIMEIRA aba cujo conteúdo tem cabeçalho de EAP reconhecível (código+descrição+quantidade),
      // ignorando as abas de nome claramente não-EAP. Se nenhuma casar, caímos na 1ª aba (comportamento antigo).
      const ehAbaNaoEap = (nome: string) => /an[aá]lise|outros\s*custos|resumo|capa|cronograma|curva|bdi|composi/i.test(nome)
      let ws = wb.Sheets[wb.SheetNames[0]]
      let matriz = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' })
      let mapa = mapearColunas(matriz)
      let abaUsada = wb.SheetNames[0]
      if (!mapa && wb.SheetNames.length > 1) {
        // 1ª passada: só abas de nome plausível de EAP; 2ª passada: qualquer aba (nome não ajuda, mas o conteúdo sim)
        const ordem = [...wb.SheetNames.filter((n) => !ehAbaNaoEap(n)), ...wb.SheetNames.filter((n) => ehAbaNaoEap(n))]
        for (const nome of ordem) {
          const wsTest = wb.Sheets[nome]
          const mTest = XLSX.utils.sheet_to_json<string[]>(wsTest, { header: 1, raw: false, defval: '' })
          const mapTest = mapearColunas(mTest)
          if (mapTest) { ws = wsTest; matriz = mTest; mapa = mapTest; abaUsada = nome; break }
        }
      }
      if (!mapa) { setAviso(''); setErro('Não reconheci as colunas da planilha. Confira se há colunas de código, descrição e quantidade.'); return }
      const { headerRow, col } = mapa
      const pega = (linha: string[], chave: string) => (col[chave] === undefined ? '' : String(linha[col[chave]] ?? '').trim())
      // §334: planilha "simples" (prestadora/pessoa física) — tem UM valor por item (coluna de preço/valor unitário) e
      // NÃO separa material × mão de obra. Nesse caso o valor unitário vira o custo do item (entra em "material" para
      // somar no total e na árvore; a mão de obra fica vazia). Só vale quando NÃO há coluna de material NEM de MO.
      const modoValorUnico = col.custo_material_unit === undefined && col.custo_mao_obra_unit === undefined && col.preco_unit !== undefined
      // Origem do range da planilha: matriz[r][c] corresponde à célula (range.s.r + r, range.s.c + c).
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
      // A célula do código veio como NÚMERO? (tipo 'n' no SheetJS). Guarda índice base 0 da linha em `lin`.
      const numericos = new Set<number>()
      const lin: Linha[] = []
      let ignoradas = 0
      let normalizadas = 0
      let agrupadores = 0
      for (let r = headerRow + 1; r < matriz.length; r++) {
        const row = matriz[r] ?? []
        const eap = pega(row, 'eap_codigo')
        const desc = pega(row, 'descricao')
        // pula linhas totalmente vazias (sem código e sem descrição); conta p/ o relatório do que não foi lido.
        if (!eap && !desc) { if (row.some((c) => String(c ?? '').trim())) ignoradas++; continue }
        const unidadeOrig = pega(row, 'unidade')
        const unidadeNorm = normalizarUnidade(unidadeOrig)
        const qtd = numCanonico(pega(row, 'quantidade'))
        let mat = numCanonico(pega(row, 'custo_material_unit'))
        let mo = numCanonico(pega(row, 'custo_mao_obra_unit'))
        // §334: planilha de valor único — o preço/valor unitário vira o custo do item (sem separar material × MO).
        if (modoValorUnico) { mat = numCanonico(pega(row, 'preco_unit')); mo = '' }
        // §334: linha COM unidade = item; linha SEM unidade (e sem quantidade e sem custo) = AGRUPADOR/título da
        // estrutura (ex.: "1 SERVIÇOS PRELIMINARES"). Agrupador não é item do orçamento e não deve contar como
        // "linha com erro" (antes a validação devolvia "unidade vazia"). Conservador: só é agrupador quando tem
        // código estruturado MAS sem unidade, sem quantidade e sem custo. Item com valor e sem unidade continua
        // indo como erro (falta real a corrigir). Não muda o que é gravado — agrupador nunca seria importado.
        if (eap && !unidadeNorm && numBR(qtd) === 0 && numBR(mat) === 0 && numBR(mo) === 0) { agrupadores++; continue }
        const linIdx = lin.length
        // célula do código com tipo numérico perde o zero à direita — avisa só nos itens de fato.
        if (eap && col.eap_codigo !== undefined) {
          const addr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + col.eap_codigo })
          const cel = ws[addr] as { t?: string } | undefined
          if (cel && cel.t === 'n') numericos.add(linIdx)
        }
        if (unidadeOrig && unidadeNorm !== unidadeOrig.trim()) normalizadas++
        lin.push({
          eap_codigo: eap, descricao: desc, unidade: unidadeNorm,
          quantidade: qtd,
          custo_material_unit: mat,
          custo_mao_obra_unit: mo,
          local_tipo: pega(row, 'local_tipo'), local_nome: pega(row, 'local_tipo'),
        })
      }
      if (!lin.length) { setAviso(''); setErro('A planilha não tem linhas de serviço abaixo do cabeçalho.'); return }
      if (lin.length > 10000) { setAviso(''); setErro('A planilha tem mais de 10.000 linhas. Divida em partes.'); return }
      const h = await hashArquivo(buf)
      setArquivoNome(f.name); setHash(h); setLinhas(lin)
      setCodigosNumericos(numericos); setCienteNumerico(false)
      // §334: conta quantas vezes cada código EAP aparece; lista os que repetem (2+), do mais repetido ao menos.
      const cont = new Map<string, number>()
      for (const l of lin) { const c = l.eap_codigo.trim(); if (c) cont.set(c, (cont.get(c) ?? 0) + 1) }
      setCodigosRepetidos([...cont.entries()].filter(([, n]) => n > 1).map(([codigo, vezes]) => ({ codigo, vezes })).sort((a, b) => b.vezes - a.vezes))
      setLinhasIgnoradas(ignoradas)
      setUnidadesNormalizadas(normalizadas)
      setAgrupadoresEstrutura(agrupadores)
      setValorUnicoAviso(modoValorUnico)
      setAbaImportada(wb.SheetNames.length > 1 ? { nome: abaUsada, total: wb.SheetNames.length, ignoradas: wb.SheetNames.filter((n) => n !== abaUsada) } : null)
      // §334 conferência: soma importada = Σ qtd × (material + mão de obra) de todas as linhas lidas.
      const somaImportada = lin.reduce((acc, l) => acc + numBR(l.quantidade) * (numBR(l.custo_material_unit) + numBR(l.custo_mao_obra_unit)), 0)
      setTotalImportado(somaImportada)
      setTotalPlanilha(detectarTotalPlanilha(matriz))
      // prévia no banco (sem gravar)
      const { data, error } = await comPrazo(async () => await supabase.rpc('fn_projetos_orcamento_eap_importar_validar', { p_orcamento_id: orcamentoId, p_linhas: lin }), { ms: 15000, tentativas: 1, label: 'eap-validar' })
      if (error) { setAviso(''); setErro(erroAmigavel(error, 'Não foi possível validar a planilha.')); return }
      const r = data as { validos: number; com_erro: number; linhas: LinhaValidada[] }
      setValidadas(r.linhas ?? []); setResumo({ validos: r.validos ?? 0, com_erro: r.com_erro ?? 0 })
      setPasso('preview'); setAviso('')
    } catch {
      setAviso(''); setErro('Não consegui ler a planilha. Use um arquivo .xlsx válido.')
    } finally { setBusy(false) }
  }

  const confirmar = async () => {
    if (!orcamentoId || !linhas.length) return
    setBusy(true); setErro(null)
    const { data, error } = await comPrazo(async () => await supabase.rpc('fn_projetos_orcamento_eap_importar', { p_orcamento_id: orcamentoId, p_linhas: linhas, p_arquivo_hash: hash, p_arquivo_nome: arquivoNome }), { ms: 30000, tentativas: 1, label: 'eap-importar' })
    setBusy(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível importar. Tente de novo.')); return }
    const r = data as { importados: number; ignorados: number; erros: number; ja_importado?: boolean }
    setResultado({ importados: r.importados ?? 0, ignorados: r.ignorados ?? 0, erros: r.erros ?? 0, ja_importado: r.ja_importado })
    setPasso('resultado')
  }

  const recomecar = () => { setPasso('upload'); setLinhas([]); setValidadas([]); setResumo(null); setResultado(null); setHash(''); setArquivoNome(''); setErro(null); setAviso(''); setCodigosNumericos(new Set()); setCienteNumerico(false); setCodigosRepetidos([]); setLinhasIgnoradas(0); setUnidadesNormalizadas(0); setAgrupadoresEstrutura(0); setValorUnicoAviso(false); setAbaImportada(null); setTotalImportado(0); setTotalPlanilha(null) }

  // diferença entre a soma importada e o total declarado na planilha; "confere" quando ≤ 1 centavo.
  const difTotal = totalPlanilha === null ? null : Math.round((totalImportado - totalPlanilha) * 100) / 100
  const confereTotal = difTotal !== null && Math.abs(difTotal) <= 0.01

  // §334 — resumo das linhas COM ERRO agrupado por motivo, cobrindo TODAS as linhas validadas (a tabela da prévia
  // mostra só as primeiras 300). Assim o usuário corrige a planilha e importa de novo sem caçar linha a linha os
  // erros que ficaram abaixo da 300ª. Só leitura; computado a partir de `validadas`, sem rede.
  const errosPorMotivo = (() => {
    const m = new Map<string, { vezes: number; codigos: string[] }>()
    for (const l of validadas) {
      if (l.status !== 'erro') continue
      for (const motivo of (l.motivos?.length ? l.motivos : ['Com erro'])) {
        const e = m.get(motivo) ?? { vezes: 0, codigos: [] }
        e.vezes++
        if (e.codigos.length < 12 && l.eap_codigo) e.codigos.push(l.eap_codigo)
        m.set(motivo, e)
      }
    }
    return [...m.entries()].map(([motivo, v]) => ({ motivo, ...v })).sort((a, b) => b.vezes - a.vezes)
  })()

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '20px 16px 48px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
          <Link href={`/dashboard/projetos/obras/${id}/orcamento`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>Ver orçamento por EAP →</Link>
        </div>

        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: ESP, letterSpacing: -0.3 }}>Importar orçamento da planilha</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: MUT }}>{obraNome ? `Obra: ${obraNome}. ` : ''}A planilha entra como itens do orçamento por EAP, sem redigitar.</p>
        </div>

        {loading && <div style={CARD}>Carregando a obra…</div>}
        {erro && <div role="alert" style={{ ...CARD, borderColor: VERM, color: VERM, fontSize: 13 }}>{erro}</div>}

        {!loading && !orcamentoId && !erro && (
          <div style={{ ...CARD, display: 'grid', gap: 10 }}>
            <strong style={{ color: ESP }}>Esta obra ainda não tem orçamento.</strong>
            <span style={{ fontSize: 13, color: MUT }}>Crie o orçamento da obra primeiro; depois a planilha pode ser importada para dentro dele.</span>
            <Link href={`/dashboard/projetos/obras/${id}/orcamento`} style={{ justifySelf: 'start', background: ESP, color: BG, borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Abrir o orçamento</Link>
          </div>
        )}

        {!loading && orcamentoId && passo === 'upload' && (
          <div style={{ ...CARD, display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: ESP }}>
                Planilha do orçamento (.xlsx)
                <AjudaCampo chave="projetos.orcamento_eap.importar_arquivo" />
              </span>
              <input
                data-testid="eap-importar-arquivo"
                type="file"
                accept=".xlsx,.xls"
                disabled={busy}
                aria-label="Planilha do orçamento em Excel"
                style={{ fontSize: 13 }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); e.target.value = '' }}
              />
            </label>
            <p style={{ margin: 0, fontSize: 12, color: MUT }}>
              Reconhecemos colunas de código (EAP), descrição, unidade, quantidade, material, mão de obra e local.
              O código é texto — planilhas podem gravar &quot;23,10&quot; como número e perder o zero; confira os códigos na prévia.
              As unidades são padronizadas para a grafia do orçamento (ex.: &quot;UND&quot; → un, &quot;M2&quot; → m², &quot;hr&quot; → h); o que não reconhecemos fica como veio.
            </p>
            {aviso && <div role="status" style={{ fontSize: 13, color: ESP }}>{aviso}</div>}
          </div>
        )}

        {!loading && passo === 'preview' && resumo && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ ...CARD, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: MUT }}>Arquivo: <strong style={{ color: ESP }}>{arquivoNome}</strong></span>
              {abaImportada && <span data-testid="eap-importar-aba" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: MUT }}>Aba: <strong style={{ color: ESP }}>{abaImportada.nome}</strong> <AjudaCampo chave="projetos.orcamento_eap.importar_aba" /></span>}
              {abaImportada && abaImportada.ignoradas.length > 0 && (
                <span data-testid="eap-importar-abas-ignoradas" style={{ flexBasis: '100%', fontSize: 12, color: MUT, lineHeight: 1.5 }}>
                  Importei só a aba da EAP. {abaImportada.ignoradas.length === 1 ? 'A outra aba' : `As outras ${abaImportada.ignoradas.length} abas`} <strong style={{ color: ESP }}>{abaImportada.ignoradas.join(', ')}</strong> {abaImportada.ignoradas.length === 1 ? 'não entra' : 'não entram'} no orçamento por EAP — abas como “Outros Custos” e “Análise” pertencem ao estudo de <strong style={{ color: ESP }}>Viabilidade</strong> do empreendimento.
                </span>
              )}
              <span style={{ fontSize: 13, color: VERDE, fontWeight: 700 }}>{resumo.validos} válidas</span>
              <span style={{ fontSize: 13, color: resumo.com_erro ? VERM : MUT, fontWeight: 700 }}>{resumo.com_erro} com erro</span>
              {codigosNumericos.size > 0 && <span style={{ fontSize: 13, color: GOLD, fontWeight: 700 }}>{codigosNumericos.size} código(s) como número</span>}
              {codigosRepetidos.length > 0 && <span style={{ fontSize: 13, color: GOLD, fontWeight: 700 }}>{codigosRepetidos.length} código(s) repetido(s)</span>}
              {linhasIgnoradas > 0 && <span data-testid="eap-importar-ignoradas" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: MUT, fontWeight: 700 }}>{linhasIgnoradas} linha(s) ignorada(s) <AjudaCampo chave="projetos.orcamento_eap.importar_ignoradas" /></span>}
              {unidadesNormalizadas > 0 && <span data-testid="eap-importar-unidades-normalizadas" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: VERDE, fontWeight: 700 }}>{unidadesNormalizadas} unidade(s) padronizada(s) <AjudaCampo chave="projetos.orcamento_eap.importar_unidades" /></span>}
              {agrupadoresEstrutura > 0 && <span data-testid="eap-importar-agrupadores" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: MUT, fontWeight: 700 }}>{agrupadoresEstrutura} linha(s) de estrutura <AjudaCampo chave="projetos.orcamento_eap.importar_estrutura" /></span>}
              {valorUnicoAviso && <span data-testid="eap-importar-valor-unico" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: GOLD, fontWeight: 700 }}>valor único por item <AjudaCampo chave="projetos.orcamento_eap.importar_valor_unico" /></span>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" data-testid="eap-importar-recomecar" onClick={recomecar} disabled={busy} style={{ background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Trocar arquivo</button>
                <button type="button" data-testid="eap-importar-confirmar" onClick={() => void confirmar()} disabled={busy || resumo.validos === 0 || (codigosNumericos.size > 0 && !cienteNumerico)} style={{ background: ESP, color: BG, border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: busy || resumo.validos === 0 || (codigosNumericos.size > 0 && !cienteNumerico) ? 'default' : 'pointer', opacity: busy || resumo.validos === 0 || (codigosNumericos.size > 0 && !cienteNumerico) ? 0.5 : 1 }}>Confirmar importação</button>
              </div>
            </div>
            {codigosRepetidos.length > 0 && (
              <div data-testid="eap-importar-codigos-repetidos" role="alert" style={{ ...CARD, borderColor: GOLD, background: 'rgba(200,148,26,0.06)', display: 'grid', gap: 8 }}>
                <strong style={{ color: ESP, fontSize: 14 }}>Códigos EAP repetidos no arquivo</strong>
                <span style={{ fontSize: 13, color: ESP, lineHeight: 1.5 }}>
                  {codigosRepetidos.length} código(s) aparecem mais de uma vez. Cada repetição entra como <strong>com erro</strong> (código EAP duplicado). Confira se são itens realmente distintos — então ajuste o código na planilha — ou se é duplicação a remover.
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {codigosRepetidos.slice(0, 40).map((r) => (
                    <span key={r.codigo} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: ESP, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '3px 8px' }}>{r.codigo} <strong style={{ color: GOLD }}>×{r.vezes}</strong></span>
                  ))}
                  {codigosRepetidos.length > 40 && <span style={{ fontSize: 12, color: MUT, alignSelf: 'center' }}>e mais {codigosRepetidos.length - 40}…</span>}
                </div>
              </div>
            )}
            {resumo.com_erro > 0 && errosPorMotivo.length > 0 && (
              <div data-testid="eap-importar-erros-por-motivo" role="alert" style={{ ...CARD, borderColor: VERM, background: 'rgba(185,28,28,0.05)', display: 'grid', gap: 8 }}>
                <strong style={{ color: ESP, fontSize: 14 }}>Linhas com erro, por motivo</strong>
                <span style={{ fontSize: 13, color: ESP, lineHeight: 1.5 }}>
                  {resumo.com_erro} linha(s) não serão importadas. Corrija na planilha e importe de novo — a prévia abaixo mostra só as primeiras 300 linhas, então use este resumo para achar todas.
                </span>
                <div style={{ display: 'grid', gap: 6 }}>
                  {errosPorMotivo.map((e) => (
                    <div key={e.motivo} style={{ display: 'grid', gap: 2, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
                      <span style={{ fontSize: 13, color: ESP }}><strong style={{ color: VERM }}>{e.vezes}×</strong> {e.motivo}</span>
                      {e.codigos.length > 0 && (
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: MUT }}>
                          {e.codigos.join(', ')}{e.vezes > e.codigos.length ? '…' : ''}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div data-testid="eap-importar-conferencia-total" style={{ ...CARD, display: 'grid', gap: 8, borderColor: confereTotal ? VERDE : (difTotal !== null ? GOLD : LINE) }}>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: MUT }}>Total importado (soma dos itens) <AjudaCampo chave="projetos.orcamento_eap.importar_conferencia" /></span>
                <strong data-testid="eap-importar-total-importado" style={{ fontSize: 18, color: ESP, letterSpacing: -0.3 }}>{brl(totalImportado)}</strong>
                {totalPlanilha !== null && (
                  <span style={{ fontSize: 13, color: MUT }}>× Total declarado na planilha <strong style={{ color: ESP }}>{brl(totalPlanilha)}</strong></span>
                )}
              </div>
              {totalPlanilha === null ? (
                <span style={{ fontSize: 12.5, color: MUT }}>Não encontrei um &quot;Total&quot; declarado na planilha para conferir automaticamente. Compare o total importado acima com o total da sua planilha antes de confirmar.</span>
              ) : confereTotal ? (
                <span data-testid="eap-importar-total-confere" style={{ fontSize: 13, color: VERDE, fontWeight: 700 }}>✓ Confere com o total da planilha, centavo a centavo.</span>
              ) : (
                <span data-testid="eap-importar-total-difere" role="alert" style={{ fontSize: 13, color: GOLD, fontWeight: 700 }}>
                  ⚠ Difere do total da planilha em {brl(Math.abs(difTotal ?? 0))}. Confira itens faltando, valores ou linhas de desconto/BDI antes de confirmar.
                </span>
              )}
            </div>
            {codigosNumericos.size > 0 && (
              <div data-testid="eap-importar-aviso-numerico" role="alert" style={{ ...CARD, borderColor: GOLD, background: 'rgba(200,148,26,0.06)', display: 'grid', gap: 10 }}>
                <strong style={{ color: ESP, fontSize: 14 }}>Confira os códigos que vieram como número</strong>
                <span style={{ fontSize: 13, color: ESP, lineHeight: 1.5 }}>
                  {codigosNumericos.size} código(s) da EAP estavam gravados como <strong>número</strong> na planilha, não como texto.
                  Nesses casos o zero à direita pode ter se perdido (ex.: <strong>23,10</strong> vira <strong>23,1</strong>, que é um código diferente).
                  Confira na coluna <strong>Código</strong> (marcados com <span style={{ color: GOLD, fontWeight: 700 }}>nº</span>) e, se estiverem certos, confirme abaixo.
                </span>
                <button
                  type="button"
                  data-testid="eap-importar-ciente-numerico"
                  aria-pressed={cienteNumerico}
                  onClick={() => setCienteNumerico((v) => !v)}
                  style={{ justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 8, background: cienteNumerico ? ESP : '#fff', color: cienteNumerico ? BG : ESP, border: `1px solid ${cienteNumerico ? ESP : LINE}`, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  {cienteNumerico ? <CheckSquare aria-hidden="true" size={16} /> : <Square aria-hidden="true" size={16} />}
                  Conferi os códigos numéricos e estão corretos
                </button>
              </div>
            )}
            <div style={{ ...CARD, padding: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: BG, color: MUT, textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>Código</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }} title="Nível na EAP pela quantidade de pontos do código (1, 1.1, 1.1.1…), até 6">Nível</th>
                    <th style={{ padding: '8px 10px' }}>Descrição</th>
                    <th style={{ padding: '8px 10px' }}>Un</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Qtd</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Material</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Mão de obra</th>
                    <th style={{ padding: '8px 10px' }}>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {validadas.slice(0, 300).map((l) => (
                    <tr key={l.idx} style={{ borderTop: `1px solid ${LINE}`, background: l.status === 'erro' ? 'rgba(185,28,28,0.04)' : '#fff' }}>
                      <td style={{ padding: '7px 10px', fontFamily: 'ui-monospace, monospace' }}>
                        {l.eap_codigo || '—'}
                        {codigosNumericos.has(l.idx - 1) && <span title="Este código veio como número na planilha — confira o zero à direita" style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: GOLD, fontFamily: 'inherit' }}>nº</span>}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: MUT }} title={l.unidade ? 'Item (tem unidade)' : 'Agrupador (etapa/subetapa)'}>{nivelEap(l.eap_codigo) || '—'}</td>
                      <td style={{ padding: '7px 10px' }}>{l.descricao || '—'}</td>
                      <td style={{ padding: '7px 10px' }}>{l.unidade || '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{l.quantidade || '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{l.custo_material_unit ? brl(Number(l.custo_material_unit)) : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{l.custo_mao_obra_unit ? brl(Number(l.custo_mao_obra_unit)) : '—'}</td>
                      <td style={{ padding: '7px 10px', color: l.status === 'erro' ? VERM : VERDE }}>{l.status === 'erro' ? (l.motivos || []).join('; ') : 'OK'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validadas.length > 300 && <div style={{ padding: '8px 10px', fontSize: 12, color: MUT }}>Mostrando as primeiras 300 de {validadas.length} linhas. Todas serão processadas na importação.</div>}
            </div>
          </div>
        )}

        {!loading && passo === 'resultado' && resultado && (
          <div style={{ ...CARD, display: 'grid', gap: 12 }}>
            <strong style={{ color: ESP, fontSize: 16 }}>{resultado.ja_importado ? 'Este arquivo já tinha sido importado' : 'Importação concluída'}</strong>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: VERDE, fontWeight: 700 }}>CRIOU {resultado.importados} itens</span>
              {resultado.ignorados > 0 && <span style={{ fontSize: 14, color: MUT, fontWeight: 700 }}>{resultado.ignorados} ignorados</span>}
              {resultado.erros > 0 && <span style={{ fontSize: 14, color: VERM, fontWeight: 700 }}>{resultado.erros} com erro</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link href={`/dashboard/projetos/obras/${id}/orcamento`} style={{ background: ESP, color: BG, borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>Ver o orçamento por EAP</Link>
              <button type="button" data-testid="eap-importar-outro" onClick={recomecar} style={{ background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Importar outra planilha</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
