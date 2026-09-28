/**
 * Gate de build (IBPT por empresa): leitura da resposta da API "De Olho no Imposto" conforme a especificação
 * oficial (deolhonoimposto.ibpt.org.br/Content/apideolhonoimposto.json) — campos Codigo, UF, EX, Descricao, Nacional,
 * Importado, Estadual, Municipal, Tipo, VigenciaInicio, VigenciaFim, Chave, Versao, Fonte. Quebra o build se regredir.
 *   tsx scripts/check-ibpt-empresa.ts
 */
import { normalizarRespostaIbpt, dataIbptIso } from '../src/lib/fiscal/ibptEmpresa'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const lista = [{ Codigo: '27101932', UF: 'SC', EX: 0, Descricao: 'Oleo', Nacional: 13.45, Importado: 18.1, Estadual: 17, Municipal: 0,
  Tipo: '0', VigenciaInicio: '20/08/2026', VigenciaFim: '31/10/2026', Chave: 'ABC', Versao: '26.2.B', Fonte: 'IBPT' }]
const r = normalizarRespostaIbpt(lista)
ok(!!r && r.nacional === 13.45 && r.importado === 18.1 && r.estadual === 17 && r.municipal === 0, 'lista oficial → percentuais lidos')
ok(r?.versao === '26.2.B' && r?.vigenciaFim === '2026-10-31' && r?.vigenciaInicio === '2026-08-20', 'versão e vigência (dd/mm/aaaa → ISO)')
ok(normalizarRespostaIbpt(lista[0])?.codigo === '27101932', 'objeto único também é aceito')
ok(normalizarRespostaIbpt([]) === null && normalizarRespostaIbpt(null) === null, 'lista vazia/nula → sem dado (usa a genérica)')
ok(normalizarRespostaIbpt([{ Codigo: '1', UF: 'SC' }]) === null, 'sem nenhum percentual → sem dado (nunca inventa zero)')
ok(dataIbptIso('2026-10-31T00:00:00') === '2026-10-31' && dataIbptIso('') === null && dataIbptIso('lixo') === null, 'datas ISO e inválidas')

if (falhas) { console.error(`\n[check-ibpt-empresa] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-ibpt-empresa] leitura da resposta do IBPT conferida.')
