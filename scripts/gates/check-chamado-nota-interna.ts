// Gate (#7050 opção A · jordana-code): a nota interna do chamado é privada ao autor e não move a coluna.
// Prova estática (sem rede/banco) sobre a migration 20261120072020_chamado_nota_interna_7050.sql:
//  1. coluna nota_interna aditiva, default false (nenhuma linha existente muda);
//  2. RLS sugestao_msg_sel esconde nota interna de quem não é da fila de suporte (nota_interna = false);
//  3. fn_sugestao_mensagem_enviar: só a PS marca nota interna; nota interna NÃO aprova resposta;
//     mensagem visível da PS marca resposta_aprovada (→ "Aguardando usuário");
//  4. função sensível com REVOKE anon/PUBLIC e GRANT só a authenticated/service_role (check_fn_guards).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); falhas++ } }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_chamado_nota_interna_7050.sql'))
ok(!!arq, 'migration do #7050 nota interna presente')
const sql = arq ? readFileSync(`${dir}/${arq}`, 'utf8') : ''

// 1) coluna aditiva com default false
ok(/ADD COLUMN IF NOT EXISTS\s+nota_interna\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i.test(sql),
  'coluna nota_interna aditiva, NOT NULL default false')

// 2) RLS esconde nota interna do autor (não-suporte)
const temPolicy = /CREATE POLICY\s+sugestao_msg_sel\s+ON\s+public\.sugestao_mensagem/i.test(sql)
ok(temPolicy, 'policy sugestao_msg_sel recriada')
ok(/fn_pode_ver_fila_suporte\(\)\s*\n?\s*OR\s*\(\s*nota_interna\s*=\s*false/i.test(sql.replace(/\s+/g, ' ').replace(/ /g, ' ')) ||
   /fn_pode_ver_fila_suporte\(\)[\s\S]*OR[\s\S]*nota_interna\s*=\s*false/i.test(sql),
  'RLS: suporte vê tudo; não-suporte só nota_interna = false')

// 3) função: regra da coluna
ok(/p_nota_interna\s+boolean\s+DEFAULT\s+false/i.test(sql), 'fn ganha p_nota_interna (default false)')
ok(/v_nota_interna\s*:=\s*\(\s*v_papel\s*=\s*'ps'\s+AND\s+COALESCE\(p_nota_interna,\s*false\)\s*\)/i.test(sql),
  'só a PS marca nota interna; mensagem do autor sempre visível')
// o ramo de nota interna não aprova resposta (NULL), o ramo visível da PS marca resposta_aprovada = true
ok(/ELSIF\s+v_nota_interna\s+THEN[\s\S]*?NULL;/i.test(sql), 'nota interna: ramo sem aprovar resposta nem notificar')
ok(/ELSE[\s\S]*?UPDATE\s+sugestoes\s+SET[\s\S]*?resposta_aprovada\s*=\s*true/i.test(sql),
  'mensagem visível da PS marca resposta_aprovada = true (→ Aguardando usuário)')

// 4) ACL explícita (RD de guarda de função)
ok(/REVOKE ALL ON FUNCTION public\.fn_sugestao_mensagem_enviar\(uuid, uuid, text, jsonb, boolean\) FROM PUBLIC, anon/i.test(sql),
  'REVOKE anon/PUBLIC na nova assinatura')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_sugestao_mensagem_enviar\(uuid, uuid, text, jsonb, boolean\) TO authenticated, service_role/i.test(sql),
  'GRANT só authenticated/service_role')

if (falhas) { console.error(`check-chamado-nota-interna: ${falhas} falha(s)`); process.exit(1) }
console.log('check-chamado-nota-interna: ok')
