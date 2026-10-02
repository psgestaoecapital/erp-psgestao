'use client'
// BRIEFINGS (P&M). agency_briefings por company_id (RD-45). Bloco 1 · Pdois (CEO 02/10):
//  · o modal ganhou o campo "Briefing" (agency_briefings.descricao, que existia e não era usado) com editor de negrito,
//    listas e links; "Objetivo" virou campo grande; prazo desejado; "?" em cada campo;
//  · cliente vem do cadastro da empresa (erp_clientes, busca por nome/razão/CNPJ) — o banco liga ao perfil P&M;
//  · "Virar job" leva o briefing COMPLETO (objetivo, público, prazo, referências + texto) para o job, com prazo e cliente.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { FileText, Plus, ArrowRight, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { ClienteBusca } from '@/components/pm/ClienteBusca'
import { BriefingEditor, briefingParaJob } from '@/components/pm/BriefingEditor'

const STATUS: Record<string, { l: string; cls: string }> = {
  novo: { l: 'Novo', cls: 'bg-[#FFF3D6] text-[#6B4A0E]' },
  em_analise: { l: 'Em análise', cls: 'bg-[#FCE9C2] text-[#6B4A0E]' },
  aprovado: { l: 'Aprovado', cls: 'bg-[#DCEFD7] text-[#2F5A1F]' },
  virou_job: { l: 'Virou job', cls: 'bg-[#3D2314]/8 text-[#3D2314]' },
}

