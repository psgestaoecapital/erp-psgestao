'use client'
// #1677 etapa 4 · Ordem de Fornecimento: condições do pedido (entrega, frete CIF/FOB, pagamento, observações) e o PDF
// com os dados das duas empresas e o texto obrigatório para a NF. Usado no pedido de compra (Cotações & Compras) e em
// Pendências de compra (quem confere o recebimento baixa a mesma OF).
import { useState } from 'react'
import { FileDown, Loader2, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { carregarOrdemFornecimento } from '@/lib/compras/carregarOrdemFornecimento'
import { FORMA_ROTULO, FRETE_ROTULO, montarOrdemFornecimentoPdf, nomeArquivoOF, pendenciasOF } from '@/lib/compras/ordemFornecimentoPdf'

const ROTA = '/dashboard/commerce/compras'

export type CondicoesOF = {
  data_prevista: string | null; frete_tipo: string | null; transportadora: string | null
  condicao_pagamento: string | null; forma_pagamento: string | null; observacoes: string | null
}

function hojeISO(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

async function baixarOF(compraId: string): Promise<string[]> {
  const dados = await carregarOrdemFornecimento(compraId, hojeISO())
  const bytes = await montarOrdemFornecimentoPdf(dados)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url; a.download = nomeArquivoOF(dados.numero)
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return pendenciasOF(dados)
}

export function BotaoOrdemFornecimento({ compraId, rota = ROTA }: { compraId: string; rota?: string }) {
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function clicar() {
    setOcupado(true); setMsg(null)
    try {
      const falta = await baixarOF(compraId)
      if (falta.length) setMsg(`OF baixada. Falta preencher no pedido: ${falta.join(', ')}.`)
    } catch (e) {
      setMsg(`Não foi possível gerar a OF: ${(e as Error).message}`)
    } finally { setOcupado(false) }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button type="button" onClick={clicar} disabled={ocupado} data-testid="compras-of-baixar"
        className="inline-flex items-center gap-1 rounded-lg border border-amber-700 px-3 py-2 text-sm font-medium text-amber-800 disabled:opacity-60">
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Ordem de Fornecimento (PDF)
      </button>
      <AjudaCampo chave="compras.of.baixar" rota={rota} />
      {msg && <span className="w-full text-xs text-amber-800">{msg}</span>}
    </span>
  )
}

export default function OrdemFornecimentoCard({ compraId, inicial, editavel, onSalvo }: {
  compraId: string; inicial: CondicoesOF; editavel: boolean; onSalvo: (c: CondicoesOF) => void
}) {
  const [c, setC] = useState<CondicoesOF>(inicial)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const set = (k: keyof CondicoesOF, v: string) => setC((p) => ({ ...p, [k]: v.trim() === '' ? null : v }))
  const campo = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50'
  const rotulo = 'flex items-center gap-1 text-xs font-medium text-gray-700'

  async function salvar() {
    setSalvando(true); setMsg(null)
    const { error } = await supabase.from('erp_compras').update({ ...c, updated_at: new Date().toISOString() }).eq('id', compraId)
    setSalvando(false)
    if (error) { setMsg(`Erro ao salvar: ${error.message}`); return }
    onSalvo(c); setMsg('Condições salvas.')
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4" data-testid="compras-of-card">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Ordem de Fornecimento</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={rotulo}>Entrega prevista <AjudaCampo chave="compras.of.data_prevista" rota={ROTA} /></span>
          <input type="date" className={campo} disabled={!editavel} value={c.data_prevista ?? ''} onChange={(e) => set('data_prevista', e.target.value)} />
        </label>
        <label className="block">
          <span className={rotulo}>Frete <AjudaCampo chave="compras.of.frete_tipo" rota={ROTA} /></span>
          <select className={campo} disabled={!editavel} value={c.frete_tipo ?? ''} onChange={(e) => set('frete_tipo', e.target.value)} data-testid="compras-of-frete">
            <option value="">A combinar</option>
            {Object.entries(FRETE_ROTULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={rotulo}>Transportadora <AjudaCampo chave="compras.of.transportadora" rota={ROTA} /></span>
          <input className={campo} disabled={!editavel} value={c.transportadora ?? ''} onChange={(e) => set('transportadora', e.target.value)} />
        </label>
        <label className="block">
          <span className={rotulo}>Condição de pagamento <AjudaCampo chave="compras.of.condicao_pagamento" rota={ROTA} /></span>
          <input className={campo} disabled={!editavel} placeholder="Ex.: 28/56 dias" value={c.condicao_pagamento ?? ''} onChange={(e) => set('condicao_pagamento', e.target.value)} />
        </label>
        <label className="block">
          <span className={rotulo}>Forma de pagamento <AjudaCampo chave="compras.of.forma_pagamento" rota={ROTA} /></span>
          <select className={campo} disabled={!editavel} value={c.forma_pagamento ?? ''} onChange={(e) => set('forma_pagamento', e.target.value)}>
            <option value="">A combinar</option>
            {Object.entries(FORMA_ROTULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className={rotulo}>Observações para o fornecedor <AjudaCampo chave="compras.of.observacoes" rota={ROTA} /></span>
          <textarea rows={2} className={campo} disabled={!editavel} value={c.observacoes ?? ''} onChange={(e) => set('observacoes', e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editavel && (
          <span className="inline-flex items-center gap-1">
            <button type="button" onClick={salvar} disabled={salvando} data-testid="compras-of-salvar"
              className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar condições
            </button>
            <AjudaCampo chave="compras.of.salvar" rota={ROTA} />
          </span>
        )}
        <BotaoOrdemFornecimento compraId={compraId} />
      </div>
      {!editavel && <p className="mt-2 text-xs text-gray-500">As condições ficam travadas depois que o financeiro do pedido foi gerado ou o pedido foi encerrado.</p>}
      {msg && <p className="mt-2 text-xs text-gray-700">{msg}</p>}
    </section>
  )
}
