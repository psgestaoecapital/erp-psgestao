/**
 * Gate de build (CEO 03/10 · fim do copia e cola): caixa de mensagens dos agentes (erp_agente_mensagem).
 * Segura as regras que tornam a caixa um CANAL PROTEGIDO:
 *   1) tabelas fechadas para anônimo e usuário logado (RLS ligada, REVOKE, sem policy);
 *   2) toda função passa pela guarda do canal (fn__agente_assert_servico) e é revogada de PUBLIC/anon/authenticated;
 *   3) aos Codes dos sócios só AVISO (CHECK no banco); só os dois Codes dirigidos pelo Eng. Chefe acionam rotina;
 *   4) com requer_ok_ceo, nada é acionado antes do OK registrado;
 *   5) URL e token da rotina saem SÓ do cofre (vault) e nunca vão para retorno/tabela; o texto enviado é só um aviso;
 *   6) o protocolo está no AGENTS.md (lido por toda sessão).
 *   npm run gates -- agente-caixa
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const raiz = join(__dirname, '../..')
const dir = join(raiz, 'supabase/migrations')
const arq = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .reverse().find((f) => readFileSync(join(dir, f), 'utf8').includes('CREATE TABLE IF NOT EXISTS public.erp_agente_mensagem'))
ok(!!arq, `migration da caixa encontrada (${arq ?? '—'})`)
const sql = arq ? readFileSync(join(dir, arq), 'utf8') : ''
const s = sql.replace(/--[^\n]*/g, '')

const AGENTES = ['gilberto-desenv', 'gilberto-chamados', 'rodrigo-code', 'jordana-code', 'andre-code', 'stephany-code']
ok(AGENTES.every((a) => s.includes(`'${a}'`)), 'identificadores oficiais dos 6 agentes')
ok(/CHECK \(de IN \('eng_chefe','ceo'\)\)/.test(s), 'remetente só eng_chefe ou ceo')

// 1) canal protegido
for (const t of ['erp_agente_rotina', 'erp_agente_mensagem']) {
  ok(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`).test(s), `${t}: RLS ligada`)
  ok(new RegExp(`REVOKE ALL ON TABLE public\\.${t}\\s+FROM PUBLIC, anon, authenticated`).test(s), `${t}: fechada para anônimo e logado`)
}
ok(!/CREATE POLICY[^;]*erp_agente_/i.test(s), 'nenhuma policy abre as tabelas')

// 2) funções: guarda do canal + revogadas
const fns = [...s.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(([^)]*)\)\s*RETURNS\s+(\w+)/g)].map((m) => ({ nome: m[1], ret: m[3] }))
ok(fns.length >= 8, `${fns.length} funções da caixa`)
for (const f of fns) {
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f.nome}\\([^)]*\\) FROM PUBLIC, anon, authenticated`).test(s), `${f.nome}: revogada de PUBLIC/anon/authenticated`)
  if (f.nome === 'fn__agente_assert_servico' || f.ret === 'trigger') continue
  const corpo = s.slice(s.indexOf(`FUNCTION public.${f.nome}(`))
  const ate = corpo.indexOf('$function$', corpo.indexOf('$function$') + 10)
  ok(corpo.slice(0, ate).includes('fn__agente_assert_servico()'), `${f.nome}: passa pela guarda do canal protegido`)
}
ok(/auth\.uid\(\) IS NOT NULL THEN\s+RAISE EXCEPTION/.test(s), 'guarda recusa sessão de usuário logado')

// 3) sócios só aviso; só os Codes dirigidos acionam
ok(/CHECK \(tipo = 'aviso' OR para IN \('gilberto-desenv','gilberto-chamados'\)\)/.test(s), 'Codes dos sócios: só aviso (CHECK no banco)')
ok(/\('gilberto-desenv',\s+true/.test(s) && /\('gilberto-chamados', true/.test(s) && /\('rodrigo-code',\s+false/.test(s), 'acionamento ligado só para gilberto-desenv e gilberto-chamados')

// 4) OK do CEO antes de acionar
const acionar = s.slice(s.indexOf('FUNCTION public.fn_agente_acionar('), s.indexOf('FUNCTION public.fn_agente_mensagem_trg_acionar('))
ok(acionar.indexOf("'aguarda_ok_ceo'") > -1 && acionar.indexOf("'aguarda_ok_ceo'") < acionar.indexOf('net.http_post'), 'com OK pendente não aciona (checado antes do POST)')
ok(/OLD\.ok_ceo_em IS NULL AND NEW\.ok_ceo_em IS NOT NULL/.test(s), 'OK registrado aciona a rotina (gatilho)')
ok(/'aguarda_ok_ceo'/.test(s.slice(s.indexOf('FUNCTION public.fn_agente_mensagem_responder('))), 'Code não executa tarefa com OK pendente')

// 5) segredo só do cofre, nunca exposto
ok(/FROM vault\.decrypted_secrets WHERE name = 'agente_rotina_url_'\s+\|\| m\.para/.test(s) &&
   /FROM vault\.decrypted_secrets WHERE name = 'agente_rotina_token_' \|\| m\.para/.test(s), 'URL e token lidos do cofre por agente')
ok(!/jsonb_build_object\([^;]*v_(url|token)[^;]*\)\s*(INTO|;)/.test(acionar.replace(/net\.http_post\([\s\S]*?\) INTO v_req;/, '')), 'URL/token não vão para retorno nem tabela')
ok(/'Bearer ' \|\| v_token/.test(acionar) && /experimental-cc-routine-2026-04-01/.test(acionar), 'POST no gatilho de API da rotina com Bearer')
ok(/'Nova mensagem ' \|\| m\.id::text/.test(acionar) && !/m\.corpo/.test(acionar), 'texto do disparo é só aviso (sem o corpo da tarefa)')
ok(!/\bcron\.schedule\b/.test(s), 'sem plantão automático (cron)')

// 6) protocolo no AGENTS.md
const agents = readFileSync(join(raiz, 'AGENTS.md'), 'utf8')
ok(/fn_agente_caixa\('<seu-identificador>'\)/.test(agents) && /requer_ok_ceo/.test(agents) && /fn_agente_mensagem_responder/.test(agents),
  'AGENTS.md: protocolo da caixa (ler no início, OK do CEO, responder na mensagem)')

if (falhas) { console.error(`\n[check-agente-caixa] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-agente-caixa] caixa de mensagens dos agentes: canal protegido, OK do CEO e cofre conferidos.')
