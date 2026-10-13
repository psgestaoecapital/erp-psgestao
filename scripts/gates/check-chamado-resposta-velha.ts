// Gate (defeito do #297, CEO 01/10): mensagem do autor NUNCA leva a "aguardando confirmação" sem resposta NOVA aprovada.
// Antes: o "ainda não resolveu" deixava a resposta já enviada no campo de rascunho; a fila mostrava como "esperando
// você" e "Aprovar e enviar" reenviava a mesma resposta (#297, #116, #339, #587 em 01/10). Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261002110000_chamados_resposta_velha_nao_reenvia.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(/CREATE TRIGGER trg_sugestao_autor_respondeu AFTER INSERT ON public\.sugestao_mensagem\s+FOR EACH ROW WHEN \(NEW\.papel = 'autor'\)/.test(sql),
  'toda mensagem do autor (conversa ou "ainda não resolveu") passa pelo gatilho')
ok(/resposta_aprovada = false/.test(sql) && /THEN NULL ELSE s\.resposta END/.test(sql), 'a resposta já enviada sai do rascunho e "aprovada" é desmarcada')
ok(/m\.papel = 'ps' AND btrim\(m\.texto\) = btrim\(s\.resposta\)/.test(sql), 'só tira do rascunho o texto que JÁ está na conversa (rascunho novo não enviado fica — nada se perde)')
ok(!/DELETE\s+FROM/i.test(sql), 'nada é apagado (RD-30)')
const apr = sql.slice(sql.indexOf('FUNCTION public.fn_sugestao_aprovar_resposta'))
ok(/v_ult_autor > v_enviada_em/.test(apr) && apr.includes("'resposta_ja_enviada'"), 'aprovar recusa resposta já enviada antes da última mensagem do autor')
ok(apr.indexOf("'resposta_ja_enviada'") < apr.indexOf("status = CASE WHEN status IN"), 'a recusa vem antes de mudar o status (nada vai para "aguardando confirmação")')
ok(sql.includes('REVOKE ALL ON FUNCTION public.fn__sugestao_autor_respondeu() FROM PUBLIC, anon, authenticated;'), 'função do gatilho não é chamável pelo cliente')
const tela = readFileSync('src/app/dashboard/atendimento/page.tsx', 'utf8')
ok(tela.includes('r?.mensagem ||'), 'a tela mostra o motivo da recusa em português')

if (falhas) { console.error(`\ncheck-chamado-resposta-velha: ${falhas} falha(s)`); process.exit(1) }
console.log('\nChamados · resposta velha não é reenviada: ok')
