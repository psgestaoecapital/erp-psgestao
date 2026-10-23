// Gate (HB0 item 6, CEO 23/10) — a OS de empresa de obra diz obra / etapa / serviço / equipe (não só placa de oficina).
// Confere: a ficha da OS monta o bloco; o bloco usa só as duas RPCs com guarda; cada campo tem "?" com chave criada por
// migration; a migration é aditiva (tabela nova ligada à erp_os, sem ALTER na erp_os), com RLS, REVOKE anon e guarda de
// empresa nas duas funções; etapa e serviço são conferidos contra a obra escolhida. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const card = readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8')
const bloco = readFileSync('src/components/projetos/OsObraVinculo.tsx', 'utf8')
const arq = readdirSync('supabase/migrations').find((f) => f.endsWith('_hub_os_obra.sql'))
ok(!!arq, 'migration *_hub_os_obra.sql presente')
const mig = arq ? readFileSync(`supabase/migrations/${arq}`, 'utf8') : ''

ok(/<OsObraVinculo osId=\{os\.id\} readOnly=\{roEntrega\} \/>/.test(card), 'ficha da OS monta o bloco Obra (somente leitura quando a OS está entregue)')
ok(/if \(!dados\?\.tem_obras\) return null/.test(bloco), 'bloco some em empresa sem obra em andamento (oficina segue igual)')
ok(bloco.includes('"fn_os_obra_obter"') && bloco.includes('"fn_os_obra_salvar"'), 'bloco lê e grava só pelas RPCs fn_os_obra_obter / fn_os_obra_salvar')
ok(!/\.from\(["']projetos_os_obra["']\)/.test(bloco), 'bloco não escreve direto na tabela')
for (const ch of ['os.ficha.obra', 'os.ficha.etapa', 'os.ficha.servico', 'os.ficha.equipe', 'os.ficha.obra_salvar']) {
  ok(bloco.includes(`chave="${ch}"`) && mig.includes(`'${ch}'`), `"?" ${ch} na tela e na migration`)
}

ok(/CREATE TABLE IF NOT EXISTS public\.projetos_os_obra/.test(mig), 'tabela nova projetos_os_obra')
ok(!/ALTER TABLE\s+(public\.)?erp_os\b/i.test(mig), 'erp_os não é alterada')
ok(/ALTER TABLE public\.projetos_os_obra ENABLE ROW LEVEL SECURITY/.test(mig), 'RLS ligada')
ok(/REVOKE ALL ON public\.projetos_os_obra FROM PUBLIC, anon/.test(mig), 'REVOKE anon na tabela')
ok(/company_id IN \(SELECT public\.get_user_company_ids\(\)\)/.test(mig), 'leitura por empresa do usuário')
ok((mig.match(/PERFORM public\.fn__guarda_empresa\(v_company\)/g) ?? []).length === 2, 'guarda de empresa nas duas funções')
ok((mig.match(/FROM PUBLIC, anon;/g) ?? []).length >= 3, 'REVOKE anon na tabela e nas duas funções')
ok(/id = p_tarefa_id AND obra_id = p_obra_id/.test(mig) && /id = p_obra_item_id AND obra_id = p_obra_id/.test(mig), 'etapa e serviço precisam ser da obra escolhida')
ok(/id = p_obra_id AND company_id = v_company/.test(mig), 'obra precisa ser da empresa da OS')

if (falhas) { console.error(`\ncheck-os-obra: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-os-obra: ok')
