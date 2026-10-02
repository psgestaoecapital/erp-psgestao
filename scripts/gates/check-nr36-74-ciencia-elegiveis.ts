// Gate (chamado #74 · Frioeste · CEO 02/10): a aba Ciência lista TODOS os elegíveis à pausa térmica do mês, indicando
// quem está sem documento (com botão para gerar) e quem não tem pausa importada no mês. Roda no build, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261003090000_nr36_74_ciencia_elegiveis.sql', 'utf8')
ok(/FUNCTION public\.fn_nr36_ciencia_painel/.test(mig) && /STABLE/.test(mig), 'painel da Ciência é só leitura')
ok(/nr36_funcionario_elegivel e[\s\S]*e\.tipo = 'termica_253' AND e\.ativo/.test(mig), 'parte dos elegíveis ATIVOS à pausa térmica (não de quem já tem documento)')
ok(/'sem_documento'/.test(mig) && /'sem_apuracao'/.test(mig) && /'com_documento'/.test(mig), 'cada linha diz a situação: com documento · sem documento · sem pausa no mês')
ok(/REVOKE ALL ON FUNCTION public\.fn_nr36_ciencia_painel\(uuid, date\) FROM PUBLIC, anon/.test(mig), 'fechada para quem não está logado')
ok(!/\b(INSERT INTO|UPDATE|DELETE FROM)\b/.test(mig), 'a migration não grava nada')

const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
ok(/rpc<[^>]*>\('fn_nr36_ciencia_painel'/.test(tela) && !/rpc<[^>]*>\('fn_nr36_ciencia_listar'/.test(tela), 'a aba lê o painel de elegíveis (não mais só os documentos)')
ok(/ciencia-gerar-\$\{l\.cpf\}/.test(tela) && /fn_nr36_ciencia_gerar', \{ p_company_id: companyId, p_competencia: `\$\{comp\}-01`, p_cpf: l\.cpf \}/.test(tela), 'quem está sem documento tem o botão para gerar o dele')
ok(/Sem relatório de pausa no mês/.test(tela) && /Sem documento/.test(tela) && /Elegíveis no mês/.test(tela), 'a tela mostra elegíveis, sem documento e sem pausa no mês')

if (falhas) { console.error(`\n${falhas} falha(s) na Ciência de elegíveis (#74)`); process.exit(1) }
console.log('\nCiência lista todos os elegíveis (#74): ok')
