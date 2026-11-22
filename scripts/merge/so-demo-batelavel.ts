#!/usr/bin/env tsx
// SO-DEMO (CEO 21/11 20:18): migration que SÓ mexe em empresa DEMO (is_demo=true / ids b0700000-…) não deve publicar
// SOZINHA (1 por @pos) só por cair no carve-out do critica-solo. Hoje ela sai sozinha, uma por @pos (~45 min cada), e
// trava a fila (ex.: #5747 limpeza da DEMO GE e #5779 bot P&M esperando atrás de críticas reais).
//
// Quem coloca a label `so-demo`: o gilberto-revisor, SÓ depois de PROVAR na revisão profunda que toda escrita da
// migration é guardada por companies.is_demo = true (ou pelos ids b0700000-…) e não toca dado de empresa real nem
// estrutura (DDL de tabela de domínio). O comentário MERGE AUTORIZADO passa a dizer "SÓ-DEMO comprovado".
//
// Este classificador é o BACKSTOP de SEGURANÇA da fila (viés p/ SOLO — qualquer dúvida → SOLO): mesmo com a label, a
// crítica MANTÉM SOLO quando o CONTEÚDO toca risco máximo que is_demo NÃO cobre. is_demo guarda LINHAS de dado da demo;
// NÃO guarda schema (DDL vale p/ todas as empresas) nem a correção fiscal/RLS/CVM (valem para o mundo real, não só p/ a
// linha demo).
//
// MANTÉM SOLO (ignora a label `so-demo`):
//   1. Risco máximo por TOKEN no caminho ou no conteúdo: fiscal (NF-e/NFS-e/imposto/tributo/SPED) · NR-36 ·
//      RLS/permissão/policy/guarda/RBAC/LGPD/dado pessoal/salário · Wealth/CVM.
//   2. DDL de ESTRUTURA sobre objeto que JÁ EXISTE (ALTER/DROP/TRUNCATE de tabela/coluna; mexer em RLS/policy; CREATE OR
//      REPLACE VIEW) — muda o schema de TODAS as empresas, não só da demo. Unit: "so-demo + DDL em tabela de domínio → SOLO".
//   3. Migration ilegível / sem conteúdo p/ avaliar → SOLO (viés de segurança, igual ao exige-via-revisada/critica-solo).
// BATELÁVEL (entra no lote de até LOTE_MIG_CRIT_MAX): a criticidade vem APENAS de DML de dado (INSERT/UPDATE/DELETE) em
// tabela NÃO-fiscal, sem DDL de estrutura — exatamente o que o guard is_demo do revisor cobre.
//
// `conserto-main` NUNCA é so-demo: é tratado pela ETIQUETA na fila (n_critica_solo=1) antes de chegar aqui.
// Entrada: uma linha por arquivo "nome<TAB>conteudo-base64" (conteúdo opcional, só p/ migration/.sql), como os outros
// classificadores. Decisão PURA, testada por check-fila-lote-critico.ts.
import { QUARENTENA_CRITICOS } from '../../e2e/quarentena'
import type { Arq } from './exige-via-revisada'

export type Elegivel = { batelavel: boolean; motivo: string }

const nomeDe = (a: Arq): string => (typeof a === 'string' ? a : a.nome)
const conteudoDe = (a: Arq): string | undefined => (typeof a === 'string' ? undefined : a.conteudo)

// Risco MÁXIMO que is_demo NÃO cobre. Reusa a lista única QUARENTENA_CRITICOS (financeiro, fiscal, nfe/nfse/nf-e,
// imposto, tribut, permiss, rls, guarda, rbac, acesso, nr-36, lgpd, wealth, cvm) e acrescenta os termos fiscais/pessoais
// de risco máximo. NÃO inclui os tokens de DADO financeiro de cliente (titulo/boleto/parcela/…): DML de dado financeiro
// na DEMO é dado FABRICADO, guardável por is_demo — batela. Só a CORREÇÃO FISCAL/RLS/CVM é que is_demo não cobre.
const RISCO_MAX = [...QUARENTENA_CRITICOS, 'sped', 'policy', 'salario', 'salári', 'folha_pag', 'dados_pessoais'] as const
const temRiscoMax = (s: string): string | null => {
  const b = s.toLowerCase()
  for (const t of RISCO_MAX) if (b.includes(t)) return t
  return null
}

