'use client'

// GF4 · XML de compra em lote (Documentos Recebidos). Escolha vários XMLs de NF-e (ou um .zip com eles, como o contador
// costuma mandar): cada arquivo passa pela MESMA fn_nfe_recebida_upload_xml do envio de um arquivo (chave com DV,
// destinatário = CNPJ da empresa, não sobrescreve XML da SEFAZ nem aceita valor divergente sem confirmação) e vira nota
// "Pronta" para conferir e lançar em Contas a Pagar. Um arquivo recusado não para o lote: o painel mostra o resultado de
// cada um, e o que precisa de confirmação tem o botão "Confirmar" na própria linha (nada é confirmado em massa).
// Regras puras em src/lib/fiscal/xmlLote.ts (gate check-xml-lote-recebidas.ts).

import { useRef, useState } from 'react'
import { Files, Loader2, X, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  MAX_ARQUIVOS_LOTE, aceitePedido, classificarUpload, resumoLote, tipoArquivo,
  type Aceites, type RespUploadXml, type SituacaoLote,
} from '@/lib/fiscal/xmlLote'

const ROTA_AJUDA = '/dashboard/compras/documentos-recebidos'

type Linha = {
  nome: string
  xml: string | null
  situacao: SituacaoLote | 'pendente' | 'enviando'
  texto: string
  aceites: Aceites
  pedido: keyof Aceites | null // aceite que a última resposta pediu
}

interface Props {
  companyId: string | null
  onDone?: () => void
}

async function lerArquivos(files: File[]): Promise<Linha[]> {
  const linhas: Linha[] = []
  const nova = (nome: string, xml: string | null, erro?: string): Linha => ({
    nome, xml,
    situacao: erro ? 'recusada' : 'pendente',
    texto: erro ?? 'Na fila',
    aceites: { sobrescrever: false, divergencia: false },
    pedido: null,
  })
  for (const f of files) {
    const tipo = tipoArquivo(f.name)
    if (tipo === 'xml') {
      try { linhas.push(nova(f.name, await f.text())) } catch { linhas.push(nova(f.name, null, 'Não foi possível ler o arquivo.')) }
    } else if (tipo === 'zip') {
      try {
        const { default: JSZip } = await import('jszip')
        const zip = await JSZip.loadAsync(f)
        const dentro = Object.values(zip.files).filter((e) => !e.dir && tipoArquivo(e.name) === 'xml')
        if (!dentro.length) linhas.push(nova(f.name, null, 'O .zip não tem nenhum XML dentro.'))
        for (const e of dentro) linhas.push(nova(`${f.name} › ${e.name.split('/').pop()}`, await e.async('string')))
      } catch {
        linhas.push(nova(f.name, null, 'Não foi possível abrir o .zip.'))
      }
    } else {
      linhas.push(nova(f.name, null, classificarUpload({ ok: false, erro: 'tipo_arquivo' }).texto))
    }
  }
  return linhas
}

