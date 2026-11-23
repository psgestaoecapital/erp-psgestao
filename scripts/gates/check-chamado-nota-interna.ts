// Gate (#7050 opção A · jordana-code): a nota interna do chamado é privada ao autor e a coluna "Aguardando usuário"
// usa um sinal DEDICADO (aguardando_usuario), sem reusar resposta_aprovada — senão uma mensagem visível vazaria o
// rascunho interno ao autor e sumiria o chamado da fila de aprovação (bloqueador LGPD do AJUSTES 20/11).
// Prova estática (sem rede/banco) sobre a migration *_chamado_nota_interna_7050.sql + kanban.ts:
//  1. coluna nota_interna aditiva, default false (nenhuma linha existente muda);
//  2. RLS sugestao_msg_sel esconde nota interna de quem não é da fila de suporte (nota_interna = false);
//  3. sinal dedicado aguardando_usuario aditivo; a mensagem VISÍVEL da PS marca aguardando_usuario (NÃO
//     resposta_aprovada); nota interna não notifica nem muda a coluna; o retorno do autor zera aguardando_usuario;
//  4. a view v_sugestao_fila expõe aguardando_usuario e o Kanban (kanban.ts) lê esse sinal;
//  5. função sensível com REVOKE anon/PUBLIC e GRANT só a authenticated/service_role (check_fn_guards).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); falhas++ } }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_chamado_nota_interna_7050.sql'))
ok(!!arq, 'migration do #7050 nota interna presente')
const sql = arq ? readFileSync(`${dir}/${arq}`, 'utf8') : ''

// 1) coluna nota_interna aditiva com default false
ok(/ADD COLUMN IF NOT EXISTS\s+nota_interna\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i.test(sql),
  'coluna nota_interna aditiva, NOT NULL default false')

// 1.1) sinal dedicado aguardando_usuario aditivo com default false
ok(/ADD COLUMN IF NOT EXISTS\s+aguardando_usuario\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i.test(sql),
  'coluna aguardando_usuario aditiva, NOT NULL default false')

// 2) RLS esconde nota interna do autor (não-suporte)
const temPolicy = /CREATE POLICY\s+sugestao_msg_sel\s+ON\s+public\.sugestao_mensagem/i.test(sql)
ok(temPolicy, 'policy sugestao_msg_sel recriada')
ok(/fn_pode_ver_fila_suporte\(\)[\s\S]*OR[\s\S]*nota_interna\s*=\s*false/i.test(sql),
  'RLS: suporte vê tudo; não-suporte só nota_interna = false')

// 3) função: regra da coluna via sinal dedicado
ok(/p_nota_interna\s+boolean\s+DEFAULT\s+false/i.test(sql), 'fn ganha p_nota_interna (default false)')
ok(/v_nota_interna\s*:=\s*\(\s*v_papel\s*=\s*'ps'\s+AND\s+COALESCE\(p_nota_interna,\s*false\)\s*\)/i.test(sql),
  'só a PS marca nota interna; mensagem do autor sempre visível')
// o ramo de nota interna não notifica nem muda a coluna
ok(/ELSIF\s+v_nota_interna\s+THEN[\s\S]*?NULL;/i.test(sql), 'nota interna: ramo sem notificar nem mover a coluna')
// o ramo VISÍVEL da PS marca aguardando_usuario = true
ok(/ELSE[\s\S]*?UPDATE\s+sugestoes\s+SET[\s\S]*?aguardando_usuario\s*=\s*true/i.test(sql),
  'mensagem visível da PS marca aguardando_usuario = true (→ Aguardando usuário)')
// BLOQUEADOR LGPD: o ramo visível da PS NÃO pode tocar resposta_aprovada (revelaria rascunho interno)
const ramoVisivel = (sql.split(/ELSIF\s+v_nota_interna\s+THEN/i)[1] || '').split(/ELSE/i)[1] || ''
ok(ramoVisivel.length > 0 && !/resposta_aprovada\s*=\s*true/i.test(ramoVisivel),
  'mensagem visível da PS NÃO marca resposta_aprovada (não vaza rascunho interno)')
// retorno do autor zera aguardando_usuario (gatilho) → volta para "Em andamento"
ok(/fn__sugestao_autor_respondeu[\s\S]*?aguardando_usuario\s*=\s*false/i.test(sql),
  'trg_sugestao_autor_respondeu zera aguardando_usuario no retorno do autor')

// 4) a view expõe o sinal e o Kanban lê o sinal dedicado
ok(/CREATE OR REPLACE VIEW\s+public\.v_sugestao_fila[\s\S]*?s\.aguardando_usuario/i.test(sql),
  'v_sugestao_fila expõe aguardando_usuario')
const kanban = readFileSync('src/lib/melhorias/kanban.ts', 'utf8')
ok(/aguardando_usuario:\s*boolean/i.test(kanban), 'kanban.ts: ChamadoKanban tem aguardando_usuario')
ok(/\(\s*c\.aguardando_usuario\s*\|\|\s*c\.resposta_aprovada\s*\)\s*&&\s*!c\.confirmado_pelo_autor/i.test(kanban),
  'kanban.ts: coluna "aguardando" lê aguardando_usuario OU resposta_aprovada')

// 5) ACL explícita (RD de guarda de função)
ok(/REVOKE ALL ON FUNCTION public\.fn_sugestao_mensagem_enviar\(uuid, uuid, text, jsonb, boolean\) FROM PUBLIC, anon/i.test(sql),
  'REVOKE anon/PUBLIC na nova assinatura')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_sugestao_mensagem_enviar\(uuid, uuid, text, jsonb, boolean\) TO authenticated, service_role/i.test(sql),
  'GRANT só authenticated/service_role')

if (falhas) { console.error(`check-chamado-nota-interna: ${falhas} falha(s)`); process.exit(1) }
console.log('check-chamado-nota-interna: ok')
