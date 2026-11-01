// #2936 etapa 3 · Gera e arquiva o PDF assinado de um envio concluído (SÓ rota do servidor: usa service_role).
// Idempotente: se o envio já tem o PDF assinado, devolve o caminho sem gerar de novo. O arquivo vai para a pasta da
// empresa do próprio envio no bucket privado; o banco confere status 'assinado' e a pasta antes de registrar.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { BUCKET_CONTRATOS, sha256Hex } from '@/lib/contratos/assinatura'
import { gerarPdfAssinado, type Evidencias } from '@/lib/contratos/pdfAssinado'
import { linkVerificacao } from '@/lib/contratos/verificacao'

export function caminhoPdfAssinado(e: Pick<Evidencias, 'company_id' | 'contrato_id' | 'envio_id' | 'versao'>): string {
  return `${e.company_id}/assinados/${e.contrato_id}/v${e.versao}-${e.envio_id}.pdf`
}

export async function gerarEArquivarPdfAssinado(envioId: string, origem?: string): Promise<{ ok: true; path: string } | { ok: false; erro: string }> {
  const { data, error } = await supabaseAdmin.rpc('fn_contrato_assin__evidencias', { p_envio_id: envioId })
  if (error) return { ok: false, erro: 'Não consegui ler os registros da assinatura' }
  const ev = data as (Evidencias & { ok: boolean; erro?: string }) | null
  if (!ev?.ok) return { ok: false, erro: ev?.erro ?? 'Envio não encontrado' }
  if (ev.documento_assinado_path) return { ok: true, path: ev.documento_assinado_path }
  if (ev.status !== 'assinado') return { ok: false, erro: 'O contrato ainda não foi assinado por todos' }
  if (!ev.documento_path) return { ok: false, erro: 'Documento original indisponível' }

  const { data: blob, error: eDown } = await supabaseAdmin.storage.from(BUCKET_CONTRATOS).download(ev.documento_path)
  if (eDown || !blob) return { ok: false, erro: 'Não consegui ler o documento original' }
  const original = new Uint8Array(await blob.arrayBuffer())
  // o original guardado precisa ser o mesmo que foi assinado
  if ((await sha256Hex(original.buffer as ArrayBuffer)) !== ev.documento_hash) {
    return { ok: false, erro: 'O arquivo original mudou depois do envio; o PDF assinado não foi gerado' }
  }

  const bytes = await gerarPdfAssinado(original, { ...ev, url_verificacao: origem ? linkVerificacao(origem, ev.codigo_verificacao) : null })
  const hash = await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const path = caminhoPdfAssinado(ev)
  const { error: eUp } = await supabaseAdmin.storage.from(BUCKET_CONTRATOS)
    .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (eUp) return { ok: false, erro: 'Não consegui guardar o PDF assinado' }

  const { data: reg, error: eReg } = await supabaseAdmin.rpc('fn_contrato_assin__registrar_pdf', {
    p_envio_id: envioId, p_path: path, p_hash: hash, p_tamanho: bytes.byteLength,
  })
  const r = reg as { ok: boolean; erro?: string; path?: string } | null
  if (eReg || !r?.ok) return { ok: false, erro: r?.erro ?? 'Não consegui registrar o PDF assinado' }
  return { ok: true, path: r.path ?? path }
}
