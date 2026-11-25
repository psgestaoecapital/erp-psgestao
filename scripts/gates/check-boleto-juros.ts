/**
 * Gate de build (CEO 25/11): boleto pago com juros baixa COM juros e fica 'pago' — também na conciliação (simples e agrupada).
 * REGRA ÚNICA: valor_pago = valor recebido = valor − desconto + juros + multa; a soma das baixas = valor_pago = valor do banco.
 * Trava no estático o que não pode regredir:
 *   1) fn_boleto_liquidar aplica a regra única (diferença → juros; valor_pago = valor pago; sem valor do banco → aviso);
 *   2) fn_boleto_liquidar_banco é só um invólucro de fn_boleto_liquidar (uma função só p/ todos os bancos);
 *   3) fn_conciliacao_ajustar_valores soma o acréscimo TAMBÉM em valor_pago (o guarda gera a baixa, o status fecha 'pago');
 *   4) desfazer conciliação restaura juros/desconto/valor_pago do estado-antes guardado no vínculo;
 *   5) trg_status_receber e trg_status_pagar recalculam status quando 'conciliado'/'movimento_banco_id' mudam;
 *   6) correção de dado idempotente (parcial→pago) p/ erp_receber e erp_pagar;
 *   7) funções SECURITY DEFINER com REVOKE de PUBLIC/anon e GRANT a authenticated/service_role;
 *   8) rotas (webhook 748 e sync-liquidacao) usam o valor pago pelo banco — nunca o valor do título em silêncio.
 *   npm run gates -- boleto-juros
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const raiz = join(__dirname, '../..')
const dir = join(raiz, 'supabase/migrations')
// A migration do boleto-juros é a que ADICIONA a coluna de reversão (ADD COLUMN ... ajuste_valor_pago_antes).
// Usar só .includes('ajuste_valor_pago_antes') pegava, por ordem reversa, QUALQUER migration posterior que apenas
// CITA a coluna — ex.: a camada semântica do Consultor IA (20261127162010) SELECIONA v.ajuste_valor_pago_antes numa
// view —, apontando o gate para o arquivo errado e reprovando tudo. Casar o ADD COLUMN identifica o arquivo certo.
const arq = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .reverse().find((f) => /ADD COLUMN IF NOT EXISTS\s+ajuste_valor_pago_antes/.test(readFileSync(join(dir, f), 'utf8')))
ok(!!arq, `migration do boleto-juros encontrada (${arq ?? '—'})`)
const sql = arq ? readFileSync(join(dir, arq), 'utf8') : ''
const s = sql.replace(/--[^\n]*/g, '')

// corpo de uma função pelo nome (do CREATE até o fechamento $function$)
const corpo = (nome: string): string => {
  const i = s.indexOf(`FUNCTION public.${nome}(`)
  if (i < 0) return ''
  const ini = s.indexOf('$function$', i)
  const fim = s.indexOf('$function$', ini + 10)
  return ini < 0 || fim < 0 ? '' : s.slice(ini, fim)
}

