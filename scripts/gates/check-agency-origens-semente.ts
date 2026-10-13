// Gate (01/10 · achado pelo veredito @pos-migration da #1955/#552): fn_agency_origens_listar semeia a lista padrão de
// origens do lead na 1ª abertura, mas o ON CONFLICT (company_id, chave) quebrava com 42702 (a coluna de saída "chave"
// do RETURNS TABLE colidia com a coluna da tabela). Roda no build, sem rede — lê a migration da correção.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261001160000_agency_origens_listar_semente.sql', 'utf8')
ok(/\$function\$\s*#variable_conflict use_column/.test(mig), 'nomes ambíguos resolvem para a coluna da tabela (#variable_conflict use_column)')
ok(/RETURNS TABLE\(id uuid, chave text, nome text, ordem integer, ativo boolean\)/.test(mig), 'retorno igual ao de antes (a tela não muda)')
ok(/ON CONFLICT \(company_id, chave\) DO NOTHING/.test(mig), 'semente idempotente (2ª chamada não duplica)')
ok(/NOT is_admin\(\) AND p_company_id NOT IN \(SELECT get_user_company_ids\(\)\)/.test(mig), 'guarda de empresa mantida')
ok(/REVOKE ALL ON FUNCTION public\.fn_agency_origens_listar\(uuid\) FROM PUBLIC, anon/.test(mig), 'fechada ao anon')
for (const chave of ['whatsapp', 'site', 'indicacao', 'trafego_pago', 'ligacao', 'email', 'evento', 'relacionamento', 'prospeccao_ia_fria']) {
  ok(mig.includes(`('${chave}',`), `origem padrão "${chave}" na semente`)
}
ok(!/\bUPDATE\b|\bDELETE\b/i.test(mig.replace(/--.*$/gm, '')), 'nenhum dado existente é alterado')

if (falhas) { console.error(`\n${falhas} falha(s) na semente de origens`); process.exit(1) }
console.log('\nSemente de origens do lead (fn_agency_origens_listar): ok')
