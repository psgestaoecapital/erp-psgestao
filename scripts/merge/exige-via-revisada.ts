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

function nomeDe(a: Arq): string { return typeof a === 'string' ? a : a.nome }
function conteudoDe(a: Arq): string | undefined { return typeof a === 'string' ? undefined : a.conteudo }

// Uma migration/.sql é CRÍTICA só quando MUTA objeto/dado que JÁ EXISTE. Criar coisa nova — mesmo com DROP ... IF EXISTS
// idempotente, REVOKE FROM anon, ou FK para uma tabela crítica — é aditivo e publica DIRETO.
// tabelas de dado de cliente/financeiro/fiscal: mexer no dado delas (mesmo dentro de um RPC) é sempre crítico.
// Inclui contrato/pedido/comissão/cobrança do cliente (compromisso financeiro) — gap do incidente 21/10: #2613
// (INSERT erp_contratos + agency_comissao) e #2896 (UPDATE erp_pedidos num RPC) passaram como "aditivos" sem isto.
const TABELA_CRITICA = /^(erp_clientes|cliente_unificacao|titulo|titulos|parcela|conta_bancaria|conciliac|boleto|nfe|nfse|nota_fiscal|imposto|repasse|cartao|salario|folha_pag|erp_contrato|erp_pedido|agency_comissao|agency_contrato|cobranca|fatura)/

export function migracaoCritica(nome: string, sql?: string): string | null {
  if (sql === undefined) return `migration sem conteúdo para avaliar (${nome}) — na dúvida, espera verde`
  const limpo = sql.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/'[^']*'/g, "''")
  // o corpo de função ($$…$$) é a LÓGICA do RPC, não uma mutação em tempo de migration — tira do check de DML de migration
  const topo = limpo.replace(/\$([a-z0-9_]*)\$[\s\S]*?\$\1\$/g, ' corpo_de_funcao ')
  const criadas = new Set<string>()
  for (const m of topo.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) criadas.add(m[1])
  const novo = (t?: string) => !!t && criadas.has(t)

  // 1) mexer em DADO de tabela crítica (cliente/financeiro/fiscal) — vale até dentro de função (é o que o RPC faz)
  for (const m of limpo.matchAll(/(?:insert\s+into|update|delete\s+from)\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    if (TABELA_CRITICA.test(m[1])) return `migration/RPC mexe em dado crítico (${m[1]} · ${nome})`
  }
  // 2) DDL/DML em tempo de migration sobre objeto que JÁ EXISTE (fora de corpo de função)
  if (/\btruncate\b/.test(topo)) return `migration com TRUNCATE (${nome})`
  for (const m of topo.matchAll(/drop\s+(table|view|function|column|type|schema|trigger|constraint|index)\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    if (!/if\s+exists/.test(m[0]) && !novo(m[2])) return `migration com DROP de ${m[1]} existente (${m[2]} · ${nome})`
  }
  for (const m of topo.matchAll(/(?:update|delete\s+from)\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    if (!novo(m[1])) return `migration com UPDATE/DELETE em dado existente (${m[1]} · ${nome})`
  }
  for (const m of topo.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    if (!novo(m[1])) return `migration com ALTER em tabela existente (${m[1]} · ${nome})`
  }
  for (const m of topo.matchAll(/(?:create|alter|drop)\s+policy[^;]*?\son\s+(?:public\.)?"?([a-z0-9_]+)"?/g)) {
    if (!novo(m[1])) return `migration mexe em RLS de tabela existente (${m[1]} · ${nome})`
  }
  for (const m of topo.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?[^;]*row\s+level\s+security/g)) {
    if (!novo(m[1])) return `migration liga/desliga RLS em tabela existente (${m[1]} · ${nome})`
  }
  if (/create\s+or\s+replace\s+view\b/.test(topo)) return `migration com CREATE OR REPLACE VIEW (muda leitura existente · ${nome})`
  return null // cria coisa nova / RPC em tabela não-crítica / INSERT em catálogo / FK p/ tabela crítica → DIRETO
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
