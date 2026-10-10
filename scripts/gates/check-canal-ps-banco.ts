// Gate (CEO 07/10 16:20) — Canal PS · PR A (banco e regras): a Claude de cada sócio pede direto ao Code do PRÓPRIO sócio.
// Sem rede. Lê a migration 20261009010060 e a tela:
//  (1) erp_agente_dono com RLS (leitura equipe PS, escrita service_role, nada ao anon) e a carga do CEO;
//  (2) caixa aceita "<socio>-chat" só para o Code do próprio dono ativo — para eng_chefe/ceo nada afrouxa;
//  (3) fn_agente_pedido_enviar: guarda do dono ativo, destino nunca por parâmetro, carteira (mesma fonte dos chamados em
//      equipe), núcleo espera o OK do CEO, 30/hora, audit_log_global, revogada do anon;
//  (4) acionamento pelo mesmo corpo (fn__agente_acionar), com a guarda do canal mantida na chamada direta;
//  (5) fn_agente_pedidos_meus, painel "Meu Code" (mesma RPC + Realtime) e a regra no AGENTS.md.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ler = (p: string) => readFileSync(p, 'utf8')

const sql = ler('supabase/migrations/20261009010060_agente_canal_socio.sql').replace(/--[^\n]*/g, '')
const fn = (nome: string) => {
  const i = sql.indexOf(`FUNCTION public.${nome}(`)
  if (i < 0) return ''
  const j = sql.indexOf('$function$;', i)
  return sql.slice(i, j)
}

// (1) donos
ok(/CREATE TABLE IF NOT EXISTS public\.erp_agente_dono \(\s*agente\s+text PRIMARY KEY REFERENCES public\.erp_agente_rotina\(agente\),\s*user_id\s+uuid NOT NULL REFERENCES public\.users\(id\),\s*remetente_chat text UNIQUE/.test(sql),
  'erp_agente_dono: agente PK → rotina, user_id → users, remetente_chat único')
ok(/ALTER TABLE public\.erp_agente_dono ENABLE ROW LEVEL SECURITY/.test(sql)
  && /REVOKE ALL ON TABLE public\.erp_agente_dono FROM PUBLIC, anon, authenticated;/.test(sql)
  && /GRANT SELECT ON TABLE public\.erp_agente_dono TO authenticated;/.test(sql)
  && !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*erp_agente_dono TO (anon|authenticated)/.test(sql), 'dono: RLS, logado só lê, nada ao anon, escrita só service_role')
ok(/CREATE POLICY erp_agente_dono_sel_equipe_ps ON public\.erp_agente_dono FOR SELECT TO authenticated\s+USING \(public\.fn_equipe_ps_ativa\(\)\)/.test(sql)
  && !/FUNCTION public\.fn_equipe_ps_ativa/.test(sql)
  && /FUNCTION public\.fn_equipe_ps_ativa\(\)[\s\S]*?ps_equipe_acesso e WHERE e\.user_id = auth\.uid\(\) AND e\.ativo/.test(ler('supabase/migrations/20261007200060_dev_codes_tempo_real.sql')),
  'dono: leitura só da equipe PS (fn_equipe_ps_ativa da aba Codes, reaproveitada — não recriada)')
const carga = sql.slice(sql.indexOf('INSERT INTO public.erp_agente_dono'), sql.indexOf('ON CONFLICT (agente) DO NOTHING'))
ok(/'jordana-code',\s+'43ef8386[^']*'::uuid, 'jordana-chat',\s+true/.test(carga) && /'rodrigo-code',\s+'33464170[^']*'::uuid, 'rodrigo-chat',\s+true/.test(carga)
  && /'andre-code',\s+'f3867e65[^']*'::uuid, 'andre-chat',\s+false/.test(carga) && /'stephany-code', 'ef06f426[^']*'::uuid, 'stephany-chat', false/.test(carga)
  && !/gilberto/.test(carga), 'carga: Jordana e Rodrigo ativos, André e Stephany inativos, gilberto-* fora (ficam com o eng_chefe)')

// (2) caixa
ok(/CHECK \(de IN \('eng_chefe','ceo'\) OR de ~ '\^\[a-z\]\[a-z0-9\]\*-chat\$'\)/.test(sql), 'de: eng_chefe, ceo ou <socio>-chat')
ok(/CHECK \(tipo = 'aviso' OR para IN \('gilberto-desenv','gilberto-produto','gilberto-chamados'\) OR de ~ '\^\[a-z\]\[a-z0-9\]\*-chat\$'\)/.test(sql),
  'Code de sócio: do eng_chefe/ceo segue só aviso; tarefa só do remetente-chat')
const trg = fn('fn__agente_mensagem_remetente_chat')
ok(/d\.remetente_chat = NEW\.de AND d\.agente = NEW\.para AND d\.ativo/.test(trg) && /NEW\.tipo <> 'tarefa' OR NEW\.enviado_por IS DISTINCT FROM NEW\.de/.test(trg)
  && /BEFORE INSERT OR UPDATE OF de, para, tipo, enviado_por ON public\.erp_agente_mensagem/.test(sql),
  'gatilho: remetente-chat só para o Code do próprio dono ativo, tarefa, enviado_por = remetente')

// (3) pedido
const env = fn('fn_agente_pedido_enviar')
ok(/RETURNS jsonb\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO 'public'/.test(env), 'pedido: SECURITY DEFINER com search_path fixo')
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_pedido_enviar\(text, text, integer, uuid, boolean\) FROM PUBLIC, anon;/.test(sql)
  && /GRANT EXECUTE ON FUNCTION public\.fn_agente_pedido_enviar\(text, text, integer, uuid, boolean\) TO authenticated;/.test(sql), 'pedido: revogada do anon, só logado')
