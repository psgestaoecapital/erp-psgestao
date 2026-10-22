// Gate (Eng. Chefe 18/10) — ferramenta do Code-Auditor para FECHAR O CICLO do PDCA (fn_auditor_fechar_achado).
// Prova estática de que a RPC mantém as travas de segurança (RD-97) e não pode fechar chamado de cliente:
//   • SECURITY DEFINER com search_path fixo;
//   • guarda de acesso (serviço/service_role/PS_ADMIN) — nunca usuário comum/anon;
//   • TRAVA de escopo: só interno=true E is_demo=true (chamado de cliente/empresa real fica de fora);
//   • fechamento HONESTO: confirmado_pelo_autor=false e encerrado_sem_confirmacao=true;
//   • exige a PR que corrigiu (pr_obrigatorio);
//   • anon sem EXECUTE (REVOKE … FROM PUBLIC, anon);
//   • ADITIVA: sem DROP/DELETE/TRUNCATE/UPDATE fora do corpo da própria função.
// Rodar local: `npm run gates -- auditor-fechar-achado`.
import { readFileSync, existsSync } from 'node:fs'
import { analisarMigration } from './_migration-segura-lib'

const MIG = 'supabase/migrations/20261018130055_auditor_fechar_achado.sql'
let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(existsSync(MIG), `migration existe: ${MIG}`)
const sql = existsSync(MIG) ? readFileSync(MIG, 'utf8') : ''
const semComentario = sql.replace(/--.*$/gm, '')

ok(/CREATE OR REPLACE FUNCTION public\.fn_auditor_fechar_achado\(/.test(sql), 'cria fn_auditor_fechar_achado')
ok(/SECURITY DEFINER/.test(sql) && /SET search_path TO 'public'/.test(sql), 'SECURITY DEFINER com search_path fixo')
ok(/request\.jwt\.claims/.test(sql) && /service_role/.test(sql) && /PS_ADMIN/.test(sql) && /42501/.test(sql),
  'guarda de acesso: serviço/service_role/PS_ADMIN, levanta 42501 para o resto')
ok(/r\.interno AND coalesce\(r\.is_demo, false\)/.test(sql) && /fora_de_escopo/.test(sql),
  'TRAVA de escopo: só achado interno em empresa DEMO (chamado de cliente fica fora)')
ok(/confirmado_pelo_autor = false/.test(sql) && /encerrado_sem_confirmacao = true/.test(sql),
  'fechamento honesto: não finge confirmação do autor')
ok(/pr_obrigatorio/.test(sql), 'exige a PR que corrigiu o achado')
ok(/REVOKE ALL ON FUNCTION public\.fn_auditor_fechar_achado\([^)]*\) FROM PUBLIC, anon/.test(sql), 'REVOKE de PUBLIC e anon')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_auditor_fechar_achado\([^)]*\) TO authenticated, service_role/.test(sql),
  'GRANT EXECUTE só para authenticated e service_role')
ok(analisarMigration(sql).length === 0, 'migration ADITIVA (sem operação destrutiva no arquivo)')
// o corpo da função atualiza sugestoes (achado), mas é corpo de função (não roda no arquivo) e nunca toca dado de cliente
ok(!/\b(DROP|TRUNCATE)\b/i.test(semComentario), 'sem DROP/TRUNCATE no arquivo')

process.exit(falhas ? 1 : 0)
