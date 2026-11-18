// Gate (chamado #6714 Oficina): lançar custo avulso (sem NF) numa OS, para o custo real do
// serviço ficar completo (hoje só vem das notas de entrada). Tabela aditiva com RLS por empresa,
// REVOKE anon, RPCs com guarda; UI com incluir/editar/excluir (RD-98) e "?" (RD-95). Estático, sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// Resolve a migration pelo SUFIXO (a fila de merge pode renumerar o prefixo de 14 dígitos).
const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((f) => f.endsWith('_os_custo_avulso_6714.sql')).sort().pop()
if (!arq) { console.error('✗ migration *_os_custo_avulso_6714.sql não encontrada'); process.exit(1) }
const sql = readFileSync(`${dir}/${arq}`, 'utf8')

ok(/CREATE TABLE IF NOT EXISTS public\.erp_os_custo_avulso/.test(sql), 'tabela aditiva erp_os_custo_avulso')
ok(/company_id\s+uuid NOT NULL REFERENCES public\.companies/.test(sql), 'company_id NOT NULL ligado a companies')
ok(/os_id\s+uuid NOT NULL REFERENCES public\.erp_os/.test(sql), 'os_id NOT NULL ligado a erp_os')
ok(/valor\s+numeric\(14,2\) NOT NULL CHECK \(valor >= 0\)/.test(sql), 'valor com CHECK >= 0')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql), 'RLS ligada')
ok(sql.includes('company_id IN (SELECT get_user_company_ids()) OR is_admin()'), 'policy por empresa (sem policy permissiva)')
ok(/REVOKE ALL ON TABLE public\.erp_os_custo_avulso FROM anon/.test(sql), 'REVOKE anon na tabela')

for (const fn of ['listar', 'adicionar', 'editar', 'excluir']) {
  ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.fn_os_custo_avulso_${fn}`).test(sql), `função fn_os_custo_avulso_${fn}`)
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.fn_os_custo_avulso_${fn}\\([^)]*\\) FROM anon`).test(sql), `REVOKE anon em ${fn}`)
  ok(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.fn_os_custo_avulso_${fn}\\([^)]*\\) TO authenticated, service_role`).test(sql), `GRANT só authenticated/service_role em ${fn}`)
}
// guarda de empresa nas RPCs que escrevem/leem
ok((sql.match(/IN \(SELECT get_user_company_ids\(\)\) OR is_admin\(\)/g) ?? []).length >= 5, 'guarda de tenant nas RPCs e na policy')
ok(sql.includes("INSERT INTO audit_log_global"), 'registra no audit_log_global')
// RD-95 · "?" seeds dos campos
for (const chave of ['descricao', 'valor', 'fornecedor', 'data', 'observacao']) {
  ok(sql.includes(`'oficina.os.custo_avulso.${chave}'`), `ajuda RD-95 do campo ${chave}`)
}

// UI
const ui = readFileSync('src/components/oficina/OSCustosAvulsos.tsx', 'utf8')
ok(ui.includes('fn_os_custo_avulso_listar'), 'componente lê a lista')
ok(ui.includes('fn_os_custo_avulso_adicionar'), 'componente inclui (RD-98)')
ok(ui.includes('fn_os_custo_avulso_editar'), 'componente edita (RD-98)')
ok(ui.includes('fn_os_custo_avulso_excluir'), 'componente exclui (RD-98)')
ok((ui.match(/chave="oficina\.os\.custo_avulso\./g) ?? []).length >= 5, 'todo campo com "?" (RD-95)')

const card = readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8')
ok(card.includes('OSCustosAvulsos'), 'a seção está montada na ficha da OS')

if (falhas) process.exit(1)
console.log('check-os-custo-avulso-6714 OK')
