// Mapeador erp_pagar -> ArquivoInputSicredi (banco 748, pagamento de BOLETO via Segmento J). Espelha o
// mapearRemessaSicoob (RD-26): título sem o dado exigido NÃO entra (sai com motivo · RD-51); sem DV da
// agência BLOQUEIA (RD-38, dinheiro saindo). Só boleto (J). Tributo (cód. '8') e PIX/TED ficam de fora
// (Sicredi aqui só tem J). O corpo do beneficiário do J52 é montado por construirBenefBodySicredi —
// PROVADO byte a byte contra o arquivo real (scripts/cnab-mapear-proof-sicredi.ts).
import type { ArquivoInputSicredi, EmpresaSicredi, ItemJSicredi, LoteInputSicredi } from './sicredi'
import { construirBenefBodySicredi } from './sicredi'
import { barcodeRemessa44 } from '@/lib/financeiro/boleto-parser'
import type { TituloPag, ConfigSicoobDb, OpcoesRemessa, ErroTitulo } from './mapear'

export type ResultadoMapaSicredi = { input: ArquivoInputSicredi | null; erros: ErroTitulo[]; incluidos: string[]; totalCentavos: number }

const soDigitos = (s?: string | null) => (s ?? '').replace(/\D/g, '')
const up = (s?: string | null) => (s ?? '').toUpperCase()
const dataBR = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}${m}${y}` }

export function mapearRemessaSicredi(cfg: ConfigSicoobDb, titulos: TituloPag[], opts: OpcoesRemessa): ResultadoMapaSicredi {
  const erros: ErroTitulo[] = []
  const incluidos: string[] = []
  const [contaNum, contaDv] = (cfg.conta || '').split('-')
  const [cidade, uf] = (cfg.cidade_estado || '').split(',')
  const dvAg = (cfg.agencia_dv ?? '').trim()

  const empresa: EmpresaSicredi = {
    cnpj: soDigitos(cfg.cnpj), convenio: (cfg.convenio ?? '').trim(), agCoop: soDigitos(cfg.cooperativa), dvAg,
    conta: soDigitos(contaNum), dvCta: soDigitos(contaDv), nome: cfg.razao_social,
    logradouro: cfg.endereco ?? '', numero: '0', complemento: '', cidade: (cidade ?? '').trim(),
    cep: '00000000', uf: (uf ?? '').trim(),
  }

  const boletos: ItemJSicredi[] = []
  for (const t of titulos) {
    const forma = (t.forma_pagamento ?? '').toLowerCase()
    const valor = Math.round((t.valor ?? 0) * 100)
    if (valor <= 0) { erros.push({ id: t.id, motivo: 'valor inválido (zero ou negativo)' }); continue }
    if (forma !== 'boleto') { erros.push({ id: t.id, motivo: `forma "${forma || '—'}" não suportada na remessa Sicredi (apenas boleto · segmento J)` }); continue }
    const cb = barcodeRemessa44(t.codigo_barras)   // VERBATIM: só os 44 dígitos, como no banco (nunca a linha digitável 47)
    if (!cb) { erros.push({ id: t.id, motivo: 'boleto sem código de barras de 44 dígitos (linha digitável de 47 não entra — recadastre o código de barras)' }); continue }
    if (cb[0] === '8') { erros.push({ id: t.id, motivo: 'tributo/arrecadação não suportado na remessa Sicredi (segmento O não configurado)' }); continue }

    const nome = up(t.fornecedor?.nome || t.descricao)
    const seuNum = (t.numero_documento ?? '').trim() || t.id.replace(/-/g, '').slice(0, 20)
    boletos.push({
      codBarras: cb, nomeBenef: nome, dtVenc: dataBR(t.data_vencimento),
      valTitulo: valor, valPagto: valor, desconto: 0, acrescimo: 0, qtdMoeda: 0,
      dtPagto: dataBR(opts.dtPagto), seuNum,
      benefBody: construirBenefBodySicredi(soDigitos(t.fornecedor?.cnpj_cpf), nome),
    })
    incluidos.push(t.id)
  }

  const totalCentavos = boletos.reduce((s, i) => s + i.valPagto, 0)
  if (!incluidos.length) return { input: null, erros, incluidos, totalCentavos: 0 }
  if (!dvAg) { // RD-38: dinheiro saindo, não geramos sem o DV da agência confirmado
    erros.push({ id: '*', motivo: 'DV da agência não configurado (agencia_dv). Preencha na config do banco antes de gerar — validar na homologação.' })
    return { input: null, erros, incluidos: [], totalCentavos: 0 }
  }

  // Forma de Lançamento por banco do boleto (RD-38, byte a byte c/ o arquivo real da KGF/Omie):
  // 748 (Sicredi) = 30 (título do próprio banco); qualquer outro banco = 31 (títulos de outros bancos).
  // Mistura → lotes SEPARADOS por forma (o real sai com 1 lote 30 + 1 lote 31). Com '30' fixo, o Sicredi
  // rejeitava boletos de Itaú/BB com CA. Barcode verbatim mantido (#941).
  const doSicredi = boletos.filter((b) => b.codBarras.slice(0, 3) === '748')
  const deOutros = boletos.filter((b) => b.codBarras.slice(0, 3) !== '748')
  const lotes: LoteInputSicredi[] = []
  if (doSicredi.length) lotes.push({ tpServ: '03', formaPg: '30', itens: doSicredi })
  if (deOutros.length) lotes.push({ tpServ: '03', formaPg: '31', itens: deOutros })
  return {
    input: { empresa, nomePagador: cfg.razao_social, dataGer: opts.dataGer, horaGer: opts.horaGer, seqArq: opts.seqArq, lotes },
    erros, incluidos, totalCentavos,
  }
}
