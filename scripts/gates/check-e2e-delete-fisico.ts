// Gate (PDCA GE 11/11, tarefas 0c3345df/26111304) — LIMPEZA DE e2e NÃO PODE USAR HARD `dbDelete` EM TABELA
// PROTEGIDA POR fn_bloqueia_delete_fisico (RD-30). Essas tabelas têm um BEFORE DELETE
// (trg_bloqueia_delete_fisico → fn_bloqueia_delete_fisico) que faz RAISE EXCEPTION em TODO delete físico,
// salvo com o GUC app.permitir_delete_fisico='on' — que o usuário-robô do e2e NÃO seta. Logo o `dbDelete`
// do afterAll SEMPRE lança e o `.catch(() => {})` engole: a limpeza nunca roda e as linhas de teste VAZAM
// na DEMO de produção (provado RD-38: 29 mil órfãos em erp_receber; a troca de curinga %→* do #4455 não
// resolveu porque a causa-raiz é a trava de DELETE, não o filtro).
//
// Regra: nenhum spec/suporte de e2e pode chamar `dbDelete('<tabela protegida>', ...)`. A limpeza nessas
// tabelas tem de ser por SOFT-DELETE — `dbPatch(tabela, filtro, { deleted_at: ... })` quando a tabela tem
// a coluna deleted_at (ex.: erp_receber/erp_pagar), ou uma RPC de limpeza de demo server-side que rode com
// app.permitir_delete_fisico='on' quando NÃO tem (ex.: erp_nfe_recebidas, ind_ponto_*). Assim o afterAll
// realmente tira as linhas do próprio RUN sem esbarrar na trava.
//
// A lista PROTEGIDAS reflete o catálogo do banco (pg_trigger × fn_bloqueia_delete_fisico) em 2026-11-12.
// Tabela nova protegida → acrescente aqui. DÉBITO: as ocorrências abaixo já existiam e ainda precisam de
// uma RPC de limpeza (NF-e é fiscal, ind_ponto_* é NR-36 — remediação coordenada). A lista só pode DIMINUIR:
// ao consertar um spec, remova a linha dele daqui. Spec NOVO com hard dbDelete em tabela protegida REPROVA.
// Só leitura estática de arquivos; sem rede, banco ou variável.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Tabelas com BEFORE DELETE trg_bloqueia_delete_fisico (fonte: catálogo do banco, 2026-11-12).
const PROTEGIDAS = [
  'compliance_funcionarios', 'erp_lancamentos', 'erp_movimentacoes', 'erp_nfe_recebidas',
  'erp_nfse_emitidas', 'erp_pagar', 'erp_pec_animal', 'erp_pec_avaliacao_pasto', 'erp_pec_movimentacao',
  'erp_receber', 'folha_competencia', 'folha_verba', 'ind_pessoa', 'ind_ponto_colaborador',
  'ind_ponto_dia', 'ind_ponto_horas', 'ind_ponto_marcacao',
]

// DÉBITO grandfather (só pode diminuir): <caminho e2e/...>::<tabela>. Precisam de RPC de limpeza
// server-side (tabela sem deleted_at). Conserte e REMOVA a linha.
const DEBITO = new Set<string>([
  'e2e/jornadas/aceitacao/gean-recebimento-nfe-tela-1692.spec.ts::erp_nfe_recebidas',
  'e2e/jornadas/aceitacao/nfe-entrada-vinculo-completa-cest-1755.spec.ts::erp_nfe_recebidas',
  'e2e/jornadas/aceitacao/nfe-entrada-criar-produto-fiscal-1755.spec.ts::erp_nfe_recebidas',
  'e2e/jornadas/aceitacao/xml-compra-lote.spec.ts::erp_nfe_recebidas',
  'e2e/jornadas/aceitacao/nr36-272-pausa-19min-desvio.spec.ts::ind_ponto_dia',
  'e2e/jornadas/aceitacao/nr36-273-supervisao-detalhe.spec.ts::ind_ponto_dia',
  'e2e/jornadas/aceitacao/produtividade-cadastro-editavel.spec.ts::ind_ponto_colaborador',
])

let falhas = 0
const re = new RegExp(`dbDelete\\(\\s*['"\`](${PROTEGIDAS.join('|')})['"\`]`, 'g')

function listarTs(dir: string): string[] {
  const out: string[] = []
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) out.push(...listarTs(p))
    else if (nome.endsWith('.ts')) out.push(p)
  }
  return out
}

const vistos = new Set<string>()
let varridos = 0
for (const f of listarTs('e2e')) {
  const rel = relative('.', f).split('\\').join('/')
  const src = readFileSync(f, 'utf8')
  varridos++
  let m: RegExpExecArray | null
  re.lastIndex = 0
  while ((m = re.exec(src)) !== null) {
    const chave = `${rel}::${m[1]}`
    vistos.add(chave)
    if (!DEBITO.has(chave)) {
      falhas++
      console.error(`✗ ${rel}: hard dbDelete em tabela protegida por fn_bloqueia_delete_fisico (RD-30): ${m[1]}.`)
      console.error(`   Use soft-delete: dbPatch('${m[1]}', filtro, { deleted_at: new Date().toISOString() }) — ou uma RPC de limpeza de demo (GUC app.permitir_delete_fisico='on') se a tabela não tiver deleted_at.`)
    }
  }
}

// DÉBITO que não aparece mais = consertado: avise para a lista encolher (não falha).
for (const d of DEBITO) if (!vistos.has(d)) console.log(`· débito já resolvido, remova de check-e2e-delete-fisico.ts: ${d}`)

console.log(`· varreu ${varridos} arquivo(s) .ts em e2e/ · ${DEBITO.size} débito(s) grandfather`)
if (falhas) {
  console.error(`\n${falhas} hard dbDelete novo em tabela protegida — a trava BEFORE DELETE faz vazar na DEMO. Troque por soft-delete.`)
  process.exit(1)
}
console.log('check-e2e-delete-fisico: ok')
