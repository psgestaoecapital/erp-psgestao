#!/usr/bin/env tsx
// LOTE DE MIGRATIONS CRÍTICAS (CEO 01/11): a fila passou a publicar até LOTE_MIG_CRIT_MAX (5) migrations CRÍTICAS num
// mesmo @pos-migration, para drenar o backlog (fila crítica em 44, vazão de 2-3/h). MAS algumas categorias críticas são
// perigosas demais para batelar: elas continuam publicando SOZINHAS (1 por @pos), como antes do lote. Este classificador,
// PURO e testado, separa a migration crítica SOLO (fora do lote) da BATELÁVEL (entra no lote).
//
// SOLO (publica sozinha, 1 por @pos), onde quer que apareça — no CAMINHO do arquivo ou no CONTEÚDO da migration:
//   1. NR-36            2. Fiscal (NF-e/NFS-e/imposto/tributo/SPED)
//   3. Financeiro de cliente (boleto, conciliação, título, parcela, repasse, cartão, cobrança, fatura, PIX, CNAB,
//      contrato/pedido/comissão do cliente, conta bancária)
//   4. RLS/permissão/LGPD (mexer em RLS/policy/permissão de objeto EXISTENTE; dado pessoal; salário; Wealth/CVM)
// `conserto-main` também é SOLO, mas é tratado pela ETIQUETA na fila (não depende do conteúdo) — não entra aqui.
//
// BATELÁVEL (entra no lote de até 5): o resto do crítico — DROP/CREATE de função, CREATE OR REPLACE VIEW não-financeira,
// ALTER em tabela estrutural não-perigosa. Ex.: a #3599 (DROP+CREATE de fn_auditor_matriz_disparar) é batelável.
//
// Viés de SEGURANÇA (igual ao exige-via-revisada): migration sem conteúdo para avaliar → SOLO. Qualquer dúvida → SOLO.
// Entrada: uma linha por arquivo "nome<TAB>conteudo-base64" (conteúdo opcional, só p/ migration/.sql), como o
// exige-via-revisada.ts. Decisão PURA, testada por check-fila-lote-critico.ts.
import { QUARENTENA_CRITICOS } from '../../e2e/quarentena'
import { migracaoCritica, type Arq } from './exige-via-revisada'

export type Solo = { solo: boolean; motivo: string }

const nomeDe = (a: Arq): string => (typeof a === 'string' ? a : a.nome)
const conteudoDe = (a: Arq): string | undefined => (typeof a === 'string' ? undefined : a.conteudo)

// Categorias perigosas por TOKEN no caminho ou no conteúdo. Reusa a lista única QUARENTENA_CRITICOS (fiscal, financeiro,
// nfe, permiss, rls, rbac, nr-36, lgpd, wealth, cvm…) e acrescenta os termos financeiros/pessoais de dado de cliente.
const SOLO_TOKENS = [
  ...QUARENTENA_CRITICOS,
  'boleto', 'concilia', 'titulo', 'parcela', 'repasse', 'cartao', 'cartão', 'cobranca', 'cobrança', 'fatura',
  'cnab', 'sped', 'salario', 'salári', 'folha_pag', 'dados_pessoais', 'conta_bancaria',
  'erp_contrato', 'erp_pedido', 'agency_comiss',
]
const temToken = (s: string): string | null => {
  const b = s.toLowerCase()
  for (const t of SOLO_TOKENS) if (b.includes(t)) return t
  return null
}
// PIX como palavra isolada (evita casar "fixpix" improváveis, mas sobretudo não casar dentro de outra palavra qualquer)
const PIX = /\bpix\b/i

const SO_DOC_TESTE_CI = /^(docs\/|\.github\/|e2e\/|.*\.md$)/

export function criticaSolo(arquivos: Arq[]): Solo {
  for (const a of arquivos) {
    const nome = nomeDe(a)
    const f = nome.toLowerCase()
    if (SO_DOC_TESTE_CI.test(f)) continue
    // 1) categoria perigosa pelo CAMINHO do arquivo (vale p/ .tsx, .sql, qualquer um)
    const tCaminho = temToken(f)
    if (tCaminho) return { solo: true, motivo: `categoria SOLO pelo caminho (${tCaminho} · ${nome})` }
    if (PIX.test(f)) return { solo: true, motivo: `categoria SOLO pelo caminho (pix · ${nome})` }
    // 2) migration/.sql: olha o CONTEÚDO
    if (f.startsWith('supabase/migrations/') || f.endsWith('.sql')) {
      const sql = conteudoDe(a)
      if (sql === undefined) return { solo: true, motivo: `migration sem conteúdo p/ avaliar (${nome}) — na dúvida, SOLO` }
      const tConteudo = temToken(sql)
      if (tConteudo) return { solo: true, motivo: `categoria SOLO no conteúdo da migration (${tConteudo} · ${nome})` }
      if (PIX.test(sql)) return { solo: true, motivo: `categoria SOLO no conteúdo da migration (pix · ${nome})` }
      // RLS/permissão/dado crítico sobre objeto EXISTENTE: reusa o classificador testado (migracaoCritica). RLS de
      // tabela NOVA é aditivo e NÃO cai aqui (migracaoCritica só flagra o que muta objeto existente).
      const m = migracaoCritica(nome, sql)
      if (m && /(rls|row level|policy|permiss|dado crítico)/i.test(m)) return { solo: true, motivo: `RLS/permissão/dado crítico — ${m}` }
    }
  }
  return { solo: false, motivo: 'crítica batelável (função/view/estrutura não-perigosa) — entra no lote de até LOTE_MIG_CRIT_MAX' }
}

async function main(): Promise<void> {
  let txt = ''
  for await (const c of process.stdin) txt += c
  const arquivos: Arq[] = txt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('\t')
      if (i < 0) return l
      const nome = l.slice(0, i)
      const b64 = l.slice(i + 1)
      try {
        return { nome, conteudo: Buffer.from(b64, 'base64').toString('utf8') }
      } catch {
        return nome
      }
    })
  process.stdout.write(JSON.stringify(criticaSolo(arquivos)))
}
if (process.argv[1] && /\/critica-solo\.ts$/.test(process.argv[1])) void main()
