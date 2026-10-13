// Gate (#339 R.R, reaberto 01/10 · CEO aprovou): retenções AJUSTÁVEIS NA NOTA. Partem do cadastro do serviço, a
// pessoa ajusta por tomador; "Sugerir" segue o regime de quem emite e o tipo do tomador; a rota aplica a MESMA cópia
// sobre o cadastro e faz a mesma conta — nota e título continuam batendo; o ajuste fica no histórico. Sem rede.
import { readFileSync } from 'node:fs'
import {
  aplicarRetencoesNota, calcularRetencoesFederais, lerRetencoesNota, retencoesNotaDoCadastro, retencoesNotaIguais,
  sugerirRetencoesNota, type ServicoTributosFederais,
} from '../../src/lib/fiscal/retencoesFederaisNfse'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const cadastro: ServicoTributosFederais & { iss_retido: boolean } = {
  iss_retido: false, retem_inss: true, aliquota_inss: 11, retem_ir: true, aliquota_ir: 1.5,
  retem_pis: true, aliquota_pis: 0.65, retem_cofins: false, aliquota_cofins: 3, retem_csll: false, aliquota_csll: 1, cst_pis_cofins: '01',
}

// ── cópia da nota = cadastro; sem ajuste, a conta é idêntica à do cadastro ──
const doCad = retencoesNotaDoCadastro(cadastro)
ok(retencoesNotaIguais(doCad, retencoesNotaDoCadastro(cadastro)), 'a cópia da nota começa igual ao cadastro')
const r0 = calcularRetencoesFederais(1000, cadastro)
const r1 = calcularRetencoesFederais(1000, aplicarRetencoesNota(cadastro, doCad))
ok(JSON.stringify(r0) === JSON.stringify(r1), 'sem ajuste, a nota calcula exatamente o que o cadastro calculava')

// ── ajuste na nota: ISS retido + COFINS 3% ligados, IR desligado ──
const aj = { ...doCad, iss_retido: true, retem_cofins: true, aliquota_cofins: 3, retem_ir: false }
const svAj = aplicarRetencoesNota(cadastro, aj)
const rAj = calcularRetencoesFederais(1000, svAj)
ok(svAj.iss_retido === true && rAj.valorCofinsRet === 30 && rAj.valorIrrf === 0 && rAj.valorCp === 110,
  'ajuste na nota muda a conta (COFINS 30,00 · IR 0 · INSS 110,00) e liga o ISS retido')
ok(svAj.cst_pis_cofins === '01', 'o CST do PIS/COFINS continua o do cadastro')
ok(!retencoesNotaIguais(aj, doCad), 'ajuste ≠ cadastro é detectado (vai para o histórico)')
const desliga = aplicarRetencoesNota(cadastro, { ...doCad, retem_pis: false })
ok(desliga.aliquota_pis === 0.65, 'retenção desligada na nota preserva a alíquota do cadastro (apuração própria)')

// ── corpo vindo do cliente ──
ok(lerRetencoesNota(aj) !== null, 'corpo válido é aceito')
ok(lerRetencoesNota({ ...aj, aliquota_inss: 120 }) === null, 'alíquota fora de 0–100 é recusada')
ok(lerRetencoesNota({ ...aj, retem_ir: 'sim' }) === null, 'tipo errado é recusado')
ok(lerRetencoesNota(null) === null && lerRetencoesNota({}) === null, 'corpo vazio é recusado')

// ── Sugerir (regra do CEO 01/10) ──
const pf = sugerirRetencoesNota({ cadastro, prestadorSimples: false, tomadorPJ: false }).nota
ok(!pf.iss_retido && !pf.retem_inss && !pf.retem_ir && !pf.retem_pis && !pf.retem_cofins && !pf.retem_csll, 'tomador pessoa física: nenhuma retenção')
const sn = sugerirRetencoesNota({ cadastro: { ...cadastro, iss_retido: true }, prestadorSimples: true, tomadorPJ: true }).nota
ok(!sn.retem_ir && !sn.retem_pis && !sn.retem_cofins && !sn.retem_csll, 'prestador do Simples: sem IR/PIS/COFINS/CSLL')
ok(sn.retem_inss && sn.aliquota_inss === 11 && sn.iss_retido, 'prestador do Simples: INSS e ISS retido seguem o cadastro')
const normal = sugerirRetencoesNota({ cadastro, prestadorSimples: false, tomadorPJ: true }).nota
ok(retencoesNotaIguais(normal, doCad), 'prestador fora do Simples com tomador PJ: o cadastro')

// ── fiação: rota e modal usam a regra única ──
const rota = readFileSync('src/app/api/fiscal/nfse/emitir/route.ts', 'utf8')
ok(rota.includes('retNota = lerRetencoesNota(body.retencoesNota)') && rota.includes("Retenções desta nota inválidas"), 'rota valida o corpo e recusa o inválido')
ok(rota.includes('const svRet = retNota ? aplicarRetencoesNota(sv as ServicoTributosFederais, retNota)') && rota.includes('calcularRetencoesFederais(Number(nfseReq.valorServicos), svRet)'),
  'rota calcula a nota com a cópia ajustada (a mesma conta da tela)')
ok(rota.includes('body.tipoRetencaoIss = retNota.iss_retido ? 2 : 1'), 'ISS retido da nota manda no tipo de retenção do ISS')
ok(/svTrava = aplicarRetencoesNota\(svTrava/.test(rota), 'a trava do padrão municipal também olha a cópia ajustada')
ok(rota.includes("acao: 'RETENCAO_AJUSTADA_NA_NOTA'") && rota.includes('!retencoesNotaIguais(retNota, retCadastro)'), 'ajuste fica no histórico (audit_log_global)')
const modal = readFileSync('src/components/fiscal/NFSeEmitirGovModal.tsx', 'utf8')
ok(modal.includes('const retPrevia = svEff ? calcularRetencoesFederais(valorPrevia, svEff) : null'), 'a tela mostra a conta da cópia da nota')
ok(modal.includes("retencoesNota: retNota") && modal.includes('sugerirRetencoesNota({'), 'a tela manda a cópia e o "Sugerir" usa a regra única')
ok(modal.includes('data-testid="nfse-retencoes-nota"') && modal.includes('data-testid="nfse-retencoes-sugerir"'), 'seção "Retenções desta nota" com Sugerir')

if (falhas) { console.error(`\ncheck-nfse-retencoes-nota: ${falhas} falha(s)`); process.exit(1) }
console.log('\nNFS-e · retenções ajustáveis na nota: ok')
