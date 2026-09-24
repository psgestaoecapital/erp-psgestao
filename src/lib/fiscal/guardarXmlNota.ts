import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from './service'
import { parseTributos } from './parseTributos'

// Baixa o XML AUTORIZADO da NF-e na Focus e guarda no Storage (bucket privado fiscal-nfe-xml),
// gravando a referência em erp_nfe_emitidas.xml_storage_path e o vTotTrib parseado em valor_total_tributos.
// Best-effort: NUNCA quebra o fluxo de emissão (só loga no servidor se falhar). Idempotente: se já tem
// xml_storage_path, não rebaixa (a menos que forcar=true).
//
// Por que existe: sem o XML guardado, "a Focus calcula o vTotTrib?" vira pesquisa; com ele, é leitura de
// dado (RD-38). O #1751 guardou o REQUEST; isto guarda o RESULTADO. O parseamento dos tributos é
// TIPO-AWARE (NF-e usa ICMSTot; NFS-e usa totTrib) — ver parseTributos.ts.

const BUCKET = 'fiscal-nfe-xml'

export interface GuardarXmlResultado {
  ok: boolean
  nfeId: string
  jaTinha?: boolean
  xmlStoragePath?: string | null
  valorTotalTributos?: number | null
  // diagnóstico do parser (prova RD-38: a Focus preenche vTotTrib na NF-e?)
  tipoDoc?: 'nfe' | 'nfse' | 'desconhecido'
  itensComVTotTrib?: number
  erro?: string
}

export async function guardarXmlNota(nfeId: string, forcar = false): Promise<GuardarXmlResultado> {
  try {
    const { data: nota, error } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id, company_id, provider_reference, chave, xml_storage_path, status')
      .eq('id', nfeId)
      .maybeSingle()
    if (error || !nota) return { ok: false, nfeId, erro: error?.message ?? 'nota não encontrada' }
    if (nota.status !== 'autorizada') return { ok: false, nfeId, erro: `status ${nota.status} (XML só existe quando autorizada)` }
    if (nota.xml_storage_path && !forcar) return { ok: true, nfeId, jaTinha: true, xmlStoragePath: nota.xml_storage_path }

    const ref = (nota.provider_reference as string | null) || (nota.chave as string | null)
    if (!ref) return { ok: false, nfeId, erro: 'sem provider_reference nem chave' }

    const svc = await createFiscalService(nota.company_id as string)
    const { xml, chave } = await svc.baixarXmlNota(ref)
    const chaveFinal = (nota.chave as string | null) || chave || ref
    const path = `${nota.company_id}/${String(chaveFinal).replace(/\D/g, '')}.xml`

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, new Blob([xml], { type: 'application/xml' }), { contentType: 'application/xml', upsert: true })
    if (upErr) return { ok: false, nfeId, erro: `upload: ${upErr.message}` }

    const trib = parseTributos(xml)
    const vTotTrib = trib.vTotTrib
    const { error: updErr } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .update({ xml_storage_path: path, ...(vTotTrib != null ? { valor_total_tributos: vTotTrib } : {}) })
      .eq('id', nfeId)
    if (updErr) return { ok: false, nfeId, erro: `update: ${updErr.message}` }

    return { ok: true, nfeId, xmlStoragePath: path, valorTotalTributos: vTotTrib, tipoDoc: trib.tipo, itensComVTotTrib: trib.itensComVTotTrib }
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'erro inesperado'
    console.error('[guardarXmlNota] falhou', nfeId, erro)
    return { ok: false, nfeId, erro }
  }
}

// Re-parseia o XML JÁ GUARDADO no Storage (sem tocar a Focus) e regrava valor_total_tributos.
// Uso: prova RD-38 — depois de corrigir o parser, re-rodar sobre os XMLs existentes RESPONDE no dado
// se a Focus preenche vTotTrib na NF-e (valor volta não-nulo = a tag existia e o parser era o bug;
// segue nulo = a Focus não calcula, tabela IBPT necessária na NF-e). Não baixa nada da Focus:
// lê o objeto do bucket via service role (server-side). Idempotente e best-effort.
export async function reparseXmlNota(nfeId: string): Promise<GuardarXmlResultado> {
  try {
    const { data: nota, error } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id, company_id, xml_storage_path')
      .eq('id', nfeId)
      .maybeSingle()
    if (error || !nota) return { ok: false, nfeId, erro: error?.message ?? 'nota não encontrada' }
    const path = nota.xml_storage_path as string | null
    if (!path) return { ok: false, nfeId, erro: 'sem xml_storage_path (rode o backfill antes)' }

    const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(path)
    if (dlErr || !blob) return { ok: false, nfeId, erro: `download storage: ${dlErr?.message ?? 'vazio'}` }
    const xml = await blob.text()

    const trib = parseTributos(xml)
    if (trib.vTotTrib != null) {
      const { error: updErr } = await supabaseAdmin
        .from('erp_nfe_emitidas')
        .update({ valor_total_tributos: trib.vTotTrib })
        .eq('id', nfeId)
      if (updErr) return { ok: false, nfeId, erro: `update: ${updErr.message}` }
    }
    return {
      ok: true, nfeId, xmlStoragePath: path,
      valorTotalTributos: trib.vTotTrib, tipoDoc: trib.tipo, itensComVTotTrib: trib.itensComVTotTrib,
    }
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'erro inesperado'
    console.error('[reparseXmlNota] falhou', nfeId, erro)
    return { ok: false, nfeId, erro }
  }
}