export function UploadXmlLoteRecebidas({ companyId, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [rodando, setRodando] = useState(false)

  const atualizar = (i: number, p: Partial<Linha>) =>
    setLinhas((ls) => (ls ? ls.map((l, j) => (j === i ? { ...l, ...p } : l)) : ls))

  async function enviar(xml: string, aceites: Aceites): Promise<RespUploadXml> {
    const { data, error } = await supabase.rpc('fn_nfe_recebida_upload_xml', {
      p_company_id: companyId,
      p_xml: xml,
      p_aceite_sobrescrever: aceites.sobrescrever,
      p_aceite_divergencia: aceites.divergencia,
    })
    if (error) return { ok: false, erro: error.message }
    return (data ?? { ok: false, erro: 'sem resposta' }) as RespUploadXml
  }

  async function processar(i: number, l: Linha) {
    if (!l.xml) return
    atualizar(i, { situacao: 'enviando', texto: 'Enviando…' })
    const r = await enviar(l.xml, l.aceites)
    const c = classificarUpload(r)
    atualizar(i, { situacao: c.situacao, texto: c.texto, pedido: aceitePedido(r) })
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (inputRef.current) inputRef.current.value = ''
    if (!files.length || !companyId) return
    setRodando(true)
    try {
      let lidas = await lerArquivos(files)
      if (lidas.length > MAX_ARQUIVOS_LOTE) {
        lidas = lidas.slice(0, MAX_ARQUIVOS_LOTE)
        alert(`Até ${MAX_ARQUIVOS_LOTE} XMLs por envio. Os primeiros ${MAX_ARQUIVOS_LOTE} serão enviados; envie o resto depois.`)
      }
      setLinhas(lidas)
      // um por vez: a mesma nota pode vir duas vezes no lote e cada envio é uma transação própria
      for (let i = 0; i < lidas.length; i++) await processar(i, lidas[i])
      onDone?.()
    } finally {
      setRodando(false)
    }
  }

  // confirma SÓ o que a resposta desta linha pediu; a função revalida tudo e pode pedir o outro aceite em seguida
  async function confirmar(i: number) {
    const l = linhas?.[i]
    if (!l?.pedido) return
    const aceites = { ...l.aceites, [l.pedido]: true }
    atualizar(i, { aceites })
    setRodando(true)
    try { await processar(i, { ...l, aceites }); onDone?.() } finally { setRodando(false) }
  }

  const resumo = linhas ? resumoLote(linhas.map((l) => l.situacao)) : null

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".xml,.zip,text/xml,application/xml,application/zip"
        hidden
        data-testid="xml-lote-input"
        onChange={(e) => void onFiles(e)}
      />
      <button
        type="button"
        disabled={rodando || !companyId}
        onClick={() => inputRef.current?.click()}
        title={companyId ? 'Envie vários XMLs de compra (ou um .zip com eles) de uma vez' : 'Escolha uma empresa para enviar XMLs'}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#3D2314]/15 text-[12px] font-medium text-[#3D2314]/70 hover:bg-[#3D2314]/5 disabled:opacity-50 min-h-[44px]"
      >
        {rodando ? <Loader2 className="animate-spin" size={14} /> : <Files size={14} />}
        {rodando ? 'Enviando XMLs…' : 'Subir XMLs em lote'}
      </button>
      <AjudaCampo chave="compras.docs_recebidos.xml_lote" rota={ROTA_AJUDA} />

      {linhas && resumo && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4" role="dialog" aria-label="Envio de XMLs em lote">
          <div className="bg-white w-full sm:max-w-2xl max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl" data-testid="xml-lote-painel">
            <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold text-[#3D2314]">XMLs de compra em lote</h2>
                <p className="text-[12.5px] text-[#3D2314]/65 mt-1" data-testid="xml-lote-resumo">
                  {resumo.total} {resumo.total === 1 ? 'arquivo' : 'arquivos'} · {resumo.aplicada} {resumo.aplicada === 1 ? 'nota pronta' : 'notas prontas'}
                  {resumo.confirmar > 0 && <> · {resumo.confirmar} para confirmar</>}
                  {resumo.recusada > 0 && <> · {resumo.recusada} {resumo.recusada === 1 ? 'recusado' : 'recusados'}</>}
                  {resumo.pendente > 0 && <> · {resumo.pendente} na fila</>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLinhas(null)}
                disabled={rodando}
                aria-label="Fechar"
                className="p-2 rounded-lg text-[#3D2314]/60 hover:bg-[#3D2314]/5 disabled:opacity-40 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>
            <ul className="overflow-y-auto divide-y divide-[#3D2314]/8">
              {linhas.map((l, i) => (
                <li key={i} className="px-5 py-3 flex items-start gap-3" data-testid="xml-lote-linha" data-situacao={l.situacao}>
                  <span className="mt-0.5 shrink-0">
                    {l.situacao === 'aplicada' ? <CheckCircle2 size={16} className="text-[#3F7012]" />
                      : l.situacao === 'confirmar' ? <AlertTriangle size={16} className="text-[#BA7517]" />
                        : l.situacao === 'recusada' ? <XCircle size={16} className="text-[#C94544]" />
                          : <Loader2 size={16} className={'text-[#3D2314]/40 ' + (l.situacao === 'enviando' ? 'animate-spin' : '')} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#3D2314] truncate" title={l.nome}>{l.nome}</div>
                    <div className="text-[12px] text-[#3D2314]/70 mt-0.5">{l.texto}</div>
                  </div>
                  {l.situacao === 'confirmar' && (
                    <button
                      type="button"
                      disabled={rodando}
                      onClick={() => void confirmar(i)}
                      className="shrink-0 text-[12px] px-3 py-2 rounded-lg border border-[#BA7517]/40 text-[#A77A12] font-medium hover:bg-[#FBF3E0] disabled:opacity-50 min-h-[40px]"
                    >
                      Confirmar
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-5 py-3 border-t border-[#3D2314]/10 text-[12px] text-[#3D2314]/60">
              As notas prontas aparecem na lista para conferir e lançar em Contas a Pagar. Nada é lançado sozinho.
            </div>
          </div>
        </div>
      )}
    </span>
  )
}
