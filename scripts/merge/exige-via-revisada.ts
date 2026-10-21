#!/usr/bin/env tsx
// Modelo CEO 21/10 ("Perfeito"): PRODUTO NOVO / aditivo publica DIRETO (Mundo 1); só o NÚCLEO CRÍTICO espera o verde
// (Mundo 2). O gate decide pelo CONTEÚDO da PR, não pelo rótulo do módulo — uma mudança crítica escondida num produto
// novo ainda é crítica. Viés de SEGURANÇA: na dúvida (migration sem conteúdo p/ avaliar), espera verde.
//
// CRÍTICO (espera verde), onde quer que apareça:
//   1. Fiscal (NF-e/NFS-e/imposto/SPED)  2. Financeiro de cliente (boleto, conciliação, título, parcela, repasse, cartão)
//   3. RLS/permissões/isolamento entre empresas (LGPD)  4. Migration NÃO-aditiva (ALTER/DROP/UPDATE/DELETE em objeto
//   existente, mexer em RLS de tabela existente)  5. LGPD/dados pessoais/salários · NR-36 · Wealth/CVM · cálculo financeiro
// DIRETO (Mundo 1): tela nova, RPC/função nova, tabela/índice novos, INSERT em catálogo (menu/ajuda), teste, gate, docs.
//
// Entrada: nomes de arquivo, opcionalmente com o conteúdo da migration ({nome, conteudo}) — o conteúdo vem do `patch`
// do GitHub (arquivo ADICIONADO = patch é o conteúdo inteiro). Decisão PURA, testada por check-etiqueta-automatica.ts.
import { QUARENTENA_CRITICOS } from '../../e2e/quarentena'

export const ETIQUETA_REVISADA = 'revisao-eng-chefe'
export type ViaRevisada = { revisada: boolean; motivo: string }
export type Arq = string | { nome: string; conteudo?: string }

const SO_DOC_TESTE_CI = /^(docs\/|\.github\/|e2e\/|.*\.md$)/
const CALCULO = /^src\/(lib|libs|server|utils)\/.*(calc|motor|imposto|tribut|rateio|markup|folha|dre|fiscal|financ)/
// tabelas de dado de cliente / financeiro / fiscal cujo toque por migration é sempre crítico
const TABELAS_CRITICAS = /\b(erp_clientes|cliente_unificacao|companies|user_companies|tenant_subscriptions|titulo|parcela|conta_bancaria|conciliac|boleto|nfe|nfse|nota_fiscal|imposto|repasse|cartao|folha|salario|wealth|cvm)\w*/

function nomeDe(a: Arq): string { return typeof a === 'string' ? a : a.nome }
function conteudoDe(a: Arq): string | undefined { return typeof a === 'string' ? undefined : a.conteudo }

// Uma migration/.sql é CRÍTICA se mexe em objeto/dado que JÁ EXISTE, ou toca área crítica. Criar coisa nova é DIRETO.
export function migracaoCritica(nome: string, sql?: string): string | null {
  if (sql === undefined) return `migration sem conteúdo para avaliar (${nome}) — na dúvida, espera verde`
  // só o CÓDIGO (sem comentários nem literais de string), p/ não casar termo crítico em texto de ajuda inocente
  const s = sql.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/'[^']*'/g, "''")
  if (TABELAS_CRITICAS.test(s)) return `migration toca tabela de cliente/financeiro/fiscal (${nome})`
  // sinais IRREVERSÍVEIS / mutantes em dado existente
  if (/\bdrop\s+(table|column|function|view|policy|schema|index|type|trigger|constraint)\b/.test(s)) return `migration com DROP (${nome})`
  if (/\btruncate\b/.test(s)) return `migration com TRUNCATE (${nome})`
  if (/\bdelete\s+from\b/.test(s)) return `migration com DELETE em dado existente (${nome})`
  if (/\bupdate\s+(?:only\s+)?(?:public\.)?["a-z0-9_]+\s+set\b/.test(s)) return `migration com UPDATE em dado existente (${nome})`
  if (/\brevoke\b/.test(s)) return `migration com REVOKE (${nome})`
  // tabelas criadas NESTA migration (ALTER/RLS nelas é parte do "criar novo" = ok)
  const criadas = new Set<string>()
  for (const m of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) criadas.add(m[1])
  for (const m of s.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    if (!criadas.has(m[1])) return `migration com ALTER em tabela existente (${m[1]} · ${nome})`
  }
  for (const m of s.matchAll(/(?:create|alter)\s+policy[^;]*?\son\s+(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    if (!criadas.has(m[1])) return `migration mexe em RLS de tabela existente (${m[1]} · ${nome})`
  }
  for (const m of s.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?[^;]*row\s+level\s+security/g)) {
    if (!criadas.has(m[1])) return `migration liga/desliga RLS em tabela existente (${m[1]} · ${nome})`
  }
  if (/create\s+or\s+replace\s+view\b/.test(s)) return `migration com CREATE OR REPLACE VIEW (muda leitura existente · ${nome})`
  return null // só cria coisa nova / INSERT em catálogo / GRANT em objeto novo → DIRETO
}

export function exigeViaRevisada(arquivos: Arq[]): ViaRevisada {
  for (const a of arquivos) {
    const nome = nomeDe(a); const f = nome.toLowerCase()
    if (SO_DOC_TESTE_CI.test(f)) continue
    if (QUARENTENA_CRITICOS.some((c) => f.includes(c))) return { revisada: true, motivo: `área crítica (${nome})` }
    if (CALCULO.test(f)) return { revisada: true, motivo: `cálculo financeiro (${nome})` }
    if (f.startsWith('supabase/migrations/') || f.endsWith('.sql')) {
      const m = migracaoCritica(nome, conteudoDe(a))
      if (m) return { revisada: true, motivo: m }
      continue // migration aditiva / cria coisa nova → DIRETO
    }
    // tela (.tsx/.css), RPC/função nova de front, componente → PRODUTO NOVO, publica DIRETO
  }
  return { revisada: false, motivo: 'aditivo/isolado (produto novo) — publica direto (Mundo 1)' }
}

async function main(): Promise<void> {
  // stdin: uma linha por arquivo "nome<TAB>conteudo-base64" (conteúdo opcional, só p/ migration/.sql)
  let txt = ''
  for await (const c of process.stdin) txt += c
  const arquivos: Arq[] = txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf('\t')
    if (i < 0) return l
    const nome = l.slice(0, i); const b64 = l.slice(i + 1)
    try { return { nome, conteudo: Buffer.from(b64, 'base64').toString('utf8') } } catch { return nome }
  })
  process.stdout.write(JSON.stringify(exigeViaRevisada(arquivos)))
}
if (process.argv[1] && /\/exige-via-revisada\.ts$/.test(process.argv[1])) void main()
