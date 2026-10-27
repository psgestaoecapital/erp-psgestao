// Gate (Proplay, carteira Jordana, 17/10): empresa isenta de IE (companies.ie_isento) não pode aparecer no pré-voo da
// NF-e com a IE como impeditivo — vira aviso com a orientação "use NFS-e". Empresa sem IE e NÃO isenta segue bloqueada.
// Roda no build. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261019122420_fiscal_previo_ie_isento.sql', 'utf8')

ok(mig.includes('coalesce(ie_isento, false) as ie_isento into emp'), 'lê companies.ie_isento')
ok(/v_ie_isento_sem_ie boolean := not \(coalesce\(btrim\(emp\.inscricao_estadual\), ''\) <> ''\) and coalesce\(emp\.ie_isento, false\)/.test(mig),
  'isenta só conta quando a IE está vazia')
ok(mig.includes("'Empresa isenta de IE: não emite NF-e de produto; use NFS-e','ok',false,'valor','isenta','severidade','aviso'"),
  'isenta → item de AVISO com a orientação')
ok(mig.includes("'Inscrição Estadual da empresa','ok',ok_ie,'valor',emp.inscricao_estadual,'severidade','bloqueio'"),
  'não isenta → IE continua como bloqueio')
ok(mig.includes('(case when not ok_ie and not v_ie_isento_sem_ie then 1 else 0 end)'), 'isenta não soma em config_bloqueios')
ok(mig.includes('+ (case when v_ie_isento_sem_ie then 1 else 0 end);'), 'isenta soma em config_avisos')
ok(mig.includes('security definer') && mig.includes("set search_path to 'public'"), 'SECURITY DEFINER com search_path fixo')
ok(mig.includes("raise exception 'sem acesso a esta empresa'"), 'guarda de acesso por empresa mantida')
ok(/revoke all on function public\.fn_fiscal_previo\(uuid\) from anon;/.test(mig), 'função fechada ao anon')

if (falhas) { console.error(`check-previo-ie-isento: ${falhas} falha(s)`); process.exit(1) }
console.log('check-previo-ie-isento: ok')
