import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { createFiscalService } from './service'

// Baixa o XML AUTORIZADO da NF-e na Focus e guarda no Storage (bucket privado fiscal-nfe-xml),
// gravando a referência em erp_nfe_emitidas.xml_storage_path e o vTotTrib parseado em valor_total_tributos.
// Best-effort: NUNCA quebra o fluxo de emissão (só loga no servidor se falhar). Idempotente: se já tem
// xml_storage_path, não rebaixa (a menos que forcar=true).
//
// Por que existe: sem o XML guardado, "a Focus calcula o vTotTrib?" vira pesquisa; com ele, é leitura de
// dado (RD-38). O #1751 guardou o REQUEST; isto guarda o RESULTADO.

const BUCKET = 'fiscal-nfe-xml'

function parseVTotTrib(xml: string): number | null {
  // total da nota (tag vTotTrib no grupo total/ICMSTot). Pega a MAIOR ocorrência de nível de total —
  // na prática o total agregado. Regex simples: soma não é necessária (a Focus já totaliza).
  const m = xml.match(/<vTotTrib>\s*([\d.]+)\s*<\/vTotTrib>/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export interface GuardarXmlResultado {
  ok: boolean
  nfeId: string
  jaTinha?: boolean
  xmlStoragePath?: string | null
  valorTotalTributos?: number | null
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

    const vTotTrib = parseVTotTrib(xml)
    const { error: updErr } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .update({ xml_storage_path: path, ...(vTotTrib != null ? { valor_total_tributos: vTotTrib } : {}) })
      .eq('id', nfeId)
    if (updErr) return { ok: false, nfeId, erro: `update: ${updErr.message}` }

    return { ok: true, nfeId, xmlStoragePath: path, valorTotalTributos: vTotTrib }
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'erro inesperado'
    console.error('[guardarXmlNota] falhou', nfeId, erro)
    return { ok: false, nfeId, erro }
  }
}
