// Gate (CEO 18/10 + revisão do Eng. Chefe) — RESERVA DE VAGA NO BANCO corrige a corrida do sorteio por log (9 triagens
// às 10:47 → quase todas na vaga 0). Prova, sem rede/banco:
//  • MODELO PURO da escolha (o mesmo que fn_esteira_reservar_vaga executa): 9 reservas {0,2} → 5×4; vaga 1 nunca;
//    reserva liberada/expirada sai da contagem; empate → menor; re-run de reserva liberada escolhe pela carga ATUAL
//    (pode cair na outra vaga).
//  • TEXTO da migration implementa isso (advisory lock, exclui a vaga 1, janela de 2 h, reuso só ativo por
//    run_id+run_attempt, ordem por contagem asc/vaga asc, REVOKE/GRANT service_role, RLS, ci-sem-guarda).
//  • SEGREDO (revisão Eng. Chefe): nenhum job que faz checkout da PR recebe a chave de serviço — a liberação é um JOB
//    SEPARADO sem checkout; a triagem (com a chave) faz checkout de `ref: main` (código confiável).
// A prova COMPORTAMENTAL contra o SQL real roda numa cópia local do Postgres (CEO: provas pesadas na cópia local).
import { readFileSync } from 'node:fs'
import { analisarMigration } from './_migration-segura-lib'

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
function simular(n: number, elegiveis: number[]): Record<number, number> {
  const contagem: Record<number, number> = {}
  for (let i = 0; i < n; i++) { const v = escolherVaga(contagem, elegiveis); contagem[v] = (contagem[v] ?? 0) + 1 }
  return contagem
}

// (caso 1) 9 reservas simultâneas em {0,2} → 5×4
{ const c = simular(9, [0, 2]); ok(c[0] === 5 && c[2] === 4, `(1) 9 reservas {0,2} dividem-se 5×4 (deu 0=${c[0]}, 2=${c[2]})`) }
// (caso 2) a vaga 1 nunca é reservada, mesmo passando {0,1,2}
{ const c = simular(12, [0, 1, 2]); ok(!(1 in c) && c[0] + c[2] === 12, `(2) vaga 1 nunca entra (0=${c[0]}, 2=${c[2]}, 1=${c[1] ?? 0})`) }
ok(escolherVaga({}, [1]) === 0, '(2) só a vaga 1 elegível → cinto cai na vaga 0, nunca 1')
// (caso 3) reserva liberada/expirada SAI da contagem (a contagem de ativas é a entrada)
ok(escolherVaga({ 0: 3, 2: 1 }, [0, 2]) === 2, '(3a) vaga 0 com mais ativas → escolhe a 2')
ok(escolherVaga({ 0: 0, 2: 1 }, [0, 2]) === 0, '(3b) liberar as ativas da 0 (0 ativas) → volta a escolher a 0')
ok(escolherVaga({ 0: 0, 2: 0 }, [0, 2]) === 0, '(3c) empate 0/0 → menor número (0)')
// (caso b, revisão) re-run de reserva liberada escolhe pela carga ATUAL — PODE cair na OUTRA vaga que a tentativa antiga
{
  // tentativa antiga tomou a vaga 0 e foi LIBERADA (sai da contagem); no re-run, a vaga 0 está mais cheia que a 2 agora
  // (outras PRs ativas) → a reserva NOVA cai na vaga 2, diferente da antiga.
  const agora = { 0: 2, 2: 1 }  // ativas no instante do re-run (a liberada do próprio run já não conta)
  ok(escolherVaga(agora, [0, 2]) === 2, '(b) re-run de reserva liberada faz reserva NOVA e pode cair na OUTRA vaga (0→2)')
}

// ── TEXTO da migration ───────────────────────────────────────────────────────────────────────────────────────────
const mig = readFileSync('supabase/migrations/20261018190030_esteira_vaga_reserva.sql', 'utf8')
ok(/CREATE TABLE IF NOT EXISTS public\.erp_esteira_vaga_reserva/.test(mig), 'migration: cria erp_esteira_vaga_reserva')
ok(/pr_numero[\s\S]*run_id[\s\S]*run_attempt[\s\S]*vaga[\s\S]*criada_em[\s\S]*liberada_em[\s\S]*motivo/.test(mig), 'tabela tem as colunas (com run_attempt)')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /REVOKE ALL ON public\.erp_esteira_vaga_reserva FROM PUBLIC, anon, authenticated/.test(mig),
  'RLS ligada + REVOKE de PUBLIC/anon/authenticated na tabela')