const SO_DOC_TESTE_CI = /^(docs\/|\.github\/|e2e\/|.*\.md$)/

// DDL de ESTRUTURA sobre objeto que JÁ EXISTE (is_demo não cobre: muda o schema de TODAS as empresas). Mesma técnica do
// migracaoCritica (tira o corpo de função $$…$$, rastreia as tabelas criadas na PRÓPRIA migration = novas, aditivas).
// Independente do DML: pega o ALTER mesmo quando há também um INSERT/UPDATE de dado (que sozinho seria demo-guardável).
export function ddlEstrutural(sql: string): string | null {
  const limpo = sql.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/'[^']*'/g, "''")
  const topo = limpo.replace(/\$([a-z0-9_]*)\$[\s\S]*?\$\1\$/g, ' corpo_de_funcao ')
  const criadas = new Set<string>()
  for (const m of topo.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g)) criadas.add(m[1])
  const novo = (t?: string): boolean => !!t && criadas.has(t)
  if (/\btruncate\b/.test(topo)) return 'TRUNCATE'
  for (const m of topo.matchAll(/drop\s+(table|view|function|column|type|schema|trigger|constraint|index)\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g))
    if (!/if\s+exists/.test(m[0]) && !novo(m[2])) return `DROP de ${m[1]} existente (${m[2]})`
  for (const m of topo.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/g))
    if (!novo(m[1])) return `ALTER em tabela existente (${m[1]})`
  for (const m of topo.matchAll(/(?:create|alter|drop)\s+policy[^;]*?\son\s+(?:public\.)?"?([a-z0-9_]+)"?/g))
    if (!novo(m[1])) return `mexe em RLS/policy de tabela existente (${m[1]})`
  for (const m of topo.matchAll(/alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?[^;]*row\s+level\s+security/g))
    if (!novo(m[1])) return `liga/desliga RLS em tabela existente (${m[1]})`
  if (/create\s+or\s+replace\s+view\b/.test(topo)) return 'CREATE OR REPLACE VIEW (muda leitura existente)'
  return null
}

export function soDemoBatelavel(arquivos: Arq[]): Elegivel {
  for (const a of arquivos) {
    const nome = nomeDe(a)
    const f = nome.toLowerCase()
    if (SO_DOC_TESTE_CI.test(f)) continue
    // 1) risco máximo pelo CAMINHO (tela/arquivo fiscal, nr-36, permissão…): is_demo não cobre → SOLO
    const tCaminho = temRiscoMax(f)
    if (tCaminho) return { batelavel: false, motivo: `risco máximo pelo caminho (${tCaminho} · ${nome}) — is_demo não cobre, mantém SOLO` }
    // 2) migration/.sql: olha o CONTEÚDO
    if (f.startsWith('supabase/migrations/') || f.endsWith('.sql')) {
      const sql = conteudoDe(a)
      if (sql === undefined) return { batelavel: false, motivo: `migration sem conteúdo p/ avaliar (${nome}) — na dúvida, SOLO` }
      const tConteudo = temRiscoMax(sql)
      if (tConteudo) return { batelavel: false, motivo: `risco máximo no conteúdo (${tConteudo} · ${nome}) — is_demo não cobre, mantém SOLO` }
      const ddl = ddlEstrutural(sql)
      if (ddl) return { batelavel: false, motivo: `DDL de estrutura em objeto existente — ${ddl} (${nome}) — is_demo não cobre, mantém SOLO` }
    }
  }
  return { batelavel: true, motivo: 'só-demo comprovado: DML de dado em tabela não-fiscal, sem DDL de estrutura — crítica BATELÁVEL no lote (não SOLO)' }
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
  process.stdout.write(JSON.stringify(soDemoBatelavel(arquivos)))
}
if (process.argv[1] && /\/so-demo-batelavel\.ts$/.test(process.argv[1])) void main()
