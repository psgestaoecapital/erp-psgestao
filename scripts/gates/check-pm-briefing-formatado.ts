// Gate · P&M briefing formatado (Pdois/Marciana, CEO 07/10). Sem rede. Mantém:
// a) a marcação leve (negrito, itálico, listas, links) vira estrutura para a tela — link só http(s), nunca HTML cru;
// b) o editor tem "Ver formatado"; c) o briefing salvo abre de novo e é salvo (update na empresa);
// d) o job com briefing_id mostra o briefing ligado formatado.
import { readFileSync } from 'node:fs'
import { blocos, trechos, hrefSeguro } from '../../src/lib/pm/markdownLeve'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const ler = (p: string) => readFileSync(p, 'utf8')
const J = (x: unknown) => JSON.stringify(x)

ok(J(trechos('a **forte** b')) === J([{ t: 'texto', v: 'a ' }, { t: 'negrito', v: [{ t: 'texto', v: 'forte' }] }, { t: 'texto', v: ' b' }]), 'a) negrito')
ok(J(trechos('_leve_')) === J([{ t: 'italico', v: [{ t: 'texto', v: 'leve' }] }]) && J(trechos('nome_do_arquivo')) === J([{ t: 'texto', v: 'nome_do_arquivo' }]), 'a) itálico só entre palavras (nome_do_arquivo fica texto)')
ok(J(trechos('[site](https://pdois.com.br)')) === J([{ t: 'link', v: 'site', href: 'https://pdois.com.br' }]), 'a) link https')
ok(trechos('[x](javascript:alert(1))').every((t) => t.t === 'texto') && hrefSeguro('data:text/html,1') === null, 'a) link que não é http(s) fica texto')
ok(trechos('<script>alert(1)</script>').every((t) => t.t === 'texto'), 'a) HTML fica texto')
const bs = blocos('**Entregáveis:**\n- carrossel\n- stories\n\n1. aprovar\n2. postar\nfim')
ok(bs.length === 4 && bs[0].t === 'paragrafo' && bs[1].t === 'lista' && !bs[1].numerada && bs[1].itens.length === 2 && bs[2].t === 'lista' && bs[2].numerada && bs[3].t === 'paragrafo', 'a) parágrafos e listas (com e sem número)')
ok(blocos('').length === 0 && blocos(null).length === 0 && blocos('\n\n').length === 0, 'a) vazio não desenha nada')

const tx = ler('src/components/pm/BriefingTexto.tsx')
ok(!/dangerouslySetInnerHTML/.test(tx) && /rel="noopener noreferrer nofollow"/.test(tx), 'a) BriefingTexto sem HTML cru; link com noopener')
const ed = ler('src/components/pm/BriefingEditor.tsx')
ok(/<BriefingTexto texto=\{value\}/.test(ed) && /`\$\{testid\}-ver`/.test(ed), 'b) editor com "Ver formatado"')
const br = ler('src/app/dashboard/pm/briefings/page.tsx')
ok(/data-testid="briefing-abrir"/.test(br) && /from\('agency_briefings'\)\.update\(\{ \.\.\.campos.*\.eq\('id', editId\)\.eq\('company_id', empresa\)/.test(br), 'c) briefing salvo abre e salva na própria empresa')
const pr = ler('src/app/dashboard/producao/page.tsx')
const li = ler('src/components/pm/BriefingLigado.tsx')
ok(/<BriefingLigado briefingId=/.test(pr) && /briefing_id: j\.briefing_id/.test(pr) && /<BriefingTexto texto=\{briefingParaJob\(b\)\}/.test(li) && /job-briefing-ligado-erro/.test(li), 'd) job mostra o briefing ligado formatado (e diz quando não abre)')

if (falhas) { console.error(`check-pm-briefing-formatado: ${falhas} falha(s)`); process.exit(1) }
console.log('check-pm-briefing-formatado: ok')
