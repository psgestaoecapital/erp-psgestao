'use client'

// Prévia do fechamento (auditor 24/10 · "nada irreversível sem prévia"): antes de fechar, mostra o total, o saldo com o
// colaborador e quanto cada obra recebe — lido da v_viagem_custo_obra, a mesma fonte do Resultado da obra (RD-35).
// Só lê; quem fecha é a fn_viagem_fechar (botão Confirmar, na página).
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF'
type PorObra = { obra_id: string; custo_total: number }
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function PreviaFechamento({ viagemId, total, saldoTexto, obraNome, busy, onConfirmar, onCancelar }: {
  viagemId: string; total: number; saldoTexto: string; obraNome: (id: string) => string; busy: boolean
  onConfirmar: () => void; onCancelar: () => void
}) {
  const [obras, setObras] = useState<PorObra[] | null>(null)
  useEffect(() => {
    supabase.from('v_viagem_custo_obra').select('obra_id,custo_total').eq('viagem_id', viagemId)
      .then(({ data }) => setObras(((data ?? []) as PorObra[]).sort((a, b) => b.custo_total - a.custo_total)))
  }, [viagemId])
  return (
    <div role="dialog" aria-label="Prévia do fechamento" className="space-y-2 rounded-xl border bg-white p-3" style={{ borderColor: GOLD, color: ESP }}>
      <h3 className="text-sm font-semibold">Prévia do fechamento<AjudaCampo chave="projetos.viagem.previa_fechar" /></h3>
      <p className="text-sm">Total <b>{brl(total)}</b> · {saldoTexto}</p>
      {obras == null ? <p className="text-xs opacity-60">Carregando o que vai para cada obra…</p> : (
        <ul className="divide-y text-sm" style={{ borderColor: LINE }}>{obras.map((o) => (
          <li key={o.obra_id} className="flex justify-between py-1"><span>{obraNome(o.obra_id)}<AjudaCampo chave="projetos.viagem.previa_obra" /></span><b>{brl(o.custo_total)}</b></li>))}</ul>)}
      <p className="text-xs opacity-70">Depois de fechada a viagem não se altera e o GE recebe o acerto por obra.</p>
      <div className="flex items-center gap-2">
        <button disabled={busy || obras == null} className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40" style={{ background: ESP }} onClick={onConfirmar}>Confirmar fechamento</button><AjudaCampo chave="projetos.viagem.previa_confirmar" />
        <button className="text-sm underline" onClick={onCancelar}>Voltar e conferir</button>
      </div>
    </div>
  )
}
