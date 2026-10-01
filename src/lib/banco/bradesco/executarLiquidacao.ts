// #297 · baixa automática dos boletos Bradesco (CEO 01/10; manual API Cobrança v1.6.3). Chamado por
// /api/boleto/sync-liquidacao para cada empresa com conexão Bradesco ativa.
//  - 'lista' (7h): liquidados com data de pagamento nos últimos 5 dias (cobre fim de semana/feriado; dados D-1), casando
//    pelo nosso número → fn_boleto_liquidar_banco (data e valor pagos; juros registrados; idempotente). Depois a lista de
//    baixados (vencimentos dos boletos em aberto) → fn_boleto_marcar_baixado_banco (sem baixar o título como pago).
//  - 'individual' (13h): consulta título a título dos boletos em aberto vencidos ou a vencer em até 3 dias (13 = PAGO
//    NO DIA aparece no mesmo dia). 'ambos' = botão manual.
// Credencial: a MESMA do registro de boletos (client_id/secret e senha do A1 do cofre + certificado A1 ativo da empresa).
import { Buffer } from 'node:buffer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { listarLiquidados, listarBaixados, consultarTitulo, type Credencial, type BeneficiarioListagem, type BradescoAmbiente } from '@/lib/banco/bradesco'
import { lerListaLiquidados, lerListaBaixados, lerConsultaTitulo, chaveNossoNumero } from '@/lib/banco/bradesco/leituraCobranca'

export const BANCO_BRADESCO = '237'
export type ModoBradesco = 'lista' | 'individual' | 'ambos'
export type ResultadoBradesco = { status: 'ok' | 'parcial' | 'erro' | 'sem_boletos'; consultados: number; liquidados: number; baixados: number
  erros: Array<{ nosso_numero: string; erro: string }>; avisos: string[]; mensagem: string | null }

const MAX_PAGINAS = 40 // 50 por página → até 2.000 títulos por chamada; trava contra laço infinito
const isoHoje = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10) // Brasília
const somaDias = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10)

/** 7h (antes das 10h de Brasília) = lista; 13h = individual. */
export function modoDoHorario(agora = new Date()): ModoBradesco {
  const horaBrasilia = (agora.getUTCHours() + 21) % 24
  return horaBrasilia < 10 ? 'lista' : 'individual'
}

async function montarCredencial(companyId: string): Promise<{ cred: Credencial; benef: BeneficiarioListagem; ambiente: string } | { faltando: string }> {
  let ambiente = 'producao'
  let row = (await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: BANCO_BRADESCO, p_ambiente: 'producao' })).data as Record<string, unknown> | null
  if (!row || row.ok === false) {
    row = (await supabaseAdmin.rpc('fn_banco_obter_credencial', { p_company_id: companyId, p_banco_codigo: BANCO_BRADESCO, p_ambiente: 'homologacao' })).data as Record<string, unknown> | null
    ambiente = 'homologacao'
  }
  if (!row || row.ok === false) return { faltando: 'credencial Bradesco não configurada' }
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  if (!s(row.client_id) || !s(row.client_secret) || !s(row.cert_senha)) return { faltando: 'credencial Bradesco incompleta (client_id, client_secret ou senha do A1)' }
  if (!s(row.agencia) || !s(row.conta)) return { faltando: 'agência/conta da conexão Bradesco não informadas' }
  // mesmo certificado do registro de boletos: A1 ativo da empresa
  const { data: cert } = await supabaseAdmin.from('erp_certificados_a1').select('storage_bucket, storage_path')
    .eq('company_id', companyId).eq('status', 'ativo').gte('validade_fim', isoHoje())
    .order('validade_fim', { ascending: false }).limit(1).maybeSingle()
  if (!cert) return { faltando: 'certificado A1 ativo não encontrado' }
  const dl = await supabaseAdmin.storage.from(cert.storage_bucket as string).download(cert.storage_path as string)
  if (dl.error || !dl.data) return { faltando: 'falha ao baixar o certificado A1' }
  const { data: emp } = await supabaseAdmin.from('companies').select('cnpj').eq('id', companyId).single()
  if (!emp?.cnpj) return { faltando: 'empresa sem CNPJ' }
  const amb: BradescoAmbiente = ambiente === 'producao' ? 'producao' : 'sandbox'
  return {
    ambiente,
    cred: { client_id: s(row.client_id), client_secret: s(row.client_secret), ambiente: amb, pfx: Buffer.from(await dl.data.arrayBuffer()), passphrase: s(row.cert_senha) },
    benef: { cnpjBeneficiario: String(emp.cnpj), agencia: s(row.agencia), conta: s(row.conta), carteira: s(row.carteira) || '09' },
  }
}