// 0) coluna de reversão (aditiva) no vínculo
for (const c of ['ajuste_juros_antes', 'ajuste_desconto_antes', 'ajuste_valor_pago_antes'])
  ok(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${c}`).test(s), `conciliacao_vinculo.${c} adicionada`)

// 1) regra única no boleto
const liq = corpo('fn_boleto_liquidar')
ok(liq.length > 0, 'fn_boleto_liquidar presente')
ok(/UPDATE erp_receber SET juros = v_dif/.test(liq), 'fn_boleto_liquidar: diferença positiva vira juros')
ok(/p_valor_pago IS NOT NULL/.test(liq) && /conferir juros na conciliação/.test(liq),
   'fn_boleto_liquidar: sem valor do banco → baixa pelo título e aviso "conferir juros na conciliação"')
ok(/COALESCE\(p_valor_pago, v_receber\.valor\)/.test(liq), 'fn_boleto_liquidar: baixa pelo valor pago do banco (título se ausente)')

// 2) invólucro único para todos os bancos
const liqb = corpo('fn_boleto_liquidar_banco')
ok(/RETURN public\.fn_boleto_liquidar\(/.test(liqb), 'fn_boleto_liquidar_banco é invólucro de fn_boleto_liquidar')

// 3) conciliação soma em valor_pago (usada pela simples e pela agrupada)
const aj = corpo('fn_conciliacao_ajustar_valores')
ok(aj.length > 0, 'fn_conciliacao_ajustar_valores presente')
ok(/v_net\s*:=\s*round\(v_valor_final\s*\+\s*COALESCE\(p_valor_juros,0\)\s*\+\s*COALESCE\(v_multa,0\)\s*-\s*COALESCE\(p_valor_desconto,0\)/.test(aj),
   'ajustar_valores: valor_pago = valor − desconto + juros + multa (regra única)')
ok(/SET\s+valor\s*=\s*v_valor_final[\s\S]*valor_pago\s*=\s*v_net/.test(aj) && (aj.match(/valor_pago\s*=\s*v_net/g)?.length ?? 0) >= 2,
   'ajustar_valores: grava valor_pago (receber e pagar)')
ok(/ajuste_juros_antes = v_juros_antes/.test(aj) && /ajuste_valor_pago_antes = v_pago_antes/.test(aj),
   'ajustar_valores: guarda estado-antes no vínculo (p/ desfazer)')

// fechar_agrupado guarda o estado-antes do âncora
const fechar = corpo('fn_conciliacao_fechar_agrupado')
ok(/ajuste_valor_pago_antes = v_p_antes/.test(fechar), 'fechar_agrupado: guarda estado-antes do âncora no vínculo')

// 4) desfazer restaura
const desf = corpo('fn_conciliacao_desvincular_movimento')
ok(/ajuste_valor_pago_antes IS NOT NULL/.test(desf) &&
   /valor_pago = v_vin\.ajuste_valor_pago_antes/.test(desf) &&
   /juros = v_vin\.ajuste_juros_antes/.test(desf),
   'desvincular: restaura juros/desconto/valor_pago do estado-antes')

// 5) triggers de status recalculam em reconciliação
for (const t of ['trg_status_receber', 'trg_status_pagar']) {
  const re = new RegExp(`CREATE TRIGGER ${t} BEFORE INSERT OR UPDATE OF[^;]*conciliado[^;]*movimento_banco_id`)
  const re2 = new RegExp(`CREATE TRIGGER ${t} BEFORE INSERT OR UPDATE OF[^;]*movimento_banco_id[^;]*conciliado`)
  ok(re.test(s) || re2.test(s), `${t}: UPDATE OF inclui conciliado e movimento_banco_id`)
}

// 6) correção de dado idempotente e segura (conciliado + juros/multa + déficit de valor_pago + PROVA de conciliação), p/ receber e pagar
for (const t of ['erp_receber', 'erp_pagar']) {
  const bloco = s.slice(s.indexOf(`UPDATE public.${t} AS`))
  const corte = bloco.slice(0, bloco.indexOf(';') + 1)
  ok(/conciliado = true/.test(corte) && /COALESCE\([a-z]\.juros,0\) \+ COALESCE\([a-z]\.multa,0\) > 0/.test(corte),
     `correção ${t}: só títulos conciliados com juros/multa`)
  // déficit: valor_pago cobre o principal mas é MENOR que o líquido com juros
  ok(/valor_pago,0\) >= round\([a-z]\.valor - COALESCE\([a-z]\.desconto,0\), 2\) - 0\.01/.test(corte) &&
     /valor_pago,0\) <\s+round\([a-z]\.valor - COALESCE\([a-z]\.desconto,0\) \+ COALESCE\([a-z]\.juros,0\) \+ COALESCE\([a-z]\.multa,0\), 2\) - 0\.01/.test(corte),
     `correção ${t}: só quando valor_pago cobre o principal mas não os juros/multa`)
  // PROVA de conciliação (não inventa pagamento): soma dos vínculos conciliados >= net
  ok(/sum\(v\.valor_vinculado\)[\s\S]*conciliacao_vinculo v JOIN[\s\S]*m\.status = 'conciliado'[\s\S]*>= round\([a-z]\.valor - COALESCE\([a-z]\.desconto,0\) \+ COALESCE\([a-z]\.juros,0\)/.test(corte),
     `correção ${t}: só com prova de que o banco creditou o líquido (vínculos conciliados >= net)`)
}
ok(!/\bDELETE FROM public\.(erp_receber|erp_pagar)\b/.test(s) && !/\bTRUNCATE\b/i.test(s), 'correção não apaga dado de cliente')

// 7) SECURITY DEFINER com REVOKE/GRANT
const defs = [...s.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(([^)]*)\)/g)]
  .map((m) => m[1]).filter((n, i, a) => a.indexOf(n) === i)
for (const f of defs) {
  if (!corpo(f).toUpperCase().includes('SECURITY DEFINER') && !/SECURITY DEFINER/.test(s.slice(s.indexOf(`FUNCTION public.${f}(`), s.indexOf('$function$', s.indexOf(`FUNCTION public.${f}(`))))) continue
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^;]*\\) FROM PUBLIC, anon`).test(s), `${f}: REVOKE de PUBLIC, anon`)
  ok(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^;]*\\) TO authenticated, service_role`).test(s), `${f}: GRANT a authenticated, service_role`)
}

// 8) rotas usam o valor pago pelo banco — nunca o valor do título em silêncio
const sync = readFileSync(join(raiz, 'src/app/api/boleto/sync-liquidacao/route.ts'), 'utf8')
ok(/p_valor_pago:\s*r\.valorPago\s*\?\?\s*null/.test(sync), 'sync-liquidacao: não cai mais em b.valor (manda o valor do banco ou null)')
ok(!/p_valor_pago:\s*r\.valorPago\s*\?\?\s*b\.valor/.test(sync), 'sync-liquidacao: fallback silencioso ao valor do título removido')
const wh = readFileSync(join(raiz, 'src/app/api/banco/sicredi/webhook/route.ts'), 'utf8')
ok(/valorLiquidado\s*\?\?\s*ev\.valorPago\s*\?\?\s*ev\.valor/.test(wh), 'webhook 748: usa valorLiquidado/valorPago do banco')

if (falhas > 0) { console.error(`\n[check-boleto-juros] ${falhas} verificação(ões) falharam`); process.exit(1) }
console.log('\n[check-boleto-juros] OK')
