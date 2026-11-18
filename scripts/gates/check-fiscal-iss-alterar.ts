// Gate (chamado #9427 FC Pisos): a tela "ISS por município" só permitia cadastrar; agora permite
// EDITAR um cadastro existente (alíquota, retenção, vigência, fonte, quem informou, observação),
// guardando quem alterou, quando e o valor anterior. Estático, sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// Resolve a migration pelo SUFIXO (a fila de merge pode renumerar o prefixo de 14 dígitos).
const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((f) => f.endsWith('_fiscal_iss_alterar.sql')).sort().pop()
if (!arq) { console.error('✗ migration *_fiscal_iss_alterar.sql não encontrada'); process.exit(1) }
const sql = readFileSync(`${dir}/${arq}`, 'utf8')
ok(sql.includes('CREATE OR REPLACE FUNCTION public.fn_fiscal_iss_alterar'), 'existe a função de alteração')
ok(/ADD COLUMN IF NOT EXISTS valor_anterior jsonb/.test(sql), 'coluna de histórico valor_anterior (aditiva)')
ok(/ADD COLUMN IF NOT EXISTS editado_por\s+uuid/.test(sql), 'coluna editado_por (quem alterou)')
ok(sql.includes('editado_por     = auth.uid()') || sql.includes('editado_por=auth.uid()'), 'grava quem editou')
ok(sql.includes('valor_anterior  = v_ant') || sql.includes('valor_anterior=v_ant'), 'grava o valor anterior')
ok(sql.includes("r.company_id IN (SELECT get_user_company_ids()) OR is_admin()"), 'guard de tenant (empresa ou admin)')
ok(/p_aliquota < 0 OR p_aliquota > 10/.test(sql), 'mantém a validação de alíquota (0 a 10%)')
ok(sql.includes("INSERT INTO audit_log_global"), 'registra no audit_log_global')
ok(/REVOKE ALL ON FUNCTION public\.fn_fiscal_iss_alterar\([^)]*\) FROM anon/.test(sql), 'REVOKE de anon')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_fiscal_iss_alterar\([^)]*\) TO authenticated, service_role/.test(sql), 'GRANT só a authenticated/service_role')
ok(sql.includes("'fiscal.iss.editar'"), 'ajuda RD-95 da ação Editar inserida')

const tela = readFileSync('src/app/dashboard/configuracoes/fiscal/iss-municipios/page.tsx', 'utf8')
ok(tela.includes('fn_fiscal_iss_alterar'), 'a tela chama fn_fiscal_iss_alterar')
ok(tela.includes('abrirEdicao') && /onClick=\{\(\) => abrirEdicao\(r\)\}/.test(tela), 'botão Editar em cada cadastro')
ok(tela.includes('chave="fiscal.iss.editar"'), 'botão Editar tem o "?" (RD-95)')
ok(tela.includes('salvarEdicao'), 'ação de salvar a alteração')

if (falhas) process.exit(1)
console.log('check-fiscal-iss-alterar OK')
