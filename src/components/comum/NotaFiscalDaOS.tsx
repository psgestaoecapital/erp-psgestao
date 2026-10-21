'use client'

// Chamado #2167 (Gean) · a OS mostra quando a nota já foi emitida e abre o PDF dali mesmo.
//
// Lê a última nota ligada à OS (erp_nfe_emitidas / erp_nfse_emitidas, coluna os_id, já gravada na emissão):
//   - autorizada  → botão VERDE "NF-e nº X · abrir PDF" (igual ao "Faturada" do financeiro), que baixa o DANFE/PDF
//                   com o nome do cliente (#2957); um link pequeno ainda deixa emitir outra nota (ex.: peças restantes);
//   - processando → aviso âmbar com "Atualizar";
//   - rejeitada / sem nota → segue o botão de emitir (o reenvio continua sendo pela própria OS).
// Cancelada/denegada não conta como emitida.

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { CheckCircle2, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { nomeArquivoNota } from '@/lib/download/nomeArquivo'
import { baixarUrlComNome } from '@/lib/download/baixarArquivo'
import { fantasiaClientePorDoc } from '@/lib/download/fantasiaCliente'
import { escolherNotaDaOS, notaJaEmitida, type NotaDaOS } from '@/lib/fiscal/notaDaOS'

export { notaJaEmitida, type NotaDaOS }

export type TipoNotaOS = 'nfe' | 'nfse'

export function useNotaDaOS(tipo: TipoNotaOS, osId: string, companyId: string) {
  const [nota, setNota] = useState<NotaDaOS | null>(null)

  const recarregar = useCallback(async () => {
    const q = tipo === 'nfe'
      ? supabase.from('erp_nfe_emitidas')
          .select('id, status, numero, data_emissao, criado_em, pdf_url:danfe_url, destinatario_cnpj, destinatario_cpf, razao:destinatario_razao_social, motivo_rejeicao')
      : supabase.from('erp_nfse_emitidas')
          .select('id, status, numero, data_emissao, criado_em, pdf_url, tomador_cnpj, tomador_cpf, razao:tomador_razao_social, motivo_rejeicao')
    const { data } = await q.eq('os_id', osId).eq('company_id', companyId).order('criado_em', { ascending: false }).limit(20)
    const linhas = ((data ?? []) as unknown as Array<Record<string, string | null>>).map((r): NotaDaOS => ({
      id: String(r.id), status: String(r.status ?? ''), numero: r.numero ?? null, data_emissao: r.data_emissao ?? null,
      criado_em: r.criado_em ?? null, pdf_url: r.pdf_url ?? null, razao: r.razao ?? null, motivo_rejeicao: r.motivo_rejeicao ?? null,
      doc: (tipo === 'nfe' ? (r.destinatario_cnpj || r.destinatario_cpf) : (r.tomador_cnpj || r.tomador_cpf)) ?? null,
    }))
    setNota(escolherNotaDaOS(linhas))
  }, [tipo, osId, companyId])

  useEffect(() => { void recarregar() }, [recarregar])

  return { nota, recarregar }
}

/** Baixa o PDF (DANFE / NFS-e) da nota com o nome do cliente: link direto do provedor ou arquivo guardado. */
export async function baixarPdfNotaDaOS(tipo: TipoNotaOS, nota: NotaDaOS, companyId: string): Promise<void> {
  const fantasia = await fantasiaClientePorDoc(companyId, nota.doc)
  const nome = nomeArquivoNota({ fantasia, razao: nota.razao, numero: nota.numero, emissao: nota.data_emissao ?? nota.criado_em, ext: 'pdf' })
  if (nota.pdf_url) { await baixarUrlComNome(nota.pdf_url, nome); return }
  const { data, error } = await supabase.rpc('fn_fiscal_get_storage_url', { p_tabela: tipo, p_doc_id: nota.id, p_tipo: 'pdf' })
  if (error) throw error
  const payload = (data ?? {}) as { ok?: boolean; erro?: string; storage_path?: string; bucket?: string }
  if (!payload.ok || !payload.storage_path) throw new Error(payload.erro ?? 'PDF ainda não disponível — tente em instantes.')
  const signed = await supabase.storage.from(payload.bucket ?? 'fiscal-xmls').createSignedUrl(payload.storage_path, 3600, { download: nome })
  if (signed.error || !signed.data?.signedUrl) throw new Error(signed.error?.message ?? 'Erro ao gerar o link do PDF')
  await baixarUrlComNome(signed.data.signedUrl, nome)
}

/** #2167 (lista de OS) · abre o PDF de uma nota pelo id — mesma leitura e mesmo download do botão verde da OS. */
export async function abrirPdfNotaPorId(tipo: TipoNotaOS, id: string, companyId: string): Promise<void> {
  const q = tipo === 'nfe'
    ? supabase.from('erp_nfe_emitidas')
        .select('id, status, numero, data_emissao, criado_em, pdf_url:danfe_url, destinatario_cnpj, destinatario_cpf, razao:destinatario_razao_social, motivo_rejeicao')
    : supabase.from('erp_nfse_emitidas')
        .select('id, status, numero, data_emissao, criado_em, pdf_url, tomador_cnpj, tomador_cpf, razao:tomador_razao_social, motivo_rejeicao')
  const { data, error } = await q.eq('id', id).eq('company_id', companyId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Nota não encontrada.')
  const r = data as unknown as Record<string, string | null>
  await baixarPdfNotaDaOS(tipo, {
    id: String(r.id), status: String(r.status ?? ''), numero: r.numero ?? null, data_emissao: r.data_emissao ?? null,
    criado_em: r.criado_em ?? null, pdf_url: r.pdf_url ?? null, razao: r.razao ?? null, motivo_rejeicao: r.motivo_rejeicao ?? null,
    doc: (tipo === 'nfe' ? (r.destinatario_cnpj || r.destinatario_cpf) : (r.tomador_cnpj || r.tomador_cpf)) ?? null,
  }, companyId)
}

const C = { green: '#166534', greenBg: '#EAF3DE', amber: '#B45309', amberBg: '#FAEEDA', espressoM: '#6B5D4F' }

/**
 * Estado da nota na OS. Devolve null quando não há nota emitida/processando — aí quem chama mostra o botão de emitir.
 * `onEmitirOutra` abre a emissão de novo (link pequeno ao lado do botão verde).
 */
export function NotaDaOSStatus({
  tipo, nota, companyId, onAtualizar, onEmitirOutra,
}: {
  tipo: TipoNotaOS; nota: NotaDaOS | null; companyId: string
  onAtualizar: () => void; onEmitirOutra: () => void
}) {
  const [baixando, setBaixando] = useState(false)
  const rotulo = tipo === 'nfe' ? 'NF-e' : 'NFS-e'
  const base: CSSProperties = { fontSize: 12, fontWeight: 700, borderRadius: 8, padding: '10px 14px', minHeight: 44,
    display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer' }
  const link: CSSProperties = { background: 'none', border: 'none', color: C.espressoM, fontSize: 11, textDecoration: 'underline', cursor: 'pointer', padding: '4px 2px' }

  if (!nota || !notaJaEmitida(nota)) return null

  if (nota.status === 'processando') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button type="button" onClick={onAtualizar} data-testid={`os-${tipo}-processando`}
          title={`A SEFAZ/prefeitura ainda está processando a ${rotulo}. Toque para atualizar — não reenvie enquanto estiver processando.`}
          style={{ ...base, color: C.amber, background: C.amberBg }}>
          <Clock size={14} aria-hidden /> {rotulo} processando · atualizar
        </button>
      </span>
    )
  }

  async function abrirPdf() {
    if (!nota) return
    setBaixando(true)
    try { await baixarPdfNotaDaOS(tipo, nota, companyId) }
    catch (e) { alert(e instanceof Error ? e.message : 'Erro ao abrir o PDF') }
    finally { setBaixando(false) }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button type="button" onClick={() => void abrirPdf()} disabled={baixando} data-testid={`os-${tipo}-emitida`}
        title={`${rotulo} já emitida para esta OS. Toque para baixar o PDF.`}
        style={{ ...base, color: C.green, background: C.greenBg, opacity: baixando ? 0.6 : 1 }}>
        <CheckCircle2 size={14} aria-hidden />
        {baixando ? 'Abrindo…' : `${rotulo}${nota.numero ? ` nº ${nota.numero}` : ''} · abrir PDF`}
      </button>
      <button type="button" onClick={onEmitirOutra} data-testid={`os-${tipo}-emitir-outra`}
        title={`Emitir outra ${rotulo} para esta OS (ex.: itens que ficaram de fora da primeira).`} style={link}>
        emitir outra
      </button>
    </span>
  )
}
