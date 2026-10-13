// PM-J · Importador de jobs do SIGA (CEO 02/10 — a Pdois vai mandar a exportação). Regras puras, testadas no build
// (scripts/gates/check-pm-importar-siga.ts). A planilha do SIGA ainda não chegou: o importador reconhece os nomes de
// coluna mais comuns e deixa a pessoa conferir/ajustar o mapa antes da prévia.
//
// Regra do CEO: entram os jobs dos últimos 60 dias + os em aberto; os "em aprovação" antigos (parados há mais de 60
// dias) ficam de fora. Nada é gravado sem a prévia — e o banco confere de novo (cliente, responsável, número repetido).

export type CampoSiga = 'numero' | 'titulo' | 'cliente' | 'responsavel' | 'situacao' | 'prazo' | 'criacao' | 'peca' | 'briefing'
export const CAMPOS: { id: CampoSiga; rotulo: string; obrigatorio?: boolean }[] = [
  { id: 'numero', rotulo: 'Número do job', obrigatorio: true },
  { id: 'titulo', rotulo: 'Título', obrigatorio: true },
  { id: 'cliente', rotulo: 'Cliente' },
  { id: 'responsavel', rotulo: 'Responsável' },
  { id: 'situacao', rotulo: 'Situação' },
  { id: 'prazo', rotulo: 'Prazo' },
  { id: 'criacao', rotulo: 'Data de criação' },
  { id: 'peca', rotulo: 'Peça / tipo' },
  { id: 'briefing', rotulo: 'Briefing / descrição' },
]

const SINONIMOS: Record<CampoSiga, string[]> = {
  numero: ['job', 'n job', 'no job', 'numero', 'numero do job', 'num job', 'codigo', 'cod job', 'id job', 'n'],
  titulo: ['titulo', 'titulo do job', 'nome do job', 'nome', 'assunto', 'descricao resumida'],
  cliente: ['cliente', 'nome do cliente', 'razao social', 'empresa', 'anunciante'],
  responsavel: ['responsavel', 'executor', 'atribuido a', 'usuario', 'designado', 'criativo'],
  situacao: ['situacao', 'status', 'etapa', 'fase', 'andamento'],
  prazo: ['prazo', 'data prazo', 'data de entrega', 'entrega', 'vencimento', 'deadline'],
  criacao: ['data', 'data de criacao', 'criado em', 'abertura', 'data de abertura', 'data cadastro', 'cadastro'],
  peca: ['peca', 'tipo', 'tipo de peca', 'servico', 'tipo de servico', 'formato'],
  briefing: ['briefing', 'descricao', 'observacao', 'observacoes', 'detalhes'],
}
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Adivinha o mapa campo → coluna pelo cabeçalho (igual > começa com > contém); cada coluna serve a um campo só.
export function adivinharMapa(cabecalho: string[]): Partial<Record<CampoSiga, number>> {
  const norm = cabecalho.map((h) => normalizar(String(h ?? '')))
  const usado = new Set<number>()
  const mapa: Partial<Record<CampoSiga, number>> = {}
  for (const nivel of [0, 1, 2]) {
    for (const c of CAMPOS) {
      if (mapa[c.id] != null) continue
      const i = norm.findIndex((h, idx) => !usado.has(idx) && h !== '' && SINONIMOS[c.id].some((s) =>
        nivel === 0 ? h === s : nivel === 1 ? h.startsWith(`${s} `) : (s.length > 3 && h.includes(s))))
      if (i >= 0) { mapa[c.id] = i; usado.add(i) }
    }
  }
  return mapa
}

// Situação do SIGA → situação da Pauta. Desconhecida → "em produção" (a pessoa vê na prévia).
export type Situacao = 'nao_iniciada' | 'em_producao' | 'aguardando' | 'em_aprovacao' | 'concluida' | 'publicado' | 'cancelado'
export function situacaoSiga(texto: string | null | undefined): Situacao {
  const t = normalizar(String(texto ?? ''))
  if (!t) return 'nao_iniciada'
  if (/cancel/.test(t)) return 'cancelado'
  if (/public|veicul|no ar/.test(t)) return 'publicado'
  if (/conclu|finaliz|entregue|encerr|fechad/.test(t)) return 'concluida'
  if (/aprova/.test(t)) return 'em_aprovacao'
  if (/aguard|pendent|parad|espera/.test(t)) return 'aguardando'
  if (/nao inici|novo|aberto|a fazer|fila|backlog/.test(t)) return 'nao_iniciada'
  return 'em_producao'
}
export const emAberto = (s: Situacao) => !['concluida', 'publicado', 'cancelado'].includes(s)

// Data em dd/mm/aaaa, aaaa-mm-dd, dd/mm/aa ou número de série do Excel → aaaa-mm-dd.
export function dataSiga(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10)
  const t = String(v).trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/)
  if (m) { const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  return null
}

