// Gate #1736 (FC Pisos · Banco do Brasil): conector BB — OAuth + teste de conexão + extrato. Regras puras + travas
// do código. Roda no build. Sem rede, sem banco.
import { readFileSync } from 'node:fs'
import { faltasCredencialBb, obterToken, BB_HOSTS, BB_SCOPE_EXTRATO } from '../../src/lib/banco/bb'
import { semDv, dataBb, isoDeBb, ehLinhaDeSaldo, blocosMensaisBb, normalizarLancamentosBb } from '../../src/lib/banco/extrato/bb'
import { getExtratoAdapter } from '../../src/lib/banco/extrato'
import { temConectorExtrato } from '../../src/lib/banco/extratoConector'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

async function main() {
  // 1) credencial: diz o que falta antes de chamar o banco
  ok(faltasCredencialBb({ client_id: 'a', client_secret: 'b', app_key: 'c' }).length === 0, 'credencial completa ⇒ nada falta')
  ok(faltasCredencialBb({ client_id: 'a', client_secret: '', app_key: ' ' }).join('|') === 'Client Secret|Chave da aplicação (gw-dev-app-key)',
    'falta client_secret e gw-dev-app-key ⇒ nomeia os dois')
  let msg = ''
  try { await obterToken({ client_id: 'x', client_secret: '', app_key: '', ambiente: 'homologacao' }) } catch (e) { msg = (e as Error).message }
  ok(/credencial incompleta/.test(msg), 'obterToken sem segredo falha ANTES da rede, com mensagem clara')
  ok(BB_SCOPE_EXTRATO === 'extrato-info', 'teste de conexão usa o escopo de LEITURA do extrato')
  ok(BB_HOSTS.producao.oauth === 'oauth.bb.com.br' && BB_HOSTS.homologacao.oauth === 'oauth.hm.bb.com.br', 'hosts OAuth produção/homologação')

  // 2) formatos do BB
  ok(semDv('1505-2') === '1505' && semDv('0001505') === '1505' && semDv('12.345-X') === '12345', 'agência/conta sem DV e sem zeros à esquerda')
  ok(dataBb('2026-01-01') === '1012026' && dataBb('2026-10-15') === '15102026', 'data → DDMMAAAA numérico (dia sem zero à esquerda)')
  ok(isoDeBb(1012026) === '2026-01-01' && isoDeBb('15102026') === '2026-10-15' && isoDeBb(0) === '', 'DDMMAAAA → ISO; 0 ⇒ vazio')
  const blocos = blocosMensaisBb({ begin: '2026-09-20', end: '2026-11-05' })
  ok(JSON.stringify(blocos) === JSON.stringify([
    { begin: '2026-09-20', end: '2026-09-30' }, { begin: '2026-10-01', end: '2026-10-31' }, { begin: '2026-11-01', end: '2026-11-05' },
  ]), 'janela quebrada em blocos mensais')

  // 3) normalização: saldo fica de fora, sinal C/D, idempotência
  const linhas: Record<string, unknown>[] = [
    { dataLancamento: 0, textoDescricaoHistorico: 'Saldo Anterior', valorLancamento: 1000, indicadorSinalLancamento: 'C' },
    { dataLancamento: 1102026, textoDescricaoHistorico: 'Pix - Recebido', textoInformacaoComplementar: '01/10 10:00 CLIENTE', valorLancamento: 250.5, indicadorSinalLancamento: 'C', numeroDocumento: 123, codigoHistorico: 821, numeroLote: 9903 },
    { dataLancamento: 1102026, textoDescricaoHistorico: 'Tarifa', valorLancamento: 12, indicadorSinalLancamento: 'D', numeroDocumento: 0, codigoHistorico: 170, numeroLote: 1 },
    { dataLancamento: 1102026, textoDescricaoHistorico: 'Tarifa', valorLancamento: 12, indicadorSinalLancamento: 'D', numeroDocumento: 0, codigoHistorico: 170, numeroLote: 1 },
    { dataLancamento: 1102026, textoDescricaoHistorico: 'S A L D O', valorLancamento: 1226.5, indicadorSinalLancamento: 'C' },
  ]
  ok(ehLinhaDeSaldo(linhas[0]) && ehLinhaDeSaldo(linhas[4]) && !ehLinhaDeSaldo(linhas[1]), 'linhas de saldo reconhecidas')
  const mov = normalizarLancamentosBb(linhas, '1505-12345')
  ok(mov.length === 3, 'só os 3 lançamentos reais (saldos fora)')
  ok(mov[0].natureza === 'credito' && mov[0].valor === 250.5 && mov[0].data_transacao === '2026-10-01' && mov[0].documento === '123'
    && mov[0].descricao === 'Pix - Recebido · 01/10 10:00 CLIENTE', 'crédito Pix normalizado')
  ok(mov[1].natureza === 'debito' && mov[1].documento === null, 'débito de tarifa (documento 0 ⇒ null)')
  ok(mov[1].id_externo !== mov[2].id_externo, 'duas tarifas idênticas no mesmo dia ⇒ ids diferentes (não some uma)')
  const mov2 = normalizarLancamentosBb(linhas, '1505-12345')
  ok(JSON.stringify(mov.map((m) => m.id_externo)) === JSON.stringify(mov2.map((m) => m.id_externo)), 'id_externo estável entre sincronizações (idempotente)')
  ok(mov.every((m) => m.id_externo.startsWith('bb:1505-12345:')), 'id_externo prefixado por banco e conta')

  // 4) registry + tela + rotas
  ok(!!getExtratoAdapter('bb'), 'adapter de extrato "bb" registrado')
  ok(temConectorExtrato('bb'), 'BB oferece "Sincronizar extrato" (conector real)')
  const tela = readFileSync('src/app/dashboard/financeiro/conexoes-bancarias/page.tsx', 'utf8')
  ok(/codigo: '001', sigla: 'bb'[\s\S]{0,120}piloto: true/.test(tela), 'tela: Banco do Brasil (001) na lista, em piloto')
  ok(tela.includes('.filter((b) => !b.piloto || adminPS)') && tela.includes("supabase.rpc('is_admin')"), 'tela: piloto só aparece para admin PS (is_admin no banco)')
  ok(/p_agencia: cs\.includes\('agencia'\)/.test(tela) && /p_convenio: cs\.includes\('convenio'\)/.test(tela) && /p_carteira: cs\.includes\('carteira'\)/.test(tela),
    'tela: agência/convênio/carteira vão para fn_banco_salvar_credencial')
  const teste = readFileSync('src/app/api/banco/testar-conexao/route.ts', 'utf8')
  ok(/provider === 'bb'[\s\S]{0,800}bbToken\(bb, BB_SCOPE_EXTRATO\)/.test(teste), 'teste de conexão autentica o BB no escopo de leitura')
  const sync = readFileSync('src/app/api/banco/extrato/sync/route.ts', 'utf8')
  ok(sync.includes('p_banco_codigo: bancoCodigo') && sync.includes("cfg.banco_codigo ? String(cfg.banco_codigo) : BANCO"),
    'sync de extrato busca a credencial do banco DA CONFIG (antes fixo em 756)')
  ok(!/https\.request|fetch\(/.test(readFileSync('src/lib/banco/extrato/bb.ts', 'utf8')), 'adapter de extrato só fala com o banco via bbRequest (mTLS opcional)')

  if (falhas) { console.error(`\ncheck-bb-conector: ${falhas} falha(s)`); process.exit(1) }
  console.log('\ncheck-bb-conector: ok')
}
main().catch((e) => { console.error(e); process.exit(1) })