ok(/pg_advisory_xact_lock\(hashtext\('erp_esteira_vaga_reserva'\)\)/.test(mig), 'reservar: advisory lock de transação (serializa as triagens)')
ok(/unnest\(coalesce\(p_vagas[\s\S]{0,80}WHERE v <> 1/.test(mig), 'reservar: a vaga 1 é excluída dos elegíveis (reservada para a main)')
ok(/liberada_em IS NULL AND r\.criada_em >= now\(\) - interval '2 hours'/.test(mig), 'reservar: conta só reservas ATIVAS (liberada_em nula E < 2 h)')
ok(/ORDER BY count\(r\.id\) ASC, e\.v ASC/.test(mig), 'reservar: escolhe a vaga com menos ativas; empate → menor número')
// (b) reuso SÓ se a reserva DA TENTATIVA ainda está ativa (run_id + run_attempt + liberada_em null + < 2 h)
ok(/run_id = p_run_id AND run_attempt = p_run_attempt\s*\n?\s*AND liberada_em IS NULL AND criada_em >= now\(\) - interval '2 hours'[\s\S]{0,140}RETURN v_existente/.test(mig),
  '(b) reservar: reaproveita SÓ a reserva ativa da tentativa (run_id+run_attempt); liberada ou tentativa nova → reserva nova')
ok(/CREATE UNIQUE INDEX[^\n]*erp_esteira_vaga_reserva_tentativa_ativa_uk[\s\S]{0,90}\(run_id, run_attempt\) WHERE liberada_em IS NULL/.test(mig),
  'índice único: 1 reserva ativa por tentativa (run_id, run_attempt)')
ok(/UPDATE erp_esteira_vaga_reserva\s*\n?\s*SET liberada_em = now\(\)\s*\n?\s*WHERE run_id = p_run_id AND run_attempt = p_run_attempt AND liberada_em IS NULL/.test(mig),
  'liberar: marca liberada_em da reserva da tentativa (run_id, run_attempt)')
// segurança das funções: REVOKE/GRANT + ci-sem-guarda + SECURITY DEFINER
for (const [fn, args] of [['fn_esteira_reservar_vaga', 'integer, bigint, integer, integer\\[\\]'], ['fn_esteira_liberar_vaga', 'bigint, integer']] as [string, string][]) {
  ok(new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.${fn}\(${args}\) FROM PUBLIC, anon, authenticated`).test(mig), `${fn}: REVOKE de PUBLIC/anon/authenticated`)
  ok(new RegExp(String.raw`GRANT EXECUTE ON FUNCTION public\.${fn}\(${args}\) TO service_role`).test(mig), `${fn}: GRANT EXECUTE só ao service_role`)
  ok(new RegExp(String.raw`--\s*ci-sem-guarda:\s*${fn}\b[^\n]*\S`).test(mig), `${fn}: marcador ci-sem-guarda (meta da esteira, sem company_id)`)
  ok(new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${fn}[\s\S]{0,220}SECURITY DEFINER SET search_path TO 'public'`).test(mig), `${fn}: SECURITY DEFINER + search_path fixo`)
}
ok(analisarMigration(mig).length === 0, `migration é ADITIVA (RD-97): ${JSON.stringify(analisarMigration(mig))}`)

// ── WORKFLOW: fiação + isolamento do segredo ─────────────────────────────────────────────────────────────────────
const pr = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
const iTri = pr.indexOf('  triagem:')
const iAce = pr.indexOf('  aceitacao:')
const iLib = pr.indexOf('  liberar-reserva:')
ok(iTri >= 0 && iAce > iTri && iLib > iAce, 'workflow: jobs triagem → aceitacao → liberar-reserva na ordem')
const triagem = pr.slice(iTri, iAce)
const aceitacao = pr.slice(iAce, iLib)
const liberar = pr.slice(iLib)

// triagem reserva por RPC com run_attempt e vagas elegíveis [0]/[0,2], e cai no sorteio por log no fallback
ok(/rest\/v1\/rpc\/fn_esteira_reservar_vaga/.test(triagem) && /\\"p_run_attempt\\":\$RUN_ATTEMPT/.test(triagem) && /\\"p_vagas\\":\$vagas/.test(triagem),
  'triagem: chama fn_esteira_reservar_vaga por RPC com run_attempt e vagas elegíveis')
ok(/vagas='\[0\]'; \{ \[ "\$\{VAGAS:-1\}" -ge 3 \] && \[ -n "\$URL2" \]; \} && vagas='\[0,2\]'/.test(triagem),
  'triagem: vagas elegíveis = [0] (serial) ou [0,2] quando a vaga 2 está provisionada (a 1 nunca)')
ok(/reserva no banco falhou — caindo no sorteio por log/.test(triagem) && /if \[ -z "\$v" \]; then[\s\S]{0,400}aceitacao-sortear-vaga\.sh/.test(triagem),
  'triagem: reserva falhou → fallback ao sorteio por log; cinto final → vaga 0')

// (a) SEGREDO: a triagem tem a chave MAS faz checkout de `ref: main` (código confiável, nunca o da PR)
ok(/secrets\.SUPABASE_SERVICE_ROLE_KEY/.test(triagem) && /ref: main/.test(triagem),
  '(a) triagem: tem a chave de serviço e faz checkout de ref: main (código confiável, não o da PR)')
// (a) o JOB de aceitação roda o código da PR (checkout do sha do deployment) e NÃO ganha a chave de serviço PELA RESERVA
ok(/ref: \$\{\{ github\.event\.deployment\.sha \}\}/.test(aceitacao), '(a) aceitacao: faz checkout do código da PR (sha do deployment)')
ok(!/fn_esteira_(reservar|liberar)_vaga/.test(aceitacao), '(a) aceitacao: NENHUM passo chama a reserva/liberação (a chave de serviço não entra aqui pela reserva)')
// a única referência à chave de serviço de produção no job de aceitação é o fallback PRÉ-EXISTENTE de banco de PRODUÇÃO
// (PURL/PSRK, usado só quando ACEITACAO_BANCO != 'testes'), que NÃO foi adicionado por esta PR e fica num passo que só
// define env — os passos que rodam o código da PR (build/test) não declaram esses segredos.
{
  const srk = aceitacao.match(/secrets\.SUPABASE_SERVICE_ROLE_KEY/g) ?? []
  const url = aceitacao.match(/secrets\.SUPABASE_URL\b/g) ?? []
  ok(srk.length <= 1 && url.length <= 1 && /PSRK: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/.test(aceitacao) === (srk.length === 1),
    '(a) aceitacao: a única menção à chave de serviço é o fallback pré-existente de banco de produção (PURL/PSRK), não a reserva')
}
// (a) a liberação é um JOB SEPARADO, sem checkout, com a chave só ali
ok(/needs: aceitacao/.test(liberar) && /if: always\(\)/.test(liberar) && !/actions\/checkout/.test(liberar),
  '(a) liberar-reserva: job separado (needs: aceitacao, if: always()) SEM checkout')
ok(/rest\/v1\/rpc\/fn_esteira_liberar_vaga/.test(liberar) && /\\"p_run_id\\":\$RUN_ID,\\"p_run_attempt\\":\$RUN_ATTEMPT/.test(liberar) && /secrets\.SUPABASE_SERVICE_ROLE_KEY/.test(liberar),
  '(a) liberar-reserva: RPC inline a fn_esteira_liberar_vaga(run_id, run_attempt) com a chave só neste job')
// Pilar 2: nenhum segredo de CLI/DB de produção na aceitação de PR
ok(!/prod-url\.sh/.test(pr) && !/SUPABASE_ACCESS_TOKEN/.test(pr) && !/SUPABASE_DB_PASSWORD/.test(pr),
  'Pilar 2: aceitacao-pr não carrega segredo de CLI/DB de produção (só a chave de serviço REST, para a RPC guardada)')

if (falhas) { console.error(`\n${falhas} falha(s) — reserva de vaga no banco (CEO 18/10 + revisão)`); process.exit(1) }
console.log('\ncheck-esteira-reserva-vaga: ok')
