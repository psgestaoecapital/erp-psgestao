import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isFiscalError, type FiscalError } from '@/lib/fiscal/errors'
import { registrarTentativaFiscal } from '@/lib/fiscal/tentativaLog'
import type { NFeRequest, NFeResponse } from '@/lib/fiscal/types'

// NF-e/NFC-e · nada de falha silenciosa na EMISSÃO (OS-0179 · KGF, contexto d869704f).
//
// Ponto cego: a Focus recusa na hora (HTTP 400/422, erro de schema — ex.: CST de regime normal numa empresa
// do Simples) com um THROW, antes de a nota existir. A rota devolvia 502 e NADA ficava gravado: nem a
// tentativa, nem a nota, nem o payload — e a investigação era às cegas. Espelho do que a NFS-e já faz
// (nfse/emitir): recusa de conteúdo vira nota 'rejeitada' em erp_nfe_emitidas COM o payload_enviado (RD-67)
// e uma linha em erp_fiscal_tentativa. Erro de infra (timeout/5xx/rede) NÃO vira nota — a Focus pode ter
// recebido; fica a tentativa com a referência, para consultar depois. Bloqueio local (validador pré-envio)
// também vira tentativa: nada foi enviado, então não há nota nem payload.

export interface ContextoEmissaoNFe {
  companyId: string
  userId: string | null | undefined
  notaTipo: 'nfe' | 'nfce'
  operacao: string          // 'emissao' | 'remessa' | 'devolucao' | 'devolucao_venda'
  endpoint: string          // 'nfe/emitir', 'nfce/emitir', ...
  nfeReq: NFeRequest
  // campos que a rota grava no registro por UPDATE (a RPC não tem parâmetro): erp_receber_id, os_id,
  // pedido_id, chave_referenciada, modelo… — a nota rejeitada fica ligada à MESMA origem da tentativa.
  vinculos?: Record<string, unknown>
}

type DetalhesErro = { status?: number; body?: unknown; payloadEnviado?: unknown; providerReference?: string }

// Mensagem COMPLETA da Focus: o request() só guarda o primeiro erro em err.message; o corpo traz todos.
export function mensagemCompletaFocus(err: FiscalError): string {
  const body = (err.details as DetalhesErro | undefined)?.body as
    | { mensagem?: string; erros?: Array<{ codigo?: string; mensagem?: string; campo?: string }> }
    | undefined
  const erros = Array.isArray(body?.erros) ? body!.erros : []
  const partes = erros
    .map((e) => [e?.campo, e?.mensagem].filter(Boolean).join(': '))
    .filter(Boolean)
  const base = body?.mensagem && !partes.includes(body.mensagem) ? [body.mensagem] : []
  const tudo = [...base, ...partes].join(' · ')
  return tudo || err.message
}