type Briefing = {
  id: string; company_id: string; cliente_id: string | null; titulo: string
  descricao: string | null; objetivo: string | null; publico_alvo: string | null
  referencias: string | null; tipo_servico: string | null; prioridade: string | null
  prazo_desejado: string | null; status: string; created_at: string
}
type Form = { cliente_id: string; cliente_nome: string; titulo: string; objetivo: string; descricao: string; publico_alvo: string; referencias: string; tipo_servico: string; prazo_desejado: string }
const VAZIO: Form = { cliente_id: '', cliente_nome: '', titulo: '', objetivo: '', descricao: '', publico_alvo: '', referencias: '', tipo_servico: '', prazo_desejado: '' }
const inp = 'w-full rounded-xl border border-[#3D2314]/15 bg-white px-3 py-2 text-[13.5px] text-[#3D2314] focus:border-[#C8941A] focus:outline-none'
const rot = 'mb-1 flex items-center text-[12px] font-semibold text-[#3D2314]'
const resumo = (t: string | null) => (t ?? '').replace(/[*_#>`[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)

export default function BriefingsPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [briefings, setBriefings] = useState<Briefing[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState(false)
  const [form, setForm] = useState<Form>(VAZIO)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ texto: string; jobId?: string } | null>(null)

  const carregar = async () => {
    if (!empresa) { setBriefings([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('agency_briefings').select('*').eq('company_id', empresa).order('created_at', { ascending: false })
    const lista = (data ?? []) as Briefing[]
    setBriefings(lista)
    const ids = [...new Set(lista.map((b) => b.cliente_id).filter(Boolean))] as string[]
    if (ids.length) {
      const { data: cl } = await supabase.from('agency_clientes').select('id, nome, nome_fantasia').in('id', ids)
      setNomes(Object.fromEntries(((cl ?? []) as { id: string; nome: string; nome_fantasia: string | null }[]).map((c) => [c.id, c.nome_fantasia || c.nome])))
    }
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t) }, [toast])

  const kpis = useMemo(() => ({
    total: briefings.length,
    pendentes: briefings.filter((b) => ['novo', 'em_analise'].includes(b.status)).length,
    viraramJob: briefings.filter((b) => b.status === 'virou_job').length,
  }), [briefings])

  async function criar() {
    if (!empresa) return
    if (!form.titulo.trim()) { setToast({ texto: 'Informe o título do briefing.' }); return }
    setBusy(true)
    const { error } = await supabase.from('agency_briefings').insert({
      company_id: empresa, cliente_id: form.cliente_id || null, titulo: form.titulo.trim(),
      objetivo: form.objetivo.trim() || null, descricao: form.descricao.trim() || null,
      publico_alvo: form.publico_alvo.trim() || null, referencias: form.referencias.trim() || null,
      tipo_servico: form.tipo_servico.trim() || null, prazo_desejado: form.prazo_desejado || null, status: 'novo',
    })
    setBusy(false)
    if (error) { setToast({ texto: `Erro: ${error.message}` }); return }
    setNovo(false); setForm(VAZIO)
    setToast({ texto: 'Briefing criado.' }); void carregar()
  }

  async function virarJob(b: Briefing) {
    if (!empresa) return
    if (!confirm(`Transformar "${b.titulo}" em job de produção? O briefing inteiro vai junto.`)) return
    setBusy(true)
    const { data: job, error } = await supabase.from('agency_jobs').insert({
      company_id: empresa, cliente_id: b.cliente_id, briefing_id: b.id,
      titulo: b.titulo, descricao: briefingParaJob(b) || null, tipo: b.tipo_servico ?? 'social',
      data_prazo: b.prazo_desejado, status: 'nao_iniciada', prioridade: 'normal',
    }).select('id').single()
    if (!error) await supabase.from('agency_briefings').update({ status: 'virou_job', updated_at: new Date().toISOString() }).eq('id', b.id)
    setBusy(false)
    setToast(error ? { texto: `Erro: ${error.message}` } : { texto: 'Job criado com o briefing completo.', jobId: (job as { id: string } | null)?.id })
    void carregar()
  }

  if (!empresa) return <div className="min-h-screen bg-[#FAF7F2] p-8 text-[13px] text-[#3D2314]/70">Selecione uma empresa no topo.</div>

  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 text-[#3D2314] md:p-6" data-testid="briefings-page">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C8941A]"><FileText size={13} /> P&amp;M · Atendimento</div>
            <h1 className="text-[26px] font-medium leading-tight">Briefings</h1>
            <p className="text-[13px] text-[#3D2314]/60">O pedido do cliente, registrado do jeito certo — e transformado em job com um toque.</p>
          </div>
          <button onClick={() => setNovo(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-[#3D2314] px-4 py-2.5 text-[13.5px] font-medium text-white shadow-sm hover:bg-[#3D2314]/90" data-testid="briefing-novo"><Plus size={15} /> Novo briefing</button>
        </header>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {[['Briefings', kpis.total], ['Pendentes', kpis.pendentes], ['Viraram job', kpis.viraramJob]].map(([l, v]) => (
            <div key={l as string} className="rounded-2xl border border-[#3D2314]/10 bg-white px-4 py-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#3D2314]/55">{l}</div>
              <div className="text-[22px] font-medium">{v}</div>
            </div>
          ))}
        </div>

        {loading ? <div className="p-10 text-center text-[13px] text-[#3D2314]/55">Carregando…</div>
          : briefings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#3D2314]/20 bg-white p-10 text-center">
              <div className="text-[15px] font-medium">Nenhum briefing ainda</div>
              <p className="mt-1 text-[13px] text-[#3D2314]/60">Registre o briefing da reunião com o cliente: objetivo, mensagem, entregáveis, prazos e o que evitar.</p>
              <button onClick={() => setNovo(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#C8941A] px-4 py-2 text-[13px] font-medium text-white"><Plus size={14} /> Novo briefing</button>
            </div>
          ) : (
            <div className="grid gap-2">
              {briefings.map((b) => {
                const st = STATUS[b.status] ?? { l: b.status, cls: 'bg-white' }
                return (
                  <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#3D2314]/10 bg-white px-4 py-3" data-testid="briefing-item">
                    <div className="min-w-[200px] flex-1">
                      <div className="font-medium">{b.titulo}<span className="font-normal text-[#3D2314]/55"> · {b.cliente_id ? (nomes[b.cliente_id] ?? 'cliente') : 'sem cliente'}</span></div>
                      {(b.objetivo || b.descricao) && <div className="mt-0.5 text-[12.5px] text-[#3D2314]/65">{resumo(b.objetivo || b.descricao)}</div>}
                      {b.prazo_desejado && <div className="mt-0.5 text-[11.5px] text-[#3D2314]/50">prazo desejado {b.prazo_desejado.split('-').reverse().join('/')}</div>}
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.l}</span>
                    {b.status !== 'virou_job'
                      ? <button disabled={busy} onClick={() => void virarJob(b)} className="inline-flex items-center gap-1 rounded-xl border border-[#2F5A1F] px-3 py-1.5 text-[12.5px] font-medium text-[#2F5A1F] disabled:opacity-40" data-testid="briefing-virar-job">Virar job <ArrowRight size={14} /></button>
                      : <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#2F5A1F]"><CheckCircle2 size={14} /> em produção</span>}
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {novo && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-0 sm:p-4" onClick={() => setNovo(false)}>
          <div className="min-h-full w-full bg-white p-5 sm:mt-8 sm:min-h-0 sm:max-w-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()} data-testid="briefing-modal">
            <h2 className="mb-3 text-[19px] font-medium">Novo briefing</h2>
            <div className="space-y-3">
              <ClienteBusca empresa={empresa} valorNome={form.cliente_nome} testId="briefing-cliente"
                onEscolher={(id, nome) => setForm({ ...form, cliente_id: id, cliente_nome: nome })} onLimpar={() => setForm({ ...form, cliente_id: '', cliente_nome: '' })} />
              <label className="block"><span className={rot}>Título *<AjudaCampo chave="pm.briefing.titulo" /></span>
                <input className={inp} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Campanha Dia das Crianças — carrossel + stories" data-testid="briefing-titulo" /></label>
              <label className="block"><span className={rot}>Objetivo<AjudaCampo chave="pm.briefing.objetivo" /></span>
                <textarea rows={4} className={`${inp} resize-y`} value={form.objetivo} onChange={(e) => setForm({ ...form, objetivo: e.target.value })} placeholder="Qual resultado o cliente quer com isso?" data-testid="briefing-objetivo" /></label>
              <BriefingEditor value={form.descricao} onChange={(v) => setForm({ ...form, descricao: v })} ajuda="pm.briefing.texto" testid="briefing-texto" linhas={10} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className={rot}>Público-alvo<AjudaCampo chave="pm.briefing.publico" /></span>
                  <input className={inp} value={form.publico_alvo} onChange={(e) => setForm({ ...form, publico_alvo: e.target.value })} data-testid="briefing-publico" /></label>
                <label className="block"><span className={rot}>Tipo de serviço<AjudaCampo chave="pm.briefing.tipo" /></span>
                  <input className={inp} value={form.tipo_servico} onChange={(e) => setForm({ ...form, tipo_servico: e.target.value })} placeholder="social, design, vídeo…" data-testid="briefing-tipo" /></label>
                <label className="block"><span className={rot}>Prazo desejado<AjudaCampo chave="pm.briefing.prazo" /></span>
                  <input type="date" className={inp} value={form.prazo_desejado} onChange={(e) => setForm({ ...form, prazo_desejado: e.target.value })} data-testid="briefing-prazo" /></label>
                <label className="block"><span className={rot}>Referências<AjudaCampo chave="pm.briefing.referencias" /></span>
                  <input className={inp} value={form.referencias} onChange={(e) => setForm({ ...form, referencias: e.target.value })} placeholder="links, exemplos" data-testid="briefing-referencias" /></label>
              </div>
            </div>
            <div className="sticky bottom-0 mt-4 flex justify-end gap-2 bg-white pt-2">
              <button onClick={() => setNovo(false)} className="rounded-xl border border-[#3D2314]/15 px-4 py-2 text-[13px]">Cancelar</button>
              <button disabled={busy} onClick={() => void criar()} className="rounded-xl bg-[#3D2314] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40" data-testid="briefing-salvar">{busy ? 'Salvando…' : 'Criar briefing'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full bg-[#3D2314] px-4 py-2 text-[13px] text-white shadow-lg" data-testid="briefing-toast">
          {toast.texto}
          {toast.jobId && <Link href={`/dashboard/pm/pauta?job=${toast.jobId}`} className="font-semibold text-[#E8C474] underline">abrir o job</Link>}
        </div>
      )}
    </div>
  )
}
