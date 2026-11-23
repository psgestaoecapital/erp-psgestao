// Gate (#7050 fatia2 · jordana-code) — fiação FRONT da nota interna do chamado.
// A migration *_chamado_nota_interna_7050.sql (coberta por check-chamado-nota-interna.ts) deu à RPC
// fn_sugestao_mensagem_enviar o parâmetro p_nota_interna. Este gate prova, de forma estática (sem rede/banco),
// que o compositor da conversa (ConversaChamado.tsx) usa esse parâmetro com segurança:
//  1. o toggle "Nota interna" só aparece para a equipe PS (ehSuporte) — o autor nunca marca nota interna;
//  2. a chamada da RPC envia p_nota_interna, e NUNCA true quando não é a equipe PS (ehSuporte ? ... : false);
//  3. a conversa carrega a coluna nota_interna (para o rótulo da mensagem só-equipe);
//  4. o controle tem "?" (RD-95) e a chave de ajuda está semeada por migration aditiva.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (cond) console.log(`  ✓ ${msg}`); else { console.error(`  ✗ ${msg}`); falhas++ } }

const comp = readFileSync('src/components/melhorias/ConversaChamado.tsx', 'utf8')

// 1) toggle gated por ehSuporte
ok(/\{ehSuporte && \([\s\S]*?data-testid="toggle-nota-interna"/.test(comp),
  'toggle "Nota interna" só renderiza para a equipe PS (ehSuporte)')

// 2) RPC recebe p_nota_interna e nunca manda true fora da equipe PS
ok(/fn_sugestao_mensagem_enviar[\s\S]*?p_nota_interna:\s*ehSuporte \? notaInterna : false/.test(comp),
  'RPC envia p_nota_interna = ehSuporte ? notaInterna : false (não-PS nunca marca nota interna)')

// 3) carrega a coluna nota_interna
ok(/\.select\('[^']*nota_interna[^']*'\)/.test(comp), 'carregar() seleciona nota_interna da sugestao_mensagem')

// 4) RD-95: o "?" do controle e a chave semeada por migration
ok(/chave="chamados\.conversa\.nota_interna"/.test(comp), 'AjudaCampo "?" no controle (chave chamados.conversa.nota_interna)')
const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_ajuda_nota_interna_chamado_7050.sql'))
ok(!!arq, 'migration aditiva que semeia a chave de ajuda presente')
const sql = arq ? readFileSync(`${dir}/${arq}`, 'utf8') : ''
ok(/INSERT INTO public\.erp_ajuda_campo[\s\S]*chamados\.conversa\.nota_interna/.test(sql)
  && /WHERE NOT EXISTS/i.test(sql),
  'seed idempotente (INSERT … WHERE NOT EXISTS) da chave de ajuda')

if (falhas) { console.error(`check-chamado-nota-interna-front: ${falhas} falha(s)`); process.exit(1) }
console.log('check-chamado-nota-interna-front: ok')
