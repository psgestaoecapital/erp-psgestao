// Gate HB2 Calculadora de Obra (fatia 1): motor com regra como dado, prova Tryo (parede 12,5 × 2,8 com porta 0,8 × 2,1),
// pé-direito de 0,05 em 0,05 m sem travar, migration (RLS, sem anon, semente = regra de referência do código).
import { readFileSync, readdirSync } from 'node:fs'
import { calcular, faixaDoPeDireito } from '../../src/lib/hub/calculadoraObra'
import { FORRO_F530, PAREDE_SIMPLES, SISTEMAS_REFERENCIA } from '../../src/lib/hub/calculadoraObraReferencia'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const q = (r: ReturnType<typeof calcular>, cod: string) => r.linhas.find(l => l.codigo === cod)?.quantidade_compra

const p = calcular(PAREDE_SIMPLES, { comprimento: 12.5, altura: 2.8, vaos_m2: 0.8 * 2.1 })
ok(p.ok && p.area_liquida === 33.32, 'parede: área líquida 33,32 m² (35 − 1,68 da porta)')
ok(p.faixa?.bitola === 'M70' && p.faixa.espacamento_mm === 600, 'parede 2,80 m → M70 a 600 mm')
ok(q(p, 'chapa') === 33, 'parede: chapas = ⌈33,32 × 2 × 1,05 ÷ 2,16⌉ = 33')
ok(q(p, 'la') === 35, 'parede: lã = ⌈33,32 × 1,05⌉ = 35')
ok(q(p, 'guia') === 9, 'parede: guias = ⌈12,5 × 2 × 1,05 ÷ 3⌉ = 9')
ok(q(p, 'montante') === 21, 'parede: montantes = ⌈(12,5 ÷ 0,6) × 1,05 × 2,8 ÷ 3⌉ = 21')
ok(q(p, 'parafuso-ppa25') === 8, 'parede: parafusos = 33,32 × 22 = 733 un = 8 centos')
ok(/÷ 2,16/.test(p.linhas[0].conta), '"ver a conta" explica a divisão pela chapa')

const f = calcular(FORRO_F530, { comprimento: 5, altura: 4, perimetro: 18 })
ok(f.ok && q(f, 'chapa') === 10 && q(f, 'tabica') === 7, 'forro F530 5 × 4 m: 10 chapas e tabica pelo perímetro real (18 m → 7 barras)')
ok(calcular(PAREDE_SIMPLES, { comprimento: 12.5, altura: 2.8, parametros: { chapa_m2: 2.88 } }).linhas[0].quantidade_compra === 26, 'tamanho da chapa configurável (1,20 × 2,40)')
ok(!calcular(PAREDE_SIMPLES, { comprimento: 0, altura: 2.8 }).ok, 'entrada zerada → erro claro, sem travar')
ok(!calcular(PAREDE_SIMPLES, { comprimento: 1, altura: 1, vaos_m2: 5 }).ok, 'vãos maiores que a área → erro claro')

for (const s of SISTEMAS_REFERENCIA.filter(x => x.faixas_pe_direito.length)) {
  let buraco = ''
  for (let i = 4; i <= 92; i++) { // 0,20 m a 4,60 m
    const pd = i / 20
    if (!faixaDoPeDireito(s.faixas_pe_direito, pd)) { buraco = String(pd); break }
    const r = calcular(s, { comprimento: 10, altura: pd })
    if (!r.ok || r.linhas.some(l => !(l.quantidade_compra > 0))) { buraco = String(pd); break }
  }
  ok(buraco === '', `${s.codigo}: nenhum pé-direito de 0,20 a 4,60 m (passo 0,05) trava${buraco ? ' — falhou em ' + buraco : ''}`)
}
ok(!calcular(PAREDE_SIMPLES, { comprimento: 5, altura: 6 }).ok, 'pé-direito além da tabela → mensagem, não exceção')

const arq = readdirSync('supabase/migrations').find(x => x.endsWith('_hb2_calculadora_obra_regras.sql'))!
const sql = readFileSync(`supabase/migrations/${arq}`, 'utf8')
ok(/^\d{8}\d{4}05_/.test(arq), 'migration na faixa 05 (gilberto-produto)')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /get_user_company_ids/.test(sql), 'RLS ligada com policy por empresa')
ok(/REVOKE ALL ON public\.erp_calc_regra FROM anon/.test(sql) && /REVOKE INSERT, UPDATE, DELETE/.test(sql), 'sem anon e sem escrita direta')
ok(!/\b(UPDATE|DELETE)\s+(FROM\s+)?public\./i.test(sql.replace(/REVOKE[^;]*;/g, '')), 'sem UPDATE/DELETE em dado')
ok(SISTEMAS_REFERENCIA.every(s => sql.includes(JSON.stringify(s))), 'semente da migration = regras de referência do código (rode scripts/gen-calc-regra-sql.ts)')
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
