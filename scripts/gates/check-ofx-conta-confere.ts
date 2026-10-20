/**
 * Gate (Jordana 20/10 — extrato da Proplay importado na SICREDI PRIGOL da Pdois): a importação de OFX confere
 * banco/conta do arquivo com a conta escolhida e avisa movimento já importado em outra empresa do grupo.
 *   tsx scripts/gates/check-ofx-conta-confere.ts
 */
import { readFileSync } from 'node:fs'
import {
  extrairContaOFX, contaOFXConfere, mensagemContaErrada, movimentosJaNoGrupo,
} from '../../src/lib/conciliacao/ofxContaConfere'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

// OFX 1.x SGML (sem tags de fechamento) — o caso real: arquivo da Cresol (133) da Proplay.
const sgmlCresol = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM>
<BANKID>0133
<BRANCHID>1553
<ACCTID>85710-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261016<TRNAMT>44.10<FITID>82741130-3b64<MEMO>PIX CREDITO</STMTTRN></BANKTRANLIST>`
// OFX 2.x XML — Sicredi com agência à frente do número da conta.
const xmlSicredi = `<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>748</BANKID>
<BRANCHID>0313</BRANCHID><ACCTID>0313721719</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

const cresol = extrairContaOFX(sgmlCresol)
const sicredi = extrairContaOFX(xmlSicredi)
ok(cresol?.bankId === '0133' && cresol?.branchId === '1553' && cresol?.acctId === '85710-6', 'lê BANKID/BRANCHID/ACCTID do OFX SGML')
ok(sicredi?.bankId === '748' && sicredi?.acctId === '0313721719', 'lê BANKID/ACCTID do OFX XML')
ok(extrairContaOFX('<OFX><CREDITCARDMSGSRSV1><CCACCTFROM><ACCTID>1234</CCACCTFROM>') === null, 'fatura de cartão (sem BANKACCTFROM) não é conferida')

const prigol = { nome: 'SICREDI PRIGOL', banco: '748', banco_codigo: null, agencia: '0313', conta: '721719' }
const cresolProplay = { nome: 'CRESOL - PROPLAY', banco: '133', banco_codigo: null, agencia: '1553', conta: '857106' }

// Critério de pronto 2: o OFX da Proplay na conta da Prigol é bloqueado.
ok(contaOFXConfere(cresol!, prigol).confere === false, 'caso real: arquivo Cresol/Proplay na SICREDI PRIGOL → bloqueia')
ok(contaOFXConfere(cresol!, cresolProplay).confere === true, 'mesmo arquivo na conta certa (CRESOL - PROPLAY) → passa')
ok(contaOFXConfere(sicredi!, prigol).confere === true, 'agência à frente da conta no ACCTID → passa')
ok(contaOFXConfere({ bankId: '748', branchId: null, acctId: '7217199' }, prigol).confere === true, 'dígito verificador a mais no arquivo → passa')
ok(contaOFXConfere({ bankId: '748', branchId: null, acctId: '72171' }, prigol).confere === true, 'cadastro com dígito verificador e arquivo sem → passa')
ok(contaOFXConfere({ bankId: '748', branchId: null, acctId: '999888' }, prigol).confere === false, 'mesmo banco, outra conta → bloqueia')
ok(contaOFXConfere(cresol!, { nome: 'Caixa', banco: null, conta: null }).confere === null, 'conta sem banco/número no cadastro → não bloqueia')
ok(contaOFXConfere(cresol!, { nome: 'X', banco: 'Sicredi', conta: null }).confere === null, 'banco por nome (não código) e sem conta → não bloqueia')
ok(contaOFXConfere(cresol!, { nome: 'Interna', banco: 'Conta Interna', banco_codigo: '000', conta: null }).confere === null, 'banco_codigo 000 (conta interna) não conta como banco')

const msg = mensagemContaErrada(cresol!, prigol, { nome: 'CRESOL - PROPLAY', empresa: 'Proplay Produtora Ltda' })
ok(/^Este extrato é da conta CRESOL - PROPLAY .*\(empresa Proplay Produtora Ltda\?\), e não da conta escolhida \(SICREDI PRIGOL\)/.test(msg), `mensagem pedida: ${msg}`)
ok(/banco 133 · ag\. 1553 · conta 85710-6/.test(mensagemContaErrada(cresol!, prigol, null)), 'sem conta achada: descreve banco/agência/conta do arquivo')

// Item 3: aviso de movimento já importado em outra empresa do grupo.
const arquivo = [
  { id_externo: 'c4f92314', data_transacao: '2026-10-16', valor: 291, natureza: 'credito', descricao: 'CRÉDITO TÍTULOS COBRANÇA' },
  { id_externo: null, data_transacao: '2026-10-16', valor: 16.24, natureza: 'debito', descricao: 'PAGAMENTO DE TÍTULOS - IB CDL' },
  { id_externo: 'bradesco-1', data_transacao: '2026-10-16', valor: 10, natureza: 'debito', descricao: 'TARIFA' },
  { id_externo: 'novo', data_transacao: '2026-10-16', valor: 5, natureza: 'debito', descricao: 'OUTRO' },
]
const existentes = [
  { company_id: 'proplay', id_externo: 'c4f92314', data_transacao: '2026-10-16', valor: '291.00', natureza: 'credito', descricao: 'outro texto' },
  { company_id: 'proplay', id_externo: 'x', data_transacao: '2026-10-16', valor: 16.24, natureza: 'debito', descricao: 'PAGAMENTO DE TITULOS -  IB CDL' },
  { company_id: 'outra', id_externo: 'bradesco-1', data_transacao: '2026-09-01', valor: 999, natureza: 'debito', descricao: 'OUTRA COISA' },
]
const cont = movimentosJaNoGrupo(arquivo, existentes)
ok(cont.proplay === 2, 'acha por FITID+valor e por data+valor+natureza+descrição (sem acento/espaço)')
ok(!cont.outra, 'FITID igual com valor diferente (Bradesco reaproveita FITID) não avisa')
ok(Object.keys(movimentosJaNoGrupo(arquivo, [])).length === 0, 'grupo sem os movimentos → sem aviso')

// A tela de importação usa as travas antes de criar o lote.
const tela = readFileSync('src/app/dashboard/financeiro/conciliacao/inbox/page.tsx', 'utf8')
const iTrava = tela.indexOf('contaOFXConfere(contaArquivo, contaEscolhida).confere === false')
const iAviso = tela.indexOf('avisoMovimentosNoGrupo(movimentos)')
const iRpc = tela.indexOf("supabase.rpc('fn_conciliacao_criar_lote'")
ok(iTrava > 0 && iAviso > iTrava && iRpc > iAviso, 'inbox: trava da conta e aviso do grupo vêm ANTES de fn_conciliacao_criar_lote')
ok(/select\('id,nome,banco,banco_codigo,agencia,conta'\)/.test(tela), 'inbox: carrega banco/agência/conta das contas')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