async function logRaw(nn: string, situacao: string, raw: unknown) {
  try {
    await supabaseAdmin.rpc('fn_webhook_registrar_log', { p_provider: 'bradesco', p_tipo: 'boleto_liquidacao', p_provider_reference: nn,
      p_status_recebido: situacao, p_ip_origem: null, p_user_agent: 'sync-liquidacao', p_payload_raw: raw, p_signature_valid: true })
  } catch { /* log opcional */ }
}

/** diasLista: janela da lista de liquidados (agendado = 5; botão manual = 30, para pegar pagamentos mais antigos). */
export async function executarBradesco(companyId: string, modo: ModoBradesco, diasLista = 5): Promise<ResultadoBradesco> {
  const r: ResultadoBradesco = { status: 'ok', consultados: 0, liquidados: 0, baixados: 0, erros: [], avisos: [], mensagem: null }
  const { data: abertos, error } = await supabaseAdmin.from('erp_receber')
    .select('id, boleto_nosso_numero, valor, data_vencimento')
    .eq('company_id', companyId).eq('boleto_banco_codigo', BANCO_BRADESCO).is('deleted_at', null)
    .eq('boleto_status', 'registrado').in('status', ['aberto', 'vencido', 'parcial']).not('boleto_nosso_numero', 'is', null)
  if (error) return { ...r, status: 'erro', mensagem: error.message }
  const lista = (abertos ?? []) as { id: string; boleto_nosso_numero: string; valor: number; data_vencimento: string }[]
  if (lista.length === 0) return { ...r, status: 'sem_boletos' }
  const porChave = new Map(lista.map((b) => [chaveNossoNumero(b.boleto_nosso_numero), b]))

  const c = await montarCredencial(companyId)
  if ('faltando' in c) return { ...r, status: 'erro', mensagem: c.faltando }

  const liquidar = async (nn: string, data: string, valor: number, raw: unknown) => {
    const { data: liq } = await supabaseAdmin.rpc('fn_boleto_liquidar_banco', { p_company_id: companyId, p_banco_codigo: BANCO_BRADESCO,
      p_nosso_numero: nn, p_data_pagamento: data, p_valor_pago: valor, p_provider_raw: raw, p_provider: 'bradesco' })
    const j = liq as { sucesso?: boolean; ja_liquidado?: boolean; erro?: string; tipo_diferenca?: string; diferenca?: number } | null
    if (j?.sucesso && !j.ja_liquidado) {
      r.liquidados++
      if (j.tipo_diferenca === 'pago_a_menor') r.avisos.push(`${nn}: pago a menor (R$ ${Math.abs(j.diferenca ?? 0).toFixed(2)}) — conferir desconto ou pagamento parcial`)
    } else if (j && !j.sucesso) r.erros.push({ nosso_numero: nn, erro: j.erro ?? 'falha na baixa' })
  }
  const marcarBaixado = async (nn: string, codigo: number, descricao: string, data: string | null, raw: unknown) => {
    const { data: mb } = await supabaseAdmin.rpc('fn_boleto_marcar_baixado_banco', { p_company_id: companyId, p_banco_codigo: BANCO_BRADESCO,
      p_nosso_numero: nn, p_codigo: codigo, p_descricao: descricao, p_data: data, p_provider_raw: raw })
    const j = mb as { sucesso?: boolean; ja_tratado?: boolean } | null
    if (j?.sucesso && !j.ja_tratado) r.baixados++
  }

  if (modo === 'lista' || modo === 'ambos') {
    // liquidados: últimos N dias de pagamento (D-1 incluso; o manual limita a 60 dias)
    try {
      const hoje = isoHoje()
      let anterior = 0
      for (let i = 0; i < MAX_PAGINAS; i++) {
        const resp = await listarLiquidados(c.cred, c.benef, somaDias(hoje, -Math.min(Math.max(diasLista, 1), 59)), hoje, anterior)
        const p = lerListaLiquidados(resp.body)
        if (resp.status !== 200 || (p.status && p.status !== 200)) {
          if (!/CBTT0021|NAO HA DADOS/i.test(p.causa)) r.erros.push({ nosso_numero: '-', erro: `lista de liquidados: HTTP ${resp.status} ${p.causa}`.slice(0, 300) })
          break
        }
        for (const it of p.itens) {
          const b = porChave.get(it.nossoNumero)
          if (!b) continue // liquidado de boleto que não é deste ERP (ou já baixado)
          r.consultados++
          await logRaw(b.boleto_nosso_numero, 'LIQUIDADO_LISTA', it.raw)
          if (!it.dataPagamento || it.valorPago <= 0) { r.erros.push({ nosso_numero: b.boleto_nosso_numero, erro: 'liquidado sem data/valor na lista' }); continue }
          await liquidar(b.boleto_nosso_numero, it.dataPagamento, it.valorPago, it.raw)
          porChave.delete(it.nossoNumero)
        }
        if (!p.maisPaginas || !p.pagina) break
        anterior = p.pagina
      }
    } catch (e) { r.erros.push({ nosso_numero: '-', erro: `lista de liquidados: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }) }

    // baixados no banco (sem pagamento) entre os vencimentos dos boletos ainda em aberto
    try {
      const vencs = [...porChave.values()].map((b) => b.data_vencimento).filter(Boolean).sort()
      if (vencs.length) {
        let anterior = 0
        for (let i = 0; i < MAX_PAGINAS; i++) {
          const resp = await listarBaixados(c.cred, c.benef, vencs[0], vencs[vencs.length - 1], anterior)
          const p = lerListaBaixados(resp.body)
          if (resp.status !== 200 || (p.status && p.status !== 200)) {
            if (!/CBTT0021|NAO HA DADOS/i.test(p.causa)) r.erros.push({ nosso_numero: '-', erro: `lista de baixados: HTTP ${resp.status} ${p.causa}`.slice(0, 300) })
            break
          }
          for (const it of p.itens) {
            const b = porChave.get(it.nossoNumero)
            if (!b || !it.semPagamento) continue
            await logRaw(b.boleto_nosso_numero, `BAIXADO_${it.codigo}`, it.raw)
            await marcarBaixado(b.boleto_nosso_numero, it.codigo, it.descricao, it.dataBaixa, it.raw)
            porChave.delete(it.nossoNumero)
          }
          if (!p.maisPaginas || !p.pagina) break
          anterior = p.pagina
        }
      }
    } catch (e) { r.erros.push({ nosso_numero: '-', erro: `lista de baixados: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }) }
  }

  if (modo === 'individual' || modo === 'ambos') {
    const limite = somaDias(isoHoje(), 3)
    for (const b of [...porChave.values()].filter((x) => !x.data_vencimento || x.data_vencimento <= limite)) {
      r.consultados++
      try {
        const resp = await consultarTitulo(c.cred, c.benef, b.boleto_nosso_numero)
        const t = lerConsultaTitulo(resp.body)
        await logRaw(b.boleto_nosso_numero, t.ok ? `STATUS_${t.codStatus}` : 'ERRO', resp.body)
        if (!t.ok) { r.erros.push({ nosso_numero: b.boleto_nosso_numero, erro: t.erro ?? `HTTP ${resp.status}` }); continue }
        if (t.pago && t.dataPagamento && t.valorPago) await liquidar(b.boleto_nosso_numero, t.dataPagamento, t.valorPago, resp.body)
        else if (t.baixaSemPagamento) await marcarBaixado(b.boleto_nosso_numero, t.baixaSemPagamento.codigo, t.baixaSemPagamento.descricao, t.baixaSemPagamento.data, resp.body)
        else if (t.pagoSemValor) r.avisos.push(`${b.boleto_nosso_numero}: pago no dia, valor ainda não informado — baixa pela lista das 7h`)
      } catch (e) {
        r.erros.push({ nosso_numero: b.boleto_nosso_numero, erro: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
      }
    }
  }

  await supabaseAdmin.from('erp_banco_provider_config')
    .update({ ultimo_sync_em: new Date().toISOString(), ultimo_sync_status: r.erros.length > 0 ? 'parcial' : 'ok' })
    .eq('company_id', companyId).eq('banco_codigo', BANCO_BRADESCO).eq('ambiente', c.ambiente).eq('ativo', true)
  const falhas = r.erros.length
  r.status = falhas === 0 ? 'ok' : (r.liquidados + r.baixados > 0 || r.consultados > falhas ? 'parcial' : 'erro')
  r.mensagem = r.status === 'erro' ? (r.erros[0]?.erro ?? 'falha') : (r.avisos.length ? r.avisos.slice(0, 5).join(' · ') : null)
  return r
}
