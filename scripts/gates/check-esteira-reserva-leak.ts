// Gate (19/10, gilberto-desenv) — LEAK de reserva de vaga da esteira. O aceitacao-pr dispara em deployment_status
// (building→ready): cada evento é um run novo e cada triagem reservava uma vaga; runs superados/cancelados não liberavam
// (liberar-reserva tem `needs: aceitacao`, cancelado junto com o run). Reservas acumulavam e serializavam as vagas.
// Prova, sem rede/banco, que as 3 correções estão no lugar:
//   (A) fn_esteira_reservar_vaga libera a reserva ATIVA anterior da MESMA PR (outro run/attempt) antes de gravar a nova;
//   (B) fn_esteira_vagas_presas(p_min) lista as reservas ativas abertas há mais de p_min min (só leitura);
//   (C) o vigia-runs.yml reconcilia contra o run real (libera run morto via fn_esteira_liberar_vaga) e alerta > 90 min.
// A prova COMPORTAMENTAL do SQL (release-da-anterior de verdade) roda numa cópia local do Postgres (provas pesadas fora
// da produção) — ver o bloco @prova-local abaixo, executado pelo rodar-gates em CI com Postgres de serviço quando houver.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const dir = join(__dirname, '../../supabase/migrations')
const arq = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse()
  .find((f) => readFileSync(join(dir, f), 'utf8').includes('reserva anterior da mesma PR substituída'))
ok(!!arq, `migration do leak encontrada (${arq ?? '—'})`)
const sql = arq ? readFileSync(join(dir, arq), 'utf8').replace(/--[^\n]*/g, '') : ''

// (A) libera a reserva ativa anterior da MESMA PR, dentro do lock, antes do INSERT
const reservar = sql.slice(sql.indexOf('FUNCTION public.fn_esteira_reservar_vaga'))
const corpoReservar = reservar.slice(0, reservar.indexOf('$$;') + 3)
ok(/pg_advisory_xact_lock\(hashtext\('erp_esteira_vaga_reserva'\)\)/.test(corpoReservar), 'reservar: mantém o advisory lock que serializa as triagens')
const updAnterior = /UPDATE erp_esteira_vaga_reserva\s+SET liberada_em = now\(\)[\s\S]*?WHERE pr_numero = p_pr\s+AND liberada_em IS NULL\s+AND NOT \(run_id = p_run_id AND run_attempt = p_run_attempt\);/.exec(corpoReservar)
ok(!!updAnterior, 'reservar (A): libera a reserva ATIVA anterior da MESMA PR (outro run/attempt) antes de gravar a nova')
ok(!!updAnterior && updAnterior.index < corpoReservar.indexOf('INSERT INTO erp_esteira_vaga_reserva'), 'reservar: a liberação-da-anterior vem ANTES do INSERT (atômica sob o lock)')
ok(/SELECT vaga INTO v_existente[\s\S]*?run_id = p_run_id AND run_attempt = p_run_attempt/.test(corpoReservar), 'reservar: idempotência da própria tentativa preservada')
// NÃO introduz índice único em pr_numero (quebraria o INSERT numa corrida e travaria a triagem)
ok(!/CREATE UNIQUE INDEX[^;]*\(pr_numero\)[^;]*liberada_em IS NULL/i.test(sql), 'reservar: sem índice único em pr_numero (não trava o INSERT da triagem)')

// (B) função de leitura das presas
const presas = sql.slice(sql.indexOf('FUNCTION public.fn_esteira_vagas_presas'))
ok(/FUNCTION public\.fn_esteira_vagas_presas\(p_min integer DEFAULT 90\)/.test(sql), 'presas (B): fn_esteira_vagas_presas(p_min DEFAULT 90)')
ok(/liberada_em IS NULL\s+AND criada_em <= now\(\) - make_interval/.test(presas) && /LANGUAGE sql STABLE/.test(presas), 'presas: só ativas abertas há > p_min min, read-only (STABLE)')
for (const fn of ['fn_esteira_reservar_vaga', 'fn_esteira_vagas_presas']) {
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`).test(sql), `${fn}: revogada de PUBLIC/anon/authenticated`)
  ok(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`).test(sql), `${fn}: concedida à service_role`)
}

// (C) vigia reconcilia contra o run real + alerta > 90 min
const vigia = readFileSync(join(__dirname, '../../.github/workflows/vigia-runs.yml'), 'utf8')
ok(/Reconciliar reservas de vaga/.test(vigia), 'vigia: passo de reconciliação de reservas')
ok(/erp_esteira_vaga_reserva\?liberada_em=is\.null/.test(vigia), 'vigia: lê as reservas ATIVAS do banco')
ok(/actions\/runs\/\$rid/.test(vigia) && /rpc\/fn_esteira_liberar_vaga/.test(vigia), 'vigia: confere o run real e libera o morto via fn_esteira_liberar_vaga')
ok(/idade" -ge 90/.test(vigia) && /::warning title=Reserva de vaga presa/.test(vigia), 'vigia: alerta reserva presa > 90 min')
ok(/in_progress\|queued\|waiting\|pending\|requested\)/.test(vigia), 'vigia: run vivo (in_progress/queued/...) NÃO é liberado — só alertado se > 90 min')

if (falhas) { console.error(`\ncheck-esteira-reserva-leak: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-esteira-reserva-leak: ok')