// Registra a falha de uma emissão (validador local ou Focus). Nunca lança: o chamador relança o erro original.
// Devolve o id da nota rejeitada quando ela foi gravada.
export async function registrarFalhaEmissaoNFe(
  ctx: ContextoEmissaoNFe,
  err: unknown,
  ambiente?: string,
): Promise<string | null> {
  if (!isFiscalError(err)) return null
  const d = (err.details ?? {}) as DetalhesErro
  const veioDaFocus = d.payloadEnviado != null
  const httpStatus = typeof d.status === 'number' ? d.status : null
  // recusa de CONTEÚDO pela Focus (schema/validação) — a nota não existe lá; é seguro registrá-la rejeitada
  const ehRecusaSincrona = veioDaFocus && err.code === 'PAYLOAD_INVALIDO' && (httpStatus === 400 || httpStatus === 422)
  const mensagem = veioDaFocus ? mensagemCompletaFocus(err) : err.message
  let notaId: string | null = null

  if (ehRecusaSincrona && ambiente) {
    try {
      const itens = ctx.nfeReq.itens ?? []
      const valorProdutos = Number(itens.reduce((acc, i) => acc + Number(i.valorTotal ?? 0), 0).toFixed(2))
      const r = ctx.nfeReq
      const { data: id, error } = await supabaseAdmin.rpc('fn_registrar_nfe_emitida', {
        p_company_id: ctx.companyId,
        // null de propósito: com o receber a RPC anota "NFe emitida em …" no título — falso numa recusa.
        // O vínculo vai no UPDATE abaixo (vinculos.erp_receber_id).
        p_erp_receber_id: null,
        p_provider_reference: d.providerReference ?? `${ctx.notaTipo}-rej-${Date.now()}`,
        p_ambiente: ambiente,
        p_dados: {
          serie: r.serie,
          natureza_operacao: r.naturezaOperacao,
          finalidade: r.finalidade,
          valor_total: valorProdutos,
          valor_produtos: valorProdutos,
          emitente_cnpj: r.emitente.cnpj,
          emitente_razao_social: r.emitente.razaoSocial,
          emitente_inscricao_estadual: r.emitente.inscricaoEstadual,
          destinatario_cnpj: r.destinatario.cnpj,
          destinatario_cpf: r.destinatario.cpf,
          destinatario_razao_social: r.destinatario.razaoSocial,
          destinatario_email: r.destinatario.email,
          destinatario_endereco: r.destinatario.endereco,
          status: 'rejeitada',
          motivo_rejeicao: mensagem,
        },
        p_itens: itens,
        p_provider_raw: (d.body as object | undefined) ?? null,
      })
      if (error) {
        console.error('[registrarFalhaEmissaoNFe] nota rejeitada não gravada', error.message)
      } else if (id) {
        notaId = String(id)
        const { error: upErr } = await supabaseAdmin
          .from('erp_nfe_emitidas')
          .update({ payload_enviado: d.payloadEnviado, ...(ctx.vinculos ?? {}) })
          .eq('id', notaId)
        if (upErr) console.error('[registrarFalhaEmissaoNFe] payload/vínculos da nota rejeitada não gravados', upErr.message)
      }
    } catch (e) {
      console.error('[registrarFalhaEmissaoNFe] falhou ao gravar a nota rejeitada', e)
    }
  }

  await registrarTentativaFiscal({
    companyId: ctx.companyId,
    notaTipo: ctx.notaTipo,
    notaId,
    operacao: ctx.operacao,
    provider: veioDaFocus ? 'focusnfe' : null,
    endpoint: ctx.endpoint,
    referencia: d.providerReference ?? null,
    httpStatus,
    // bloqueio local: o código diz que parou ANTES de enviar (nada saiu para a Focus/SEFAZ)
    providerCodigo: veioDaFocus ? err.code : `PRE_ENVIO_${err.code}`,
    providerMensagem: mensagem,
    resultado: ehRecusaSincrona ? 'rejeitada' : 'erro',
    usuarioId: ctx.userId ?? null,
  })
  return notaId
}

// Tentativa da emissão que a Focus ACEITOU processar (autorizada, rejeitada assíncrona ou processando).
export async function registrarTentativaEmissaoNFe(
  ctx: Omit<ContextoEmissaoNFe, 'nfeReq' | 'vinculos'>,
  resposta: Pick<NFeResponse, 'status' | 'providerReference' | 'motivoRejeicao'>,
  notaId: string | null,
): Promise<void> {
  await registrarTentativaFiscal({
    companyId: ctx.companyId,
    notaTipo: ctx.notaTipo,
    notaId,
    operacao: ctx.operacao,
    provider: 'focusnfe',
    endpoint: ctx.endpoint,
    referencia: resposta.providerReference ?? null,
    providerMensagem: resposta.motivoRejeicao ?? null,
    resultado: resposta.status === 'rejeitada' || resposta.status === 'denegada' ? 'rejeitada'
      : resposta.status === 'processando' ? 'processando' : 'ok',
    usuarioId: ctx.userId ?? null,
  })
}
