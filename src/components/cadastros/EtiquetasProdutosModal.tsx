'use client'

// Etiquetas A4 dos produtos selecionados (CEO 30/09 · Diego/FC). Busca nome, código, código de barras e local de
// armazenagem no banco (a lista da tela não carrega o local) e gera o PDF no navegador — nada sai da sessão do usuário.

import { useState } from 'react'
import bwipjs from 'bwip-js/browser'
import { supabase } from '@/lib/supabase'
import {
  FOLHA_A4, POR_FOLHA, MAX_ETIQUETAS, gerarEtiquetasA4, opcoesBwip, expandirCopias,
  type EtiquetaProduto, type RenderBarcode,
} from '@/lib/produtos/etiquetasA4'
import { X, Loader2, Printer } from 'lucide-react'

const renderNoCanvas: RenderBarcode = async (s) => {
  const canvas = document.createElement('canvas')
  bwipjs.toCanvas(canvas, opcoesBwip(s))
  const blob = await new Promise<Blob>((ok, falha) =>
    canvas.toBlob((b) => (b ? ok(b) : falha(new Error('Falha ao desenhar o código de barras'))), 'image/png'),
  )
  return new Uint8Array(await blob.arrayBuffer())
}

interface Props {
  companyId: string
  ids: string[]
  onClose: () => void
}

export default function EtiquetasProdutosModal({ companyId, ids, onClose }: Props) {
  const [copias, setCopias] = useState('1')
  const [inicio, setInicio] = useState('1')
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const nCopias = Math.min(Math.max(parseInt(copias, 10) || 1, 1), 100)
  const nInicio = Math.min(Math.max(parseInt(inicio, 10) || 1, 1), POR_FOLHA)
  const total = ids.length * nCopias
  const folhas = Math.ceil((total + nInicio - 1) / POR_FOLHA)

  async function gerar() {
    setGerando(true)
    setErro(null)
    setAviso(null)
    try {
      const linhas: (EtiquetaProduto & { id: string })[] = []
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase
          .from('erp_produtos')
          .select('id,codigo,nome,codigo_barras,localizacao')
          .eq('company_id', companyId)
          .in('id', ids.slice(i, i + 200))
        if (error) throw new Error(error.message)
        linhas.push(...((data ?? []) as (EtiquetaProduto & { id: string })[]))
      }
      // mantém a ordem da seleção
      const porId = new Map(linhas.map((p) => [p.id, p]))
      const ordenados = ids.map((id) => porId.get(id)).filter((p): p is EtiquetaProduto & { id: string } => !!p)
      if (expandirCopias(ordenados, nCopias).length > MAX_ETIQUETAS) throw new Error(`Máximo de ${MAX_ETIQUETAS} etiquetas por vez.`)
      const bytes = await gerarEtiquetasA4(ordenados, { copias: nCopias, inicio: nInicio, renderBarcode: renderNoCanvas })
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `etiquetas-produtos-${new Date().toISOString().slice(0, 10)}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      const semLocal = ordenados.filter((p) => !(p.localizacao ?? '').trim()).length
      setAviso(
        `PDF gerado: ${ordenados.length * nCopias} etiqueta(s).` +
          (semLocal ? ` ${semLocal} produto(s) sem local de armazenagem — preencha na ficha do produto (aba Básico).` : ''),
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar as etiquetas')
    } finally {
      setGerando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-md w-full shadow-2xl" data-testid="etiquetas-modal">
        <div className="px-5 py-4 border-b border-[#3D2314]/10 flex items-center justify-between">
          <h2 className="text-[15px] font-medium text-[#3D2314] flex items-center gap-2">
            <Printer size={16} className="text-[#C8941A]" /> Etiquetas A4
          </h2>
          <button onClick={onClose} className="text-[#3D2314]/60 hover:text-[#3D2314]" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 text-[13px] text-[#3D2314]">
          <p>
            <b data-testid="etiquetas-qtd-produtos">{ids.length}</b> produto(s) selecionado(s). Cada etiqueta traz nome,
            código, local de armazenagem e código de barras.
          </p>
          <p className="text-[12px] text-[#3D2314]/70">Folha: {FOLHA_A4.rotulo}. Imprima em tamanho real (100%, sem ajustar à página).</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[12px] font-medium block mb-1.5">Cópias de cada produto</span>
              <input
                type="number" min={1} max={100} value={copias} onChange={(e) => setCopias(e.target.value)}
                data-testid="etiquetas-copias"
                className="w-full px-3 py-2 border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium block mb-1.5">Começar na etiqueta nº</span>
              <input
                type="number" min={1} max={POR_FOLHA} value={inicio} onChange={(e) => setInicio(e.target.value)}
                data-testid="etiquetas-inicio"
                className="w-full px-3 py-2 border border-[#3D2314]/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
              />
              <span className="text-[11px] text-[#3D2314]/55">para aproveitar folha já usada</span>
            </label>
          </div>
          <p className="text-[12px]" data-testid="etiquetas-resumo">
            {total} etiqueta(s) · {folhas} folha(s)
          </p>
          {erro && <div className="px-3 py-2 rounded-lg bg-[#FCEBEB] text-[#791F1F] text-[12.5px]">{erro}</div>}
          {aviso && <div data-testid="etiquetas-aviso" className="px-3 py-2 rounded-lg bg-[#FBF4E4] text-[#633806] text-[12.5px]">{aviso}</div>}
        </div>
        <div className="px-5 py-4 border-t border-[#3D2314]/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-[13px] rounded-lg border border-[#3D2314]/15 text-[#3D2314] hover:bg-[#3D2314]/5">
            Fechar
          </button>
          <button
            onClick={gerar}
            disabled={gerando || ids.length === 0}
            data-testid="etiquetas-gerar"
            className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-50 flex items-center gap-2"
          >
            {gerando ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Gerar PDF
          </button>
        </div>
      </div>
    </div>
  )
}
