// Gate P1 (CEO 17/10): o laço de requisições do navegador é cortado. Prova a guarda com um fetch simulado (sem rede).
import { fetchComGuardaDeLaco, criarGuarda, LIMITE_REPETICAO, JANELA_MS, BLOQUEIO_MS } from '../../src/lib/guardaRequisicoes'
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

async function main() {
  let t = 0
  let chamadas = 0
  const avisos: string[] = []
  const base: typeof fetch = async () => { chamadas++; await Promise.resolve(); return new Response('[]', { status: 200 }) }
  const f = fetchComGuardaDeLaco(base, criarGuarda(() => t, (m) => avisos.push(m)))
  const U = 'https://x.supabase.co/rest/v1/user_companies?select=*'

  // laço: a mesma consulta, em sequência, é cortada no limite
  let barradas = 0
  for (let i = 0; i < LIMITE_REPETICAO + 40; i++) { t += 100; const r = await f(U); if (r.status === 429) barradas++ }
  ok(chamadas === LIMITE_REPETICAO, `só ${LIMITE_REPETICAO} chegam ao servidor (chegaram ${chamadas})`)
  ok(barradas === 40, `o resto é barrado (${barradas})`)
  ok(avisos.length === 1 && avisos[0].includes('laço interrompido'), 'avisa uma vez no console')

  // depois do bloqueio volta a funcionar
  t += BLOQUEIO_MS + 1
  ok((await f(U)).status === 200, 'volta ao normal após o bloqueio')

  // uso normal (abrir a tela: poucas consultas) nunca é barrado
  chamadas = 0; t += JANELA_MS * 2
  for (const p of ['users', 'companies', 'company_groups', 'user_companies']) { t += 50; await f(`https://x.supabase.co/rest/v1/${p}?select=*`) }
  ok(chamadas === 4, 'consultas diferentes passam')

  // GETs idênticos simultâneos viram uma ida só; cada chamador lê o seu corpo
  chamadas = 0; t += JANELA_MS * 2
  const rs = await Promise.all([f(U), f(U), f(U)])
  ok(chamadas === 1, `3 GETs idênticos em voo = 1 ida ao servidor (foram ${chamadas})`)
  const corpos = await Promise.all(rs.map((r) => r.text()))
  ok(corpos.every((c) => c === '[]'), 'todos leem o corpo')

  // login/refresh e escrita não passam pela guarda
  chamadas = 0; t += JANELA_MS * 2
  for (let i = 0; i < LIMITE_REPETICAO + 10; i++) { t += 10; await f('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: '{}' }) }
  for (let i = 0; i < LIMITE_REPETICAO + 10; i++) { t += 10; await f('https://x.supabase.co/rest/v1/agency_timesheet', { method: 'POST', body: '{}' }) }
  ok(chamadas === 2 * (LIMITE_REPETICAO + 10), 'token e escrita nunca são cortados')

  // rpc com o mesmo corpo em laço é cortado; corpo diferente não
  chamadas = 0; t += JANELA_MS * 2
  for (let i = 0; i < LIMITE_REPETICAO + 5; i++) { t += 100; await f('https://x.supabase.co/rest/v1/rpc/fn_modulos_sidebar_por_area', { method: 'POST', body: '{"a":1}' }) }
  ok(chamadas === LIMITE_REPETICAO, 'rpc idêntica em laço é cortada')

  const sup = readFileSync('src/lib/supabase.ts', 'utf8')
  ok(sup.includes('fetchComGuardaDeLaco'), 'o cliente Supabase usa a guarda')

  if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
  console.log('\nGuarda de requisições: ok')
}
void main()
