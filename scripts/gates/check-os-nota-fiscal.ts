/**
 * Gate de build · chamado #3242 (Jordana · Gean): nas OS entregues, filtro "NF emitida / Falta emitir" e indicador
 * da nota (NF-e de peças / NFS-e de serviços ligadas à OS por os_id), com o "?" (RD-95) cadastrado por migration.
 * Regra em src/lib/oficina/osNotaFiscal.ts.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resumirNotasPorOS, situacaoNotaOS, passaFiltroNotaOS, rotuloNotaOS } from '../../src/lib/oficina/osNotaFiscal'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

// Padrão real da Gean: OS-2026-0247 com NF-e rejeitada + NF-e 659 + NFS-e 134; OS-2026-0228 só com NF-e rejeitada.
const nfe = [
  { os_id: 'os247', status: 'rejeitada', numero: null },
  { os_id: 'os247', status: 'autorizada', numero: '659' },
  { os_id: 'os228', status: 'rejeitada', numero: null },
  { os_id: 'os300', status: 'processando', numero: null },
  { os_id: 'os400', status: 'cancelada', numero: '700' },
  { os_id: null, status: 'autorizada', numero: '999' },
]
const nfse = [{ os_id: 'os247', status: 'autorizada', numero: 134 }]
const m = resumirNotasPorOS(nfe, nfse)
const a = situacaoNotaOS(m, 'os247')
ok(a.situacao === 'emitida' && a.nfe.join() === '659' && a.nfse.join() === '134', 'OS com NF-e e NFS-e autorizadas → emitida com os números')
ok(rotuloNotaOS(a) === '🧾 NF-e 659 · NFS-e 134', 'rótulo mostra as duas notas')
ok(situacaoNotaOS(m, 'os228').situacao === 'rejeitada', 'só tentativa rejeitada → rejeitada')
ok(situacaoNotaOS(m, 'os300').situacao === 'processando', 'nota na SEFAZ → processando')
ok(situacaoNotaOS(m, 'os400').situacao === 'sem_nota', 'nota cancelada não conta como emitida')
ok(situacaoNotaOS(m, 'osXXX').situacao === 'sem_nota', 'OS sem nota → sem_nota')
ok(!m.has('null') && m.size === 4, 'nota sem os_id é ignorada')
ok(passaFiltroNotaOS(a, 'com_nota') && !passaFiltroNotaOS(a, 'falta_emitir'), 'emitida entra em "NF emitida"')
for (const id of ['os228', 'os300', 'os400', 'osXXX'])
  ok(passaFiltroNotaOS(situacaoNotaOS(m, id), 'falta_emitir') && !passaFiltroNotaOS(situacaoNotaOS(m, id), 'com_nota'), `${id} entra em "Falta emitir"`)
ok(passaFiltroNotaOS(situacaoNotaOS(m, 'osXXX'), 'todas'), '"Todas" não filtra')

const tela = readFileSync('src/app/dashboard/os/page.tsx', 'utf8')
// #2167 (complemento): a lista passou a usar as etiquetas de src/lib/oficina/osNotaLista.ts (gate check-os-nf-lista.ts)
ok(tela.includes('data-testid="os-filtro-nota"'), 'filtro de nota da lista tem data-testid')
ok(/<AjudaCampo chave="os\.filtro\.nota_fiscal"/.test(tela), 'filtro novo tem o "?" (RD-95)')
const selo = readFileSync('src/components/comum/OSNotasFiscaisSelo.tsx', 'utf8')
ok(/<AjudaCampo chave="os\.nota_fiscal\.situacao"/.test(selo), 'indicador da ficha tem o "?" (RD-95)')
ok(readFileSync('src/components/comum/OrdemServicoCard.tsx', 'utf8').includes('<OSNotasFiscaisSelo'), 'ficha da OS mostra o indicador')

const migs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8'))
for (const k of ['os.filtro.nota_fiscal', 'os.nota_fiscal.situacao'])
  ok(migs.some((t) => t.includes(`'${k}'`)), `chave ${k} cadastrada em erp_ajuda_campo por migration`)

if (falhas) { console.error(`\n${falhas} falha(s) no gate da NF das OS (#3242)`); process.exit(1) }
console.log('✓ #3242: OS entregues com filtro NF emitida / Falta emitir e indicador na ficha')
