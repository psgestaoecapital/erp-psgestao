// Gate · Central de Desenvolvimento › "Fluxo ao vivo" (CEO 29/10/2026 06:20 e 06:27). Sem rede. Confere:
//  1) a lista de Codes é DINÂMICA: o componente não tem nome de Code fixo e lê tudo de fn_infra_fluxo_vivo;
//  2) a função decide quem aparece pela janela de atividade (sessão, caixa, PR aberta/pronta) — publicação da fila não
//     conta (Code pausado não "volta" quando a fila publica a PR dele) — e só lista robô (cron) ATIVO;
//  3) guarda fn_dev_painel_pode_ver, nada aberto a anônimo, nenhuma função existente recriada, nada apagado;
//  4) a aba existe na Central com rota própria e "?" (RD-95) com as chaves cadastradas na migration.
import { readFileSync, existsSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const comp = readFileSync('src/components/dev/FluxoVivo.tsx', 'utf8')
// acha a migration pelo nome (sem a versão), para a fila poder renumerar sozinha sem quebrar o gate
const arqMig = readdirSync('supabase/migrations').filter((f) => f.endsWith('_dev_fluxo_ao_vivo.sql'))
if (arqMig.length !== 1) { console.error(`✗ esperava 1 migration *_dev_fluxo_ao_vivo.sql, achei ${arqMig.length}`); process.exit(1) }
const mig = readFileSync(`supabase/migrations/${arqMig[0]}`, 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const central = readFileSync('src/app/dashboard/dev/page.tsx', 'utf8')

// 1) nada fixo no componente
ok(/rpc\("fn_infra_fluxo_vivo"/.test(comp), 'componente lê fn_infra_fluxo_vivo')
for (const nome of ['dev7claudeps', 'desenvolvedor_', 'aud8claudeps', 'auditor_pdca_g', 'jordana-code', 'rodrigo-code', 'gilberto-revisor', 'gilberto-esteira']) {
  ok(!comp.includes(nome), `sem Code fixo no componente: ${nome}`)
}
ok(/setInterval\(\(\) => void carregar\(\), 30000\)/.test(comp), 'atualiza sozinho a cada 30 s')

// 2) regra de quem aparece
ok(/FROM erp_agente_sessao_lease l/.test(sql) && /greatest\(m\.recebida_em, m\.iniciada_em, m\.concluida_em\)/.test(sql), 'sinal de vida: sessão e caixa')
ok(/x\.evento IN \('aberta', 'pronta'\)/.test(sql) && !/x\.evento IN \([^)]*'publicada'/.test(sql), 'PR aberta/pronta conta; publicação da fila não')
ok(/WHERE ultima > now\(\) - make_interval\(mins => v_jan\)/.test(sql), 'só aparece quem está dentro da janela')
ok(/LEAST\(GREATEST\(COALESCE\(p_janela_min, 120\), 30\), 1440\)/.test(sql), 'janela limitada (30 min a 24 h, padrão 2 h)')
ok(/WHERE j\.active;/.test(sql), 'só robô (cron) ativo')
ok(/'fora_do_roteamento', COALESCE\(p\.pausado, false\)/.test(sql), 'pausado no papel só marca fora do roteamento')

// 3) segurança e aditividade
ok(/IF NOT public\.fn_dev_painel_pode_ver\(\) THEN RAISE EXCEPTION/.test(sql), 'guarda da equipe PS')
ok(/REVOKE ALL ON FUNCTION public\.fn_infra_fluxo_vivo\(integer\) FROM PUBLIC, anon/.test(sql), 'nada aberto a anônimo')
ok(!/\bDELETE\s+FROM\b|\bDROP\s+(?:TABLE|FUNCTION|COLUMN)\b|\bTRUNCATE\b|\bUPDATE\s+public\./i.test(sql), 'nada apagado nem alterado')
const recriadas = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)/g)].map((m) => m[1])
ok(recriadas.length === 1 && recriadas[0] === 'fn_infra_fluxo_vivo', 'só a função nova')

// 4) aba, rota e "?"
ok(/view==='fluxo' && <div style=\{\{ padding:16 \}\}><FluxoVivo\/><\/div>/.test(central), 'aba Fluxo ao vivo na Central')
ok(/\\\/dashboard\\\/dev\\\/fluxo/.test(central), 'rota própria abre a aba')
ok(existsSync('src/app/dashboard/dev/fluxo/page.tsx'), 'página /dashboard/dev/fluxo')
const chaves = [...comp.matchAll(/AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
ok(chaves.length >= 7, `"?" em toda área da tela (${chaves.length})`)
for (const k of new Set(chaves)) ok(mig.includes(`('${k}',`), `chave de ajuda cadastrada: ${k}`)
ok(/'\/dashboard\/dev\/fluxo', 'dev', 'dev_fluxo', 'Fluxo ao vivo'/.test(mig), 'tela em system_screens')

if (falhas) { console.error(`\n${falhas} falha(s) — Fluxo ao vivo`); process.exit(1) }
console.log('\nFluxo ao vivo ok')
