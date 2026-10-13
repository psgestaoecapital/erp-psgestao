// Gate · RD-35 — o briefing de sessão aponta para os blueprints vivos (CEO 02/10). Sem rede.
// 1) fn_briefing_blueprints devolve blueprints_vigentes (vertical, versão, título, data) e ponto_de_partida (título e
//    descrição do registro mais recente com a tag 'ponto-de-partida');
// 2) o fn_briefing_sessao ganha a linha por âncora no RETURN final (aborta se a âncora sumir, não duplica);
// 3) só leitura e sem acesso de usuário logado.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const mig = readFileSync('supabase/migrations/20261002290000_briefing_blueprints.sql', 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

ok(/'blueprints_vigentes'/.test(sql) && /FROM public\.erp_documento_vertical d\s+WHERE d\.vigente IS TRUE/.test(sql), 'blueprints vigentes de erp_documento_vertical')
for (const c of ["'vertical'", "'versao'", "'titulo'", "'data'"]) ok(sql.includes(c), `blueprint traz ${c}`)
ok(/'ponto_de_partida'/.test(sql) && /'ponto-de-partida' = ANY \(c\.tags\)/.test(sql) && /LIMIT 1/.test(sql), 'ponto de partida: tag ponto-de-partida, só o mais recente')
ok(/'titulo', c\.titulo, 'descricao', c\.descricao/.test(sql), 'ponto de partida traz título e descrição')
ok(/v_result := v_result \|\| public\.fn_briefing_blueprints\(\);/.test(sql), 'briefing junta os dois blocos ao retorno')
ok(/IF v_def !~ 'fn_briefing_blueprints'/.test(sql) && /IF v_new = v_def THEN RAISE EXCEPTION/.test(sql), 'encadeamento por âncora: não duplica e aborta se a âncora sumir')
ok(/REVOKE ALL ON FUNCTION public\.fn_briefing_blueprints\(\) FROM PUBLIC, anon, authenticated;/.test(sql), 'sem acesso de usuário logado')
ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(sql), 'só leitura (nada gravado)')

if (falhas) { console.error(`\ncheck-briefing-blueprints: ${falhas} falha(s)`); process.exit(1) }
console.log('\nBriefing aponta os blueprints: ok')
