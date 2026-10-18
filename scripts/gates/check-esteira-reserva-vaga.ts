// Gate (CEO 18/10) — RESERVA DE VAGA NO BANCO corrige a corrida do sorteio por log (9 triagens às 10:47 → quase todas na
// vaga 0). Prova, sem rede/banco:
//  • o MODELO PURO da escolha (o mesmo que a função SQL fn_esteira_reservar_vaga executa): 9 reservas {0,2} → 5×4; a
//    vaga 1 nunca entra; reserva liberada/expirada não conta (a contagem só tem ativas); empate → menor.
//  • o TEXTO da migration implementa exatamente isso (advisory lock, exclui a vaga 1, janela de 2 h, liberada_em nula,
//    ordem por contagem asc/vaga asc, REVOKE/GRANT service_role, RLS, ci-sem-guarda, liberar marca liberada_em).
//  • a TRIAGEM chama a reserva por RPC e cai no sorteio por log se falhar; o job de aceitação libera no fim (if: always()).
// A prova COMPORTAMENTAL contra o SQL real roda numa cópia local do Postgres (CEO: provas pesadas na cópia local).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// ── MODELO PURO da escolha (espelha o SQL: exclui a vaga 1; menor contagem de ativas; empate → menor número) ──────────
export function escolherVaga(ativasPorVaga: Record<number, number>, vagasElegiveis: number[]): number {
  const elegiveis = [...new Set(vagasElegiveis)].filter((v) => v !== 1).sort((a, b) => a - b)
  const cand = elegiveis.length ? elegiveis : [0]
  let best = cand[0]
  for (const v of cand) if ((ativasPorVaga[v] ?? 0) < (ativasPorVaga[best] ?? 0)) best = v
  return best
}
// simula N reservas sequenciais (cada triagem já vê a reserva da anterior — é o que o advisory lock garante no SQL)
function simular(n: number, elegiveis: number[]): Record<number, number> {
  const contagem: Record<number, number> = {}
  for (let i = 0; i < n; i++) { const v = escolherVaga(contagem, elegiveis); contagem[v] = (contagem[v] ?? 0) + 1 }
  return contagem
}

// (caso 1) 9 reservas simultâneas em {0,2} → 5×4
{
  const c = simular(9, [0, 2])
  ok(c[0] === 5 && c[2] === 4, `(1) 9 reservas {0,2} dividem-se 5×4 (deu 0=${c[0]}, 2=${c[2]})`)
}
// (caso 2) a vaga 1 nunca é reservada, mesmo passando {0,1,2}
{
  const c = simular(12, [0, 1, 2])
  ok(!(1 in c) && c[0] + c[2] === 12, `(2) vaga 1 nunca entra (0=${c[0]}, 2=${c[2]}, 1=${c[1] ?? 0})`)
  ok(escolherVaga({}, [1]) === 0, '(2) só a vaga 1 elegível → cinto cai na vaga 0, nunca 1')
}
// (caso 3) reserva liberada/expirada SAI da contagem (a contagem de ativas é a entrada; menos ativas → é escolhida)
{
  ok(escolherVaga({ 0: 3, 2: 1 }, [0, 2]) === 2, '(3a) vaga 0 com mais ativas → escolhe a 2')
  ok(escolherVaga({ 0: 0, 2: 1 }, [0, 2]) === 0, '(3b) liberar as ativas da 0 (0 ativas) → volta a escolher a 0')
  ok(escolherVaga({ 0: 0, 2: 0 }, [0, 2]) === 0, '(3c) empate 0/0 → menor número (0)')
}

// ── TEXTO da migration ───────────────────────────────────────────────────────────────────────────────────────────
const mig = readFileSync('supabase/migrations/20261018190030_esteira_vaga_reserva.sql', 'utf8')
ok(/CREATE TABLE IF NOT EXISTS public\.erp_esteira_vaga_reserva/.test(mig), 'migration: cria erp_esteira_vaga_reserva')
ok(/pr_numero[\s\S]*run_id[\s\S]*vaga[\s\S]*criada_em[\s\S]*liberada_em[\s\S]*motivo/.test(mig), 'tabela tem as colunas do CEO')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.erp_esteira_vaga_reserva FROM PUBLIC, anon, authenticated/.test(mig),
  'RLS ligada + REVOKE de PUBLIC/anon/authenticated na tabela')