ok(/fn_agente_pedido_enviar\(p_assunto text, p_corpo text, p_chamado_numero integer DEFAULT NULL,\s*p_empresa_id uuid DEFAULT NULL, p_nucleo boolean DEFAULT false\)/.test(env)
  && !/\bp_(para|agente|de)\b/.test(env), 'pedido: assinatura do CEO, sem destino por parâmetro')
ok(/WHERE user_id = v_uid AND ativo AND remetente_chat IS NOT NULL/.test(env) && /VALUES \(d\.agente, d\.remetente_chat, 'tarefa', v_assunto, v_corpo, v_nucleo, d\.remetente_chat/.test(env),
  'pedido: só o dono ATIVO; destino = o Code dele; de = enviado_por = remetente_chat; tipo tarefa')
ok(/IF NOT public\.fn__carteira_usuario_pode\(v_uid, v_emp\)/.test(env) && /erp_carteira_responsavel c\s+WHERE c\.company_id = p_company_id AND c\.responsavel_id = p_user AND c\.vigencia_fim IS NULL/.test(fn('fn__carteira_usuario_pode'))
  && /'fora_da_carteira'/.test(env) && /Administração › Carteira/.test(env), 'pedido: empresa/chamado só da carteira (erp_carteira_responsavel vigente), recusa que ensina')
ok(/v_n >= 30/.test(env) && /interval '1 hour'/.test(env) && /pg_advisory_xact_lock/.test(env), 'pedido: 30 por hora, sem corrida')
ok(/'code_inativo'/.test(env) && /'sem_code'/.test(env) && /'login_obrigatorio'/.test(env), 'pedido: inativo, sem Code e sem login recusados')
ok(/INSERT INTO audit_log_global/.test(env), 'pedido: registro em audit_log_global')

// (4) acionamento
ok(/IF NOT NEW\.arquivada THEN PERFORM public\.fn__agente_acionar\(NEW\.id\)/.test(fn('fn_agente_mensagem_trg_acionar')), 'gatilho da caixa aciona pelo corpo único (fn__agente_acionar)')
ok(/PERFORM public\.fn__agente_assert_servico\(\);\s*RETURN public\.fn__agente_acionar\(p_mensagem_id\)/.test(fn('fn_agente_acionar')), 'fn_agente_acionar direta mantém a guarda do canal')
const ac = fn('fn__agente_acionar')
ok(/IF m\.requer_ok_ceo AND m\.ok_ceo_em IS NULL THEN[\s\S]*'aguarda_ok_ceo'/.test(ac) && /fn__agente_lease_ativa\(m\.para\)/.test(ac) && /net\.http_post/.test(ac),
  'corpo do acionamento: núcleo espera o OK, respeita o lease, dispara a rotina')
ok(/REVOKE ALL ON FUNCTION public\.fn__agente_acionar\(uuid\) FROM PUBLIC, anon, authenticated;/.test(sql), 'fn__agente_acionar revogada de todos')
ok(!/CREATE OR REPLACE FUNCTION public\.fn__agente_assert_servico/.test(sql) && !/fn_agente_mensagem_ok_ceo|fn_agente_mensagem_enviar\(/.test(sql), 'não mexe na guarda nem no envio/OK do Eng. Chefe')

// (5) meus pedidos, tela, AGENTS.md
const meus = fn('fn_agente_pedidos_meus')
ok(/WHERE m\.de = d\.remetente_chat AND m\.para = d\.agente/.test(meus) && /WHERE user_id = v_uid/.test(meus), 'pedidos_meus: só os pedidos do próprio sócio')
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_pedidos_meus\(integer\) FROM PUBLIC, anon;/.test(sql), 'pedidos_meus: revogada do anon')
const tela = ler('src/components/dev/MeuCode.tsx')
ok(/rpc\('fn_agente_pedido_enviar'/.test(tela) && /rpc\('fn_agente_pedidos_meus'/.test(tela) && /postgres_changes', \{ event: '\*', schema: 'public', table: 'erp_agente_mensagem' \}/.test(tela),
  'Meu Code: mesma RPC de envio, lista dos pedidos e Realtime')
ok(/<MeuCode \/>/.test(ler('src/components/dev/PainelCodes.tsx')), 'Meu Code dentro da aba Codes')
const ag = ler('AGENTS.md')
ok(/# Canal PS/.test(ag) && /ENTREGUE \/ EM TESTE \/ PRÓXIMO/.test(ag) && /fora da carteira/.test(ag) && /Regras de merge INALTERADAS/.test(ag), 'AGENTS.md: regra dos Codes de sócio')

if (falhas) { console.error(`\ncheck-canal-ps-banco: ${falhas} falha(s)`); process.exit(1) }
console.log('\nCanal PS (banco e regras): ok')
