// Gate (HB0, auditor F10 em /dashboard/projetos/tabelas-preco) — a tela mostra o contrato completo (faixas × condições,
// preço por célula e código do item no cliente), o preço de cada célula sai da MESMA regra da calculadora
// (src/lib/hub/tabelaPreco.ts), "normal" não aparece duas vezes e erro do banco nunca vai cru para a tela. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { precoUnitario, type ItemFaixa } from '../../src/lib/hub/tabelaPreco'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── regra das células, com os números da semente DEMO (contrato Residencial Vista Verde) ──
const forro: ItemFaixa[] = [
  { faixa_de: 0, faixa_ate: 100, preco_base: 98 },
  { faixa_de: 100, faixa_ate: 300, preco_base: 92 },
  { faixa_de: 300, faixa_ate: null, preco_base: 86.5 },
]
const celula = (f: ItemFaixa, cond: Parameters<typeof precoUnitario>[2]) => precoUnitario([f], f.faixa_de, cond)
ok(celula(forro[1], null) === 92, 'célula normal = preço base da faixa (100–300 → 92,00)')
ok(celula(forro[1], { condicao: 'noturno', percentual: 20 }) === 110.4, 'célula noturno +20% (92 → 110,40)')
ok(celula(forro[2], { condicao: 'domingo', percentual: 50, preco_fixo: 135 }) === 135, 'preço fixo da condição substitui o adicional (135,00)')
ok(celula(forro[2], null) === 86.5, 'faixa sem teto entra na grade (300 em diante → 86,50)')
ok(forro.every(f => celula(f, null) === precoUnitario(forro, f.faixa_de, null)), 'célula da grade = calculadora na quantidade inicial da faixa')

// ── tela ──
const TELA = 'src/app/dashboard/projetos/tabelas-preco/page.tsx'
const src = readFileSync(TELA, 'utf8')
ok(src.includes('data-testid="tp-contrato"') && src.includes('data-testid="tp-celula"'), 'tela mostra o contrato completo com células clicáveis')
ok(/precoUnitario\(\[f\]/.test(src), 'preço da célula usa precoUnitario (mesma regra da calculadora)')
ok(src.includes('tp-codigo-externo'), 'código do item no cliente aparece no contrato')
ok(/filter\(x => x\.condicao !== 'normal'\)/.test(src), '"normal" não se repete na lista de condições')
ok(/overflowX: 'auto'/.test(src), 'grade rola dentro do cartão no celular (página não rola de lado)')
ok(src.includes('@/lib/erroAmigavel') && !/setErro\([^)]*\.message\b/.test(src), 'erro do banco passa por erroAmigavel, nunca .message cru')
ok(/i\.error \?\? c\.error \?\? k\.error/.test(src), 'falha ao abrir itens/condições/códigos é mostrada, não engolida')

// preço de tabela mostra centavos (o @pos #810 pegou "R$ 23" no lugar de R$ 22,50: o fmtR do painel arredonda)
ok(!src.includes("from '@/lib/psgc-tokens'") && /style: 'currency', currency: 'BRL'/.test(src), 'preço com centavos (sem o fmtR que arredonda)')
ok((15 * 1.5).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ') === 'R$ 22,50', '15 × 1,5 aparece como R$ 22,50')

// ── "?" das áreas novas existe em migration (RD-95) ──
const mig = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const chave of ['hub.tabela_preco.vigencia', 'hub.tabela_preco.contrato']) {
  ok(src.includes(`chave="${chave}"`) && mig.includes(`'${chave}'`), `"?" ${chave} na tela e no banco`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-tabela-preco-contrato`); process.exit(1) }
console.log('\ncheck-hub-tabela-preco-contrato: verde')