ok(/pg_advisory_xact_lock\(hashtext\('erp_esteira_vaga_reserva'\)\)/.test(mig), 'reservar: advisory lock de transação (serializa as triagens)')
ok(/unnest\(coalesce\(p_vagas[\s\S]{0,80}WHERE v <> 1/.test(mig), 'reservar: a vaga 1 é excluída dos elegíveis (reservada para a main)')
ok(/liberada_em IS NULL AND r\.criada_em >= now\(\) - interval '2 hours'/.test(mig), 'reservar: conta só reservas ATIVAS (liberada_em nula E < 2 h)')
ok(/ORDER BY count\(r\.id\) ASC, e\.v ASC/.test(mig), 'reservar: escolhe a vaga com menos ativas; empate → menor número')
ok(/run_id = p_run_id AND liberada_em IS NULL[\s\S]{0,120}RETURN v_existente/.test(mig), 'reservar: idempotente (re-run do mesmo run devolve a mesma vaga)')
ok(/CREATE UNIQUE INDEX[^\n]*erp_esteira_vaga_reserva_run_ativa_uk[\s\S]{0,80}WHERE liberada_em IS NULL/.test(mig), 'índice único: 1 reserva ativa por run')
ok(/UPDATE erp_esteira_vaga_reserva\s*\n?\s*SET liberada_em = now\(\)\s*\n?\s*WHERE run_id = p_run_id AND liberada_em IS NULL/.test(mig), 'liberar: marca liberada_em da reserva do run')
// segurança: REVOKE/GRANT das funções + ci-sem-guarda (guarda de funções)
for (const fn of ['fn_esteira_reservar_vaga', 'fn_esteira_liberar_vaga']) {
  ok(new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.${fn}\([^)]*\) FROM PUBLIC, anon, authenticated`).test(mig), `${fn}: REVOKE de PUBLIC/anon/authenticated`)
  ok(new RegExp(String.raw`GRANT EXECUTE ON FUNCTION public\.${fn}\([^)]*\) TO service_role`).test(mig), `${fn}: GRANT EXECUTE só ao service_role`)
  ok(new RegExp(String.raw`--\s*ci-sem-guarda:\s*${fn}\b[^\n]*\S`).test(mig), `${fn}: marcador ci-sem-guarda (meta da esteira, sem company_id)`)
  ok(new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${fn}[\s\S]{0,200}SECURITY DEFINER SET search_path TO 'public'`).test(mig), `${fn}: SECURITY DEFINER + search_path fixo`)
}
// aditiva (migration-segura): nenhum DROP/DELETE/UPDATE de objeto/tabela existente no NÍVEL do arquivo
import { analisarMigration } from './_migration-segura-lib'
ok(analisarMigration(mig).length === 0, `migration é ADITIVA (RD-97): ${JSON.stringify(analisarMigration(mig))}`)

// ── TRIAGEM + liberação no workflow ──────────────────────────────────────────────────────────────────────────────
const pr = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
ok(/rest\/v1\/rpc\/fn_esteira_reservar_vaga/.test(pr) && /\\"p_vagas\\":\$vagas/.test(pr),
  'triagem: chama fn_esteira_reservar_vaga por RPC com as vagas elegíveis')
ok(/vagas='\[0\]'; \{ \[ "\$\{VAGAS:-1\}" -ge 3 \] && \[ -n "\$URL2" \]; \} && vagas='\[0,2\]'/.test(pr),
  'triagem: vagas elegíveis = [0] (serial) ou [0,2] quando a vaga 2 está provisionada (a 1 nunca)')
ok(/SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/.test(pr) && /SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/.test(pr),
  'triagem: usa a chave de serviço de produção da esteira (RPC guardada, sem dado de cliente)')
// fallback ao sorteio por log quando a reserva falha
ok(/reserva no banco falhou — caindo no sorteio por log/.test(pr),
  'triagem: reserva falhou → notice de fallback para o sorteio por log')
ok(/if \[ -z "\$v" \]; then[\s\S]{0,400}aceitacao-sortear-vaga\.sh/.test(pr), 'triagem: o sorteio por log (fallback) só roda se a reserva não deu vaga; cinto final → vaga 0')
// liberação no fim do job de aceitação (sempre), chave de serviço só nesse passo
ok(/- name: Liberar a reserva de vaga no banco \(sempre\)\s*\n\s*if: always\(\)/.test(pr), 'aceitação: passo de liberação roda sempre (if: always())')
ok(/rest\/v1\/rpc\/fn_esteira_liberar_vaga/.test(pr) && /\\"p_run_id\\":\$RUN_ID/.test(pr), 'aceitação: libera a reserva do run por RPC')
// Pilar 2: nenhum segredo de CLI/DB de produção entra na aceitação de PR
ok(!/prod-url\.sh/.test(pr) && !/SUPABASE_ACCESS_TOKEN/.test(pr) && !/SUPABASE_DB_PASSWORD/.test(pr),
  'Pilar 2: aceitacao-pr não carrega segredo de CLI/DB de produção (só a chave de serviço REST, para a RPC guardada)')

if (falhas) { console.error(`\n${falhas} falha(s) — reserva de vaga no banco (CEO 18/10)`); process.exit(1) }
console.log('\ncheck-esteira-reserva-vaga: ok')
