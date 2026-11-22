/**
 * Gate de build — Chamado #9788 (CEO 19/11): "Aprovações pendentes voltam após aprovar".
 * Prova, sobre a migration, que ao aprovar o OK do sócio (fn_agente_ok_socio = 'aprovado') a resposta é
 * PUBLICADA ao cliente e o chamado AVANÇA, na mesma transação — senão o chamado fica 'nova' e o roteador
 * recria a aprovação a cada hora (o loop reportado). Estático, sem rede/banco.
 *   npm run gates -- chamado-9788-ok-socio-publica
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const raiz = join(__dirname, '../..')
const dir = join(raiz, 'supabase/migrations')
const arq = readdirSync(dir).find((f) => f.endsWith('_chamado_9788_ok_socio_publica_resposta.sql'))
ok(!!arq, `migration do #9788 encontrada (${arq ?? '—'})`)
const sql = arq ? readFileSync(join(dir, arq), 'utf8') : ''
const semComentarios = sql.replace(/--[^\n]*/g, '')
// corpo da função (entre a definição e o fim do $function$)
const ini = semComentarios.indexOf('FUNCTION public.fn_agente_ok_socio(')
const corpo = ini >= 0 ? semComentarios.slice(ini, semComentarios.indexOf('$function$;', ini)) : ''

ok(ini >= 0 && /SECURITY DEFINER/.test(corpo), 'fn_agente_ok_socio redefinida como SECURITY DEFINER')
// guardas antigas preservadas
ok(corpo.includes("'nao_autenticado'") && /v_uid uuid := auth\.uid\(\)/.test(corpo), 'exige usuário logado (auth.uid())')
ok(/e\.socio_user_id = v_uid/.test(corpo) && corpo.includes("'so_o_socio_dono'"), 'só o sócio dono do agente aprova (so_o_socio_dono)')
ok(corpo.includes("'ja_decidido'"), 'dupla aprovação é barrada (ja_decidido) — idempotente')
ok(corpo.includes("'sem_pedido_aberto'"), 'sem pedido aberto não aprova')
// publicação da resposta ao avançar
ok(/IF p_decisao = 'aprovado' THEN/.test(corpo), 'só o ramo APROVADO publica (recusado não posta)')
ok(/INSERT INTO sugestao_mensagem[\s\S]*?'ps'/.test(corpo), "publica a mensagem 'ps' ao cliente")
ok(/UPDATE sugestoes SET[\s\S]*?resposta_aprovada = true[\s\S]*?status = v_status/.test(corpo), 'marca resposta_aprovada e avança o status')
ok(/'aguardando_confirmacao'/.test(corpo), "avança para 'aguardando_confirmacao' (o roteador já exclui esse status → não reabre)")
ok(/INSERT INTO sugestao_notificacao[\s\S]*?'resposta'[\s\S]*?'pendente'/.test(corpo), "enfileira a notificação 'resposta' (e-mail pela fila oficial)")
// autor PS, rastro e NÃO forja identidade
ok(/system_role IN \('PS_ADMIN','PS_ADMIN_CVM'\)/.test(corpo) && corpo.includes('erp_agente_config'), 'autor = conta PS de erp_agente_config (PS_ADMIN de verdade), nunca parâmetro')
ok(/ok_ceo_origem/.test(corpo) && /'ok_socio'/.test(corpo), "rastro ok_ceo_origem='ok_socio'")
ok(/sha256\(/.test(corpo) && /texto_hash/.test(corpo), 'registra o hash do texto publicado')
ok(!/set_config|request\.jwt|auth\.uid\(\)\s*:=/i.test(corpo), 'não forja claims de JWT nem identidade')
// idempotência da publicação (não duplica mensagem/e-mail) + escopo
ok(/COALESCE\(s\.resposta_aprovada, false\) = false/.test(corpo), 'só publica se ainda não há resposta aprovada (idempotente)')
ok(/NOT EXISTS \(SELECT 1 FROM sugestao_mensagem sm[\s\S]*?btrim\(sm\.texto\) = v_texto\)/.test(corpo), 'não duplica mensagem idêntica já postada (idempotente)')
ok(/fn__agente_escopo_chamado_i\(m\.para, v_sug\)/.test(corpo), 'só publica em chamado DENTRO do escopo do agente de sócio')
// segurança: nada apagado, texto é o pedido do próprio sócio
ok(!/DELETE\s+FROM/i.test(corpo), 'nada é apagado')
ok(/v_texto text := btrim\(COALESCE\(m\.pedido_ok_socio/.test(corpo) || /v_texto := btrim\(COALESCE\(m\.pedido_ok_socio/.test(corpo), 'texto publicado = o pedido_ok_socio que o sócio aprovou')
// grants: authenticated sim, anon não (não mexe no fn_agente_chamado_responder, que é só serviço)
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_ok_socio\(uuid, text\) FROM PUBLIC, anon;/.test(semComentarios)
   && /GRANT EXECUTE ON FUNCTION public\.fn_agente_ok_socio\(uuid, text\) TO authenticated/.test(semComentarios), 'fn_agente_ok_socio: authenticated sim, anon não')
ok(!/FUNCTION public\.fn_agente_chamado_responder\(/.test(semComentarios), 'NÃO altera fn_agente_chamado_responder (caminho oficial do Code, gate próprio)')

if (falhas) { console.error(`\ncheck-chamado-9788-ok-socio-publica: ${falhas} falha(s)`); process.exit(1) }
console.log('\nChamado #9788 (OK do sócio publica a resposta): ok')
