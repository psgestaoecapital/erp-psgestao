// Mapeador erp_pagar -> ArquivoInput do gerador Sicoob. RD-51: título sem o dado exigido pela forma NÃO
// entra (sai com motivo). RD-38: nada gera em produção sem homologação — DV da agência ausente BLOQUEIA.
// Detecta tributo (código de barras de arrecadação começa com '8') e o roteia para o segmento O.
import type { ArquivoInput, ItemJ, ItemO, LoteInput } from './sicoob'
import { barcodeRemessa44 } from '@/lib/financeiro/boleto-parser'

export type FornecedorPag = { pix?: string | null; cnpj_cpf?: string | null; nome?: string | null }
export type TituloPag = {
  id: string; forma_pagamento?: string | null; codigo_barras?: string | null; valor: number
  data_vencimento: string; numero_documento?: string | null; descricao?: string | null; fornecedor?: FornecedorPag | null
  // Data do Pagamento (segmento J/A) = vencimento no próximo dia útil, nunca no passado. Vem da RPC
  // fn_remessa_datas_pagamento (fonte única da regra de feriado). Fallback: opts.dtPagto (retrocompat/scripts).
  data_pagamento_prevista?: string | null
}
export type ConfigSicoobDb = {
  cnpj: string; cooperativa: string; agencia_dv?: string | null; conta: string; convenio: string
  razao_social: string; endereco?: string | null; cidade_estado?: string | null
}
export type ErroTitulo = { id: string; motivo: string }
export type ResultadoMapa = { input: ArquivoInput | null; erros: ErroTitulo[]; incluidos: string[]; totalCentavos: number }
export type OpcoesRemessa = { dtPagto: string; dataGer: string; horaGer: string; seqArq: number }

const soDigitos = (s?: string | null) => (s ?? '').replace(/\D/g, '')
const up = (s?: string | null) => (s ?? '').toUpperCase()
/** 'YYYY-MM-DD' -> 'DDMMAAAA' */
const dataBR = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}${m}${y}` }

export function mapearRemessaSicoob(cfg: ConfigSicoobDb, titulos: TituloPag[], opts: OpcoesRemessa): ResultadoMapa {
  const erros: ErroTitulo[] = []
  const incluidos: string[] = []
  const [contaNum, contaDv] = (cfg.conta || '').split('-')
  const [cidade, uf] = (cfg.cidade_estado || '').split(',')
  const dvAg = (cfg.agencia_dv ?? '').trim()

  const empresa = {
    cnpj: soDigitos(cfg.cnpj), convenio: soDigitos(cfg.convenio), agCoop: soDigitos(cfg.cooperativa), dvAg,
    conta: soDigitos(contaNum), dvCta: soDigitos(contaDv), nome: cfg.razao_social,
    logradouro: cfg.endereco ?? '', numero: '0', complemento: '', cidade: (cidade ?? '').trim(),
    cep: '00000000', uf: (uf ?? '').trim(),
  }

  const boletos: ItemJ[] = [], tributos: ItemO[] = [], pixs: ItemJ[] = []
  for (const t of titulos) {
    const forma = (t.forma_pagamento ?? '').toLowerCase()
    const valor = Math.round((t.valor ?? 0) * 100)
    const nome = up(t.fornecedor?.nome || t.descricao)
    const seuNum = (t.numero_documento ?? '').trim() || t.id.replace(/-/g, '').slice(0, 20)
    // Data do Pagamento: a data prevista do título (venc → próximo dia útil); só cai no opts.dtPagto legado se faltar.
    const dtVenc = dataBR(t.data_vencimento), dtPagto = dataBR(t.data_pagamento_prevista ?? opts.dtPagto)
    if (valor <= 0) { erros.push({ id: t.id, motivo: 'valor inválido (zero ou negativo)' }); continue }

    if (forma === 'boleto') {
      // VERBATIM: só o código de barras de 44 dígitos, exatamente como no banco. Linha digitável (47) NÃO
      // é aceita (o banco rejeita barcode reformatado) — recadastre o código de barras de 44 (RD-51).
      const cb = barcodeRemessa44(t.codigo_barras)
      if (!cb) { erros.push({ id: t.id, motivo: 'boleto sem código de barras de 44 dígitos (linha digitável de 47 não entra — recadastre o código de barras)' }); continue }
      if (cb[0] === '8') { // arrecadação/tributo -> segmento O
        tributos.push({ seg: 'O', codBarras: cb, nomeConc: nome, dtVenc, dtPagto, valPagto: valor, controle: seuNum })
      } else {
        boletos.push({ seg: 'J', codBarras: cb, nomeBenef: nome, dtVenc, valTitulo: valor, valPagto: valor, dtPagto, seuNum, cnpjBenef: soDigitos(t.fornecedor?.cnpj_cpf), nomeBenefFull: nome })
      }
      incluidos.push(t.id)
    } else if (forma === 'pix') {
      const key = (t.fornecedor?.pix ?? '').trim()
      if (!key) { erros.push({ id: t.id, motivo: 'PIX sem chave cadastrada no fornecedor' }); continue }
      pixs.push({ seg: 'J', codBarras: '0'.repeat(44), nomeBenef: nome, dtVenc, valTitulo: valor, valPagto: valor, dtPagto, seuNum, cnpjBenef: soDigitos(t.fornecedor?.cnpj_cpf), nomeBenefFull: nome, pixKey: key })
      incluidos.push(t.id)
    } else if (forma === 'transferencia') {
      erros.push({ id: t.id, motivo: 'transferência/TED (segmento A) ainda em validação — não incluída nesta remessa' })
    } else {
      erros.push({ id: t.id, motivo: `forma "${forma || '—'}" não suportada em remessa CNAB` })
    }
  }

  const totalCentavos = [...boletos, ...pixs].reduce((s, i) => s + i.valPagto, 0) + tributos.reduce((s, i) => s + i.valPagto, 0)
  if (!incluidos.length) return { input: null, erros, incluidos, totalCentavos: 0 }
  if (!dvAg) { // RD-38: dinheiro saindo, não geramos sem o DV da agência confirmado
    erros.push({ id: '*', motivo: 'DV da agência não configurado (agencia_dv). Preencha na config do banco antes de gerar — validar na homologação.' })
    return { input: null, erros, incluidos: [], totalCentavos: 0 }
  }

  const lotes: LoteInput[] = []
  if (boletos.length) lotes.push({ tpServ: '03', formaPg: '31', itens: boletos })
  if (tributos.length) lotes.push({ tpServ: '22', formaPg: '11', itens: tributos })
  if (pixs.length) lotes.push({ tpServ: '20', formaPg: '47', itens: pixs })

  return { input: { empresa, dataGer: opts.dataGer, horaGer: opts.horaGer, seqArq: opts.seqArq, lotes }, erros, incluidos, totalCentavos }
}
