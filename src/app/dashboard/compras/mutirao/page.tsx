'use client'

// NFE-F3 · mutirão de notas: fila ordenada por quanto falta (E1), casamento exato em lote com prévia (E2),
// conferência em série (E3) reusando <ItensNfeRecebida>, e progresso visível (E6).
// 🛑 Concluir em lote (E4) NÃO existe ainda — aguarda a decisão da data de movimentação (Jordana + CEO).

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ListChecks, Loader2, Zap } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { ItensNfeRecebida } from '../documentos-recebidos/_components/ItensNfeRecebida'

type FilaNota = {
  id: string; numero: string | null; fornecedor: string | null; cnpj: string | null
  valor: number | null; emissao: string | null; total: number; resolvidos: number
  pronta: boolean; exato_disponivel: number; divergencia: boolean; idade: number
}
type PreviaVinc = { item_id: string; produto_nome: string; criterio: string; codigo: string | null; descricao: string }
const CRIT_LABEL: Record<string, string> = { depara: 'já aprendido do fornecedor', ean: 'código de barras', codigo: 'código do produto' }
const brl = (v: number | null) => 'R$ ' + Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

export default function MutiraoPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [fila, setFila] = useState<FilaNota[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<'todas' | 'prontas' | 'com_exato' | 'sem_vinculo'>('todas')
  const [aberta, setAberta] = useState<string | null>(null)     // nota em conferência (série)
  const [toast, setToast] = useState<string | null>(null)
  const [previa, setPrevia] = useState<{ vinculos: PreviaVinc[]; por_criterio: Record<string, number> } | null>(null)
  const [busy, setBusy] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresa) { setFila([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('fn_nfe_fila_conferencia', { p_company_id: empresa, p_filtro: { tipo: filtro } })
    const r = data as { ok?: boolean; notas?: FilaNota[] } | null
    setFila(r?.ok ? (r.notas ?? []) : [])
    setLoading(false)
  }, [empresa, filtro])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t) }, [toast])

  const prog = useMemo(() => {
    const total = fila.length
    const prontas = fila.filter((n) => n.pronta).length
    const itensRestantes = fila.reduce((s, n) => s + (n.total - n.resolvidos), 0)
    const comExato = fila.reduce((s, n) => s + n.exato_disponivel, 0)
    return { total, prontas, itensRestantes, comExato }
  }, [fila])

  // E2 · prévia do casamento exato (não grava) sobre a fila visível
  async function abrirPrevia() {
    if (!empresa || fila.length === 0) return
    setBusy(true)
    const { data } = await supabase.rpc('fn_nfe_vincular_lote_exato_previa', { p_company_id: empresa, p_nfe_ids: fila.map((n) => n.id) })
    setBusy(false)
    const r = data as { ok?: boolean; vinculos?: PreviaVinc[]; por_criterio?: Record<string, number> } | null
    if (!r?.ok || (r.vinculos?.length ?? 0) === 0) { setToast('Nenhum casamento exato disponível na fila atual.'); return }
    setPrevia({ vinculos: r.vinculos ?? [], por_criterio: r.por_criterio ?? {} })
  }
  async function aplicarLote() {
    if (!empresa) return
    setBusy(true)
    const { data } = await supabase.rpc('fn_nfe_vincular_lote_exato', { p_company_id: empresa, p_nfe_ids: fila.map((n) => n.id) })
    setBusy(false)
    const r = data as { ok?: boolean; vinculados?: number; notas_100_resolvidas?: number } | null
    setPrevia(null)
    setToast(`${r?.vinculados ?? 0} vínculos aplicados · ${r?.notas_100_resolvidas ?? 0} notas 100% resolvidas. O de-para nasceu para cada um — as próximas casam sozinhas.`)
    await carregar()
  }

  function proximaNota(atual: string) {
    const idx = fila.findIndex((n) => n.id === atual)
    const prox = fila.slice(idx + 1).find((n) => !n.pronta) ?? fila.find((n) => !n.pronta && n.id !== atual)
    setAberta(prox?.id ?? null)
  }

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-6 text-[#3D2314]">Selecione uma empresa específica no topo.</div>

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] text-[#3D2314]/60 tracking-[1px] uppercase font-medium mb-1">Compras · Volume</div>
            <h1 className="text-[24px] sm:text-[28px] font-medium text-[#3D2314] leading-tight flex items-center gap-2">
              <ListChecks size={22} className="text-[#C8941A]" /> Mutirão de notas
            </h1>
          </div>
          <Link href="/dashboard/compras/documentos-recebidos" className="text-[12px] text-[#BA7517] font-medium hover:underline mt-2">← Documentos recebidos</Link>
        </div>

        {/* E6 · progresso */}
        <div className="mt-4 bg-white border border-[#3D2314]/10 rounded-xl p-4">
          <div className="flex items-center justify-between text-[12px] text-[#3D2314]/70 mb-1.5">
            <span className="font-medium text-[#3D2314]">Fila de trabalho</span>
            <span>{prog.prontas} prontas · faltam {prog.total - prog.prontas} notas · {prog.itensRestantes} itens</span>
          </div>
          <div className="h-2.5 rounded-full bg-[#3D2314]/8 overflow-hidden">
            <div className="h-full bg-[#3F7012]" style={{ width: `${prog.total ? Math.round((prog.prontas / prog.total) * 100) : 0}%` }} />
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button type="button" disabled={busy || prog.comExato === 0} onClick={() => void abrirPrevia()}
              className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-[#C8941A] text-white font-medium hover:bg-[#A87810] disabled:opacity-40">
              <Zap size={13} /> Casamento exato em lote{prog.comExato > 0 ? ` (${prog.comExato} itens)` : ''}
            </button>
            {(['todas', 'prontas', 'com_exato', 'sem_vinculo'] as const).map((f) => (
              <button key={f} type="button" onClick={() => { setFiltro(f); setAberta(null) }}
                className={'text-[11.5px] px-2.5 py-1 rounded-md border ' + (filtro === f ? 'border-[#C8941A] text-[#A87810] bg-[#FBF3E0]' : 'border-[#3D2314]/15 text-[#3D2314]/60')}>
                {f === 'todas' ? 'Todas' : f === 'prontas' ? 'Prontas' : f === 'com_exato' ? 'Com casamento exato' : 'Sem nenhum vínculo'}
              </button>
            ))}
          </div>
        </div>

        {/* 🛑 E4 · honesto (RD-58): onde ficaria o concluir em lote */}
        <div className="mt-3 text-[12px] text-[#8a5a12] bg-[#FBF3E0] border border-[#C8941A]/25 rounded-lg px-3 py-2">
          Concluir várias notas de uma vez estará disponível quando a <strong>data de movimentação do estoque</strong> for definida (decisão da Jordana + CEO). Por ora, resolva os itens aqui — concluir cada nota segue na tela de documentos recebidos.
        </div>

        {toast && <div className="mt-3 text-[12px] px-3 py-2 rounded-md bg-[#E8F4DC] text-[#1B3608] border border-[#3F7012]/20">{toast}</div>}

        {/* E1 · fila ordenada por quanto falta */}
        <div className="mt-4 bg-white border border-[#3D2314]/10 rounded-xl overflow-hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-[#3D2314]/55 flex items-center justify-center gap-2 text-[13px]"><Loader2 className="animate-spin" size={15} /> Carregando…</div>
          ) : fila.length === 0 ? (
            <div className="px-6 py-16 text-center text-[13px] text-[#3D2314]/60">Fila vazia para este filtro. 🎉</div>
          ) : (
            <div className="divide-y divide-[#3D2314]/8">
              {fila.map((n) => (
                <div key={n.id}>
                  <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#3D2314] truncate">
                        {n.fornecedor ?? '(sem fornecedor)'} · NF {n.numero ?? '—'}
                        {n.divergencia && <span className="ml-2 text-[10.5px] text-[#BA7517]">⚠️ divergência</span>}
                      </div>
                      <div className="text-[11px] text-[#3D2314]/55 mt-0.5">{brl(n.valor)} · {n.idade} dias{n.exato_disponivel > 0 ? ` · ${n.exato_disponivel} casam sozinho` : ''}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={'text-[12px] font-semibold tabular-nums ' + (n.pronta ? 'text-[#3F7012]' : 'text-[#BA7517]')}>{n.resolvidos}/{n.total}{n.pronta ? ' ✅' : ''}</span>
                      <button type="button" onClick={() => setAberta(aberta === n.id ? null : n.id)}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-[#3D2314] text-[#FAF7F2] font-medium hover:bg-[#5A3520]">
                        {aberta === n.id ? 'Fechar' : 'Conferir'}
                      </button>
                    </div>
                  </div>
                  {/* E3 · conferência em série: reusa o componente; ao resolver, a fila reordena */}
                  {aberta === n.id && (
                    <div className="px-4 pb-4">
                      <ItensNfeRecebida nfeId={n.id} companyId={empresa} onChange={() => void carregar()} />
                      <div className="mt-2 flex items-center gap-2">
                        <button type="button" onClick={() => proximaNota(n.id)} className="text-[11px] px-3 py-1.5 rounded-md bg-[#3F7012] text-white font-medium hover:bg-[#2F5510]">Próxima nota →</button>
                        <button type="button" onClick={() => setAberta(null)} className="text-[11px] px-3 py-1.5 rounded-md border border-[#3D2314]/15 text-[#3D2314]/70">Pular</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* E2 · prévia obrigatória do casamento exato — nada é gravado sem o clique */}
      {previa && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={() => setPrevia(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[16px] font-medium text-[#3D2314] mb-1">Prévia · casamento exato</h2>
            <p className="text-[12px] text-[#3D2314]/65 mb-3">
              {previa.vinculos.length} vínculo(s) — {Object.entries(previa.por_criterio).map(([c, n]) => `${n} por ${CRIT_LABEL[c] ?? c}`).join(' · ')}. Só de-para, código de barras e código do produto. Nada por descrição.
            </p>
            <div className="rounded-lg border border-[#3D2314]/10 overflow-hidden divide-y divide-[#3D2314]/8 mb-3">
              {previa.vinculos.slice(0, 200).map((v) => (
                <div key={v.item_id} className="px-3 py-2 flex items-center justify-between gap-2 text-[12px]">
                  <span className="min-w-0 truncate text-[#3D2314]/80">{v.descricao}</span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[#3D2314] font-medium">→ {v.produto_nome}</span>
                    <span className="text-[10px] text-[#3D2314]/50">{CRIT_LABEL[v.criterio] ?? v.criterio}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPrevia(null)} className="px-3 py-1.5 rounded-md border border-[#3D2314]/15 text-[12px] text-[#3D2314]/70">Cancelar</button>
              <button type="button" disabled={busy} onClick={() => void aplicarLote()} className="px-4 py-1.5 rounded-md bg-[#3F7012] text-white text-[12px] font-medium disabled:opacity-50">Aplicar {previa.vinculos.length} vínculos</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
