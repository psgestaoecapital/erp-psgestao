// Gate (CEO 07/10 · RD-71): as views do financeiro não podem listar título excluído (deleted_at) nem ignorar
// incluir_no_fluxo=false na projeção. Estático, sem rede: confere a migration 20261007200000.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sql = readFileSync('supabase/migrations/20261007200000_financeiro_views_filtram_excluidos.sql', 'utf8').replace(/--.*$/gm, '')
const bloco = (nome: string) => {
  const m = sql.match(new RegExp(`CREATE OR REPLACE (?:VIEW|FUNCTION) public\\.${nome}\\b[\\s\\S]*?(?=\\nCREATE OR REPLACE|$)`))
  return m ? m[0] : ''
}
for (const v of ['v_lancamentos_consolidado', 'v_contas_pagar_aging', 'v_contas_receber_aging', 'v_psgc_fluxo_projecao']) {
  const b = bloco(v)
  ok(/WITH \(security_invoker = true\)/.test(b), `${v} mantém security_invoker=true`)
  ok(/p\.deleted_at IS NULL/.test(b) || /r\.deleted_at IS NULL/.test(b), `${v} filtra deleted_at IS NULL`)
}
const lanc = bloco('v_lancamentos_consolidado')
ok(/p\.deleted_at IS NULL/.test(lanc) && /r\.deleted_at IS NULL/.test(lanc), 'v_lancamentos_consolidado filtra pagar E receber')
ok(/incluir_no_fluxo = false/.test(bloco('v_psgc_fluxo_projecao')), 'projeção respeita incluir_no_fluxo=false')
ok(/incluir_no_fluxo = false/.test(bloco('fn_fluxo_caixa_diario')), 'fluxo diário respeita incluir_no_fluxo=false')
ok(!/POLICY/i.test(sql), 'sem mexer em policies de RLS')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
