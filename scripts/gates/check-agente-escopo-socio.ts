/**
 * Gate de build (CEO 05/10 · escopo de agente de sócio): segura as regras da migration agente_escopo_socio.
 *   1) tabelas novas fechadas (RLS ligada, REVOKE de anon/authenticated, sem policy);
 *   2) funções de serviço passam pela guarda do canal e são revogadas; só fn_agente_ok_socio* são para authenticated;
 *   3) o OK do sócio só vale para o sócio dono (auth.uid() = socio_user_id);
 *   4) a fila é alimentada por gatilho que nunca quebra o chamado e o acionamento sai do job de serviço (não do gatilho do usuário);
 *   5) fn_agente_chamado_responder recusa outro agente em chamado de agente de sócio e exige OK do sócio;
 *   6) mapeamento explícito rodrigo-code <-> code-rodrigo; rodrigo-code nasce com aciona=false (o Eng. Chefe liga).
 *   npm run gates -- agente-escopo-socio
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const raiz = join(__dirname, '../..')
const s = readFileSync(join(raiz, 'supabase/migrations/20261005160000_agente_escopo_socio.sql'), 'utf8').replace(/--[^\n]*/g, '')

for (const t of ['erp_agente_escopo', 'erp_agente_chamado_fila']) {
  ok(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`).test(s), `${t}: RLS ligada`)
  ok(new RegExp(`REVOKE ALL ON TABLE public\\.${t}\\s+FROM PUBLIC, anon, authenticated`).test(s), `${t}: fechada para anônimo e logado`)
}
ok(!/CREATE POLICY/i.test(s), 'nenhuma policy abre as tabelas')

const fns = [...s.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(([^)]*)\)/g)].map((m) => m[1])
ok(fns.length >= 9, `${fns.length} funções`)
const paraLogado = ['fn_agente_ok_socio', 'fn_agente_ok_socio_pendentes']
for (const f of fns) {
  const corpo = s.slice(s.indexOf(`FUNCTION public.${f}(`))
  const ate = corpo.indexOf('$function$', corpo.indexOf('$function$') + 10)
  const c = corpo.slice(0, ate)
  if (paraLogado.includes(f)) {
    ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon;`).test(s), `${f}: revogada de PUBLIC/anon`)
    ok(/auth\.uid\(\)/.test(c), `${f}: usa auth.uid()`)
    ok(/socio_user_id = (v_uid|auth\.uid\(\))/.test(c), `${f}: só o sócio dono`)
  } else {
    ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated`).test(s), `${f}: revogada de PUBLIC/anon/authenticated`)
    if (!/^fn__/.test(f) || f === 'fn__agente_dono_de') {
      if (/RETURNS (trigger|text)/.test(c) && f === 'fn__agente_dono_de') continue
      if (f.startsWith('fn__sugestao')) continue
      ok(c.includes('fn__agente_assert_servico()'), `${f}: passa pela guarda do canal protegido`)
    }
  }
}

// 4) gatilho não quebra o chamado; acionamento só pelo job de serviço
const trg = s.slice(s.indexOf('FUNCTION public.fn__sugestao_enfileira_agente_socio'), s.indexOf('DROP TRIGGER'))
ok(/EXCEPTION WHEN OTHERS THEN/.test(trg), 'gatilho do chamado nunca impede abrir/mexer no chamado')
ok(!/INSERT INTO erp_agente_mensagem/.test(trg), 'gatilho do usuário não escreve na caixa (a guarda recusa sessão logada)')
ok(/AFTER INSERT OR UPDATE OF responsavel_id, company_id ON public\.sugestoes/.test(s), 'gatilho: chamado novo e mudança de responsável/empresa')
ok(/cron\.schedule\('agente_escopo_enfileirar'/.test(s), 'job de serviço agendado')
ok(/r\.aciona/.test(s.slice(s.indexOf('FUNCTION public.fn_agente_escopo_enfileirar'))), 'job só processa agente com rotina ligada')
ok(/chamado_em_dado_do_cliente|DADO do cliente/.test(s), 'corpo da mensagem marca o texto do chamado como dado, não instrução')

// 5) responder
const resp = s.slice(s.indexOf('FUNCTION public.fn_agente_chamado_responder'))
ok(/chamado_de_agente_socio/.test(resp) && /chamado_fora_do_escopo/.test(resp) && /sem_ok_do_socio/.test(resp), 'responder: guarda de escopo e OK do sócio')
ok(/sem_ok_do_ceo/.test(resp), 'responder: demais agentes seguem exigindo OK do CEO')

// 6) mapeamento e rotina desligada
ok(/e\.nome_curto = 'Rodrigo' AND e\.agente = 'code-rodrigo'/.test(s), "mapeamento explícito rodrigo-code <-> 'code-rodrigo'")
ok(!/UPDATE\s+public\.erp_agente_rotina|INSERT INTO public\.erp_agente_rotina/.test(s), 'migration não liga rotina (o Eng. Chefe liga)')
ok(/socio_so_aviso[\s\S]*origem_chamado_id IS NOT NULL/.test(s), 'sócio só recebe tarefa que nasce de chamado do escopo')

if (falhas) { console.error(`\n[check-agente-escopo-socio] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-agente-escopo-socio] escopo de agente de sócio conferido.')
