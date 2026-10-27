'use client'

// Prestação de contas assinada (auditor 24/10, gap "Adiantamento e prestação de contas"): o colaborador confere o acerto
// e assina com o nome completo; o gestor aprova pelo celular. Quem decide tudo é o banco (fn_viagem_assinar: nome igual
// ao da viagem, perfil de gestão, quem registrou o colaborador não aprova, acerto igual ao assinado). Mudou um cupom ou o
// adiantamento depois? A assinatura fica desatualizada e é preciso assinar de novo. Esta tela só lê e chama a função.
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, PenLine } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF'
type Assin = { nome: string; em: string; total: number; saldo: number; valida: boolean }
type Situacao = { colaborador: Assin | null; gestor: Assin | null; situacao: 'falta_colaborador' | 'falta_gestor' | 'aprovada' | 'desatualizada' }
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quando = (s: string) => new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const TEXTO: Record<Situacao['situacao'], string> = {
  falta_colaborador: 'Falta a assinatura do colaborador',
  falta_gestor: 'Assinada pelo colaborador · falta a aprovação do gestor',
  aprovada: 'Aprovada',
  desatualizada: 'O acerto mudou depois da assinatura: assine e aprove de novo',
}

export function AssinaturaAcerto({ viagemId, colaborador, podeGravar, versao }: { viagemId: string; colaborador: string; podeGravar: boolean; versao: string }) {
  const [s, setS] = useState<Situacao | null>(null)
  const [nome, setNome] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const ler = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_viagem_assinaturas', { p_viagem_id: viagemId })
    if (error) setMsg(error.message)
    setS((data as Situacao) ?? null)
  }, [viagemId])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- relê a situação quando a viagem ou os cupons mudam
  useEffect(() => { ler() }, [ler, versao])

  async function assinar(papel: 'colaborador' | 'gestor') {
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('fn_viagem_assinar', { p_viagem_id: viagemId, p_papel: papel, p_nome: nome })
    setBusy(false)
    const d = data as { ok?: boolean; erro?: string } | null
    if (error || !d?.ok) { setMsg(error?.message ?? d?.erro ?? 'Não foi possível assinar'); return }
    setNome(''); await ler()
  }

  if (!s) return null
  const papel: 'colaborador' | 'gestor' | null = s.situacao === 'aprovada' ? null : s.situacao === 'falta_gestor' ? 'gestor' : 'colaborador'
  return (
    <section className="rounded-xl border bg-white p-3 text-sm" style={{ borderColor: s.situacao === 'aprovada' ? '#86C99A' : LINE, color: ESP }} aria-label="Prestação de contas">
      <h3 className="flex items-center gap-1 font-semibold">{s.situacao === 'aprovada' ? <CheckCircle2 aria-hidden className="h-4 w-4 text-green-700" /> : <PenLine aria-hidden className="h-4 w-4" style={{ color: GOLD }} />}
        Prestação de contas<AjudaCampo chave="projetos.viagem.assin_situacao" /></h3>
      <p className="text-xs" style={{ color: s.situacao === 'desatualizada' ? '#B42318' : undefined }}>{TEXTO[s.situacao]}</p>
      <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
        <li>Colaborador<AjudaCampo chave="projetos.viagem.assin_colaborador" />: {s.colaborador ? <b className={s.colaborador.valida ? '' : 'line-through opacity-60'}>{s.colaborador.nome} · {quando(s.colaborador.em)} · total {brl(s.colaborador.total)}</b> : <span className="opacity-60">ainda não assinou</span>}</li>
        <li>Gestor<AjudaCampo chave="projetos.viagem.assin_gestor" />: {s.gestor ? <b className={s.gestor.valida ? '' : 'line-through opacity-60'}>{s.gestor.nome} · {quando(s.gestor.em)}</b> : <span className="opacity-60">ainda não aprovou</span>}</li>
      </ul>
      {papel && podeGravar && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs"><span>{papel === 'colaborador' ? `Nome completo do colaborador (${colaborador})` : 'Seu nome completo (gestor)'}<AjudaCampo chave="projetos.viagem.assin_nome" /></span>
            <input className="w-full rounded-lg border px-2 py-2 text-sm" autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} placeholder={papel === 'colaborador' ? colaborador : 'Nome do gestor'} /></label>
          <button disabled={busy || nome.trim().length < 3} className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-40" style={{ background: papel === 'colaborador' ? ESP : GOLD }} onClick={() => assinar(papel)}>
            {papel === 'colaborador' ? 'Assinar o acerto' : 'Aprovar o acerto'}</button>
        </div>
      )}
      {msg && <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800">{msg}</p>}
    </section>
  )
}