// "113223B" → número 113223, rodada 2 (letra = rodada de ajuste).
export function numeroSiga(v: unknown): { numero: string; rodada: number } | null {
  const t = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '')
  const m = t.match(/^(\d{1,12})([A-Z])?$/)
  if (!m) return null
  return { numero: m[1], rodada: m[2] ? m[2].charCodeAt(0) - 64 : 0 }
}

export type LinhaSiga = {
  linha: number; numero: string; rodada: number; titulo: string; cliente: string | null; responsavel: string | null
  situacao: Situacao; situacao_original: string | null; prazo: string | null; criacao: string | null; peca: string | null; briefing: string | null
}
export type Motivo = 'sem_numero' | 'sem_titulo' | 'fora_da_janela' | 'em_aprovacao_antigo' | 'cancelado' | 'repetido_na_planilha'
export type Resultado = { entra: LinhaSiga[]; fora: { linha: number; numero: string | null; motivo: Motivo }[] }

// Aplica a regra do CEO: últimos 60 dias (pela criação; sem criação, pelo prazo) + todos os em aberto; "em aprovação"
// parado há mais de 60 dias fica de fora; cancelado fica de fora; número repetido na planilha entra uma vez.
export function selecionar(linhas: unknown[][], mapa: Partial<Record<CampoSiga, number>>, hojeIso: string, janelaDias = 60): Resultado {
  const corte = new Date(`${hojeIso}T12:00:00Z`); corte.setUTCDate(corte.getUTCDate() - janelaDias)
  const corteIso = corte.toISOString().slice(0, 10)
  const col = (r: unknown[], c: CampoSiga) => (mapa[c] == null ? null : r[mapa[c] as number])
  const txt = (v: unknown) => { const s = String(v ?? '').trim(); return s || null }
  const entra: LinhaSiga[] = []; const fora: Resultado['fora'] = []; const vistos = new Set<string>()
  linhas.forEach((r, i) => {
    const linha = i + 2 // linha 1 é o cabeçalho
    const num = numeroSiga(col(r, 'numero'))
    if (!num) { if (r.some((x) => String(x ?? '').trim())) fora.push({ linha, numero: null, motivo: 'sem_numero' }); return }
    const titulo = txt(col(r, 'titulo'))
    if (!titulo) { fora.push({ linha, numero: num.numero, motivo: 'sem_titulo' }); return }
    const situacao_original = txt(col(r, 'situacao'))
    const situacao = situacaoSiga(situacao_original)
    const criacao = dataSiga(col(r, 'criacao')); const prazo = dataSiga(col(r, 'prazo'))
    const ref = criacao ?? prazo
    const recente = !!ref && ref >= corteIso
    if (situacao === 'cancelado') { fora.push({ linha, numero: num.numero, motivo: 'cancelado' }); return }
    if (situacao === 'em_aprovacao' && !recente) { fora.push({ linha, numero: num.numero, motivo: 'em_aprovacao_antigo' }); return }
    if (!recente && !emAberto(situacao)) { fora.push({ linha, numero: num.numero, motivo: 'fora_da_janela' }); return }
    if (vistos.has(num.numero)) { fora.push({ linha, numero: num.numero, motivo: 'repetido_na_planilha' }); return }
    vistos.add(num.numero)
    entra.push({ linha, numero: num.numero, rodada: num.rodada, titulo: titulo.replace(/\s+/g, ' ').slice(0, 300), cliente: txt(col(r, 'cliente')),
      responsavel: txt(col(r, 'responsavel')), situacao, situacao_original, prazo, criacao, peca: txt(col(r, 'peca')), briefing: txt(col(r, 'briefing')) })
  })
  return { entra, fora }
}

export const MOTIVO_TEXTO: Record<Motivo, string> = {
  sem_numero: 'sem número de job', sem_titulo: 'sem título', fora_da_janela: 'concluído há mais de 60 dias',
  em_aprovacao_antigo: '"em aprovação" parado há mais de 60 dias', cancelado: 'cancelado', repetido_na_planilha: 'número repetido na planilha',
}

// CSV do SIGA (veredito em produção 02/10): ler os bytes do .csv direto na planilha trocava os acentos ("NÂº Job",
// "TÃ­tulo") e o mapa não reconhecia as colunas; e a leitura de datas da biblioteca é americana (05/10 virava 10 de maio).
// Por isso o CSV vira TEXTO antes: UTF-8 (sem o BOM) e, se não for UTF-8 válido, Windows-1252 (exportação do Excel
// brasileiro). As datas ficam como texto e quem lê é dataSiga (dd/mm/aaaa).
export function textoCsv(bytes: Uint8Array): string {
  let t: string
  try { t = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { t = new TextDecoder('windows-1252').decode(bytes) }
  return t.replace(/^﻿/, '')
}
export const ehCsv = (nome: string, tipo = '') => /\.csv$/i.test(nome) || /csv/i.test(tipo)
