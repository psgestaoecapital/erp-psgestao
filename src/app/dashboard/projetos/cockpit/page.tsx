'use client'

// HB0 · Cockpit — porta de entrada do menu: escolhe a obra e abre /obras/[id]/cockpit (1 obra = abre direto).
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

const ROTA = '/dashboard/projetos/cockpit'
// Cada situação tem cor e fundo próprios (pílula) — leitura imediata, sem tudo em dourado. Mesmo padrão da OS de obra.
const STATUS: Record<string, { rotulo: string; cor: string; fundo: string }> = {
  em_andamento: { rotulo: 'Em andamento', cor: '#92400E', fundo: 'rgba(200,148,26,0.18)' },
  concluida: { rotulo: 'Concluída', cor: '#15803D', fundo: 'rgba(21,128,61,0.12)' },
  pausada: { rotulo: 'Pausada', cor: '#6B5B4D', fundo: 'rgba(61,35,20,0.07)' },
  cancelada: { rotulo: 'Cancelada', cor: '#B91C1C', fundo: 'rgba(185,28,28,0.08)' },
}
const situacao = (s: string) => STATUS[s] ?? { rotulo: s, cor: GOLD, fundo: 'rgba(200,148,26,0.12)' }

const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type ObraLinha = {
  obra_id: string; numero: string; nome: string | null; status: string
  receita_prevista: number; receita_servico: number; receita_material: number
  custo_previsto: number; custo_material: number; custo_viagens: number
  custo_mao_obra: number | null; custo_rateio: number | null
  margem_alocada: number | null; margem_realizada: number
}
const num = (v: unknown) => Number(v ?? 0)
const resumo = (o: ObraLinha) => {
  const receita = num(o.receita_servico) + num(o.receita_material)
  const custo = num(o.custo_material) + num(o.custo_viagens) + num(o.custo_mao_obra) + num(o.custo_rateio)
  const margem = num(o.margem_alocada ?? o.margem_realizada)
  const avanco = num(o.receita_prevista) > 0 ? Math.min(100, (num(o.receita_servico) / num(o.receita_prevista)) * 100) : null
  const estouro = num(o.custo_previsto) > 0 && custo > num(o.custo_previsto)
  return { receita, custo, margem, avanco, estouro }
}

export default function CockpitEscolherObraPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<ObraLinha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todas')

  useEffect(() => {
    if (!companyIds?.length) { setLoading(false); return }
    let vivo = true
    ;(async () => {
      try {
        const { data, error } = await comPrazo(
          async () => await supabase.from('v_obra_resultado_alocado').select('obra_id,numero,nome,status,receita_prevista,receita_servico,receita_material,custo_previsto,custo_material,custo_viagens,custo_mao_obra,custo_rateio,margem_alocada,margem_realizada').in('company_id', companyIds).order('numero', { ascending: false }),
          { ms: 8000, tentativas: 1, label: 'cockpit-obras' },
        )
        if (!vivo) return
        if (error) { setErro(error.message); return }
        const lista = (data ?? []) as ObraLinha[]
        if (lista.length === 1) { router.replace(`/dashboard/projetos/obras/${lista[0].obra_id}/cockpit?area=hub`); return }
        setObras(lista)
      } catch { if (vivo) setErro(MSG_CARREGAMENTO_FALHOU) } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false }
  }, [companyIds, router])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return obras.filter(o => (filtro === 'todas' || o.status === filtro) && (!q || `${o.numero} ${o.nome ?? ''}`.toLowerCase().includes(q)))
  }, [obras, busca, filtro])

  return (
    <div style={{ background: BG, padding: '20px 24px', color: ESP }} data-testid="cockpit-escolher">
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Cockpit da obra <AjudaCampo chave="projetos.cockpit.escolher_obra" rota={ROTA} /></h1>
      <p style={{ color: MUT, fontSize: 13, margin: '4px 0 16px' }}>Escolha a obra para ver avanço, custo, margem e pendências numa tela só.</p>
      {obras.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por código ou nome" aria-label="Buscar obra" data-testid="cockpit-busca"
            style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minWidth: 220, background: '#fff', color: ESP }} />
          <AjudaCampo chave="projetos.cockpit.busca" rota={ROTA} />
          <select value={filtro} onChange={e => setFiltro(e.target.value)} aria-label="Filtrar por situação" data-testid="cockpit-filtro-situacao"
            style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, background: '#fff', color: ESP }}>
            <option value="todas">Todas as situações</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
          </select>
          <AjudaCampo chave="projetos.cockpit.filtro_situacao" rota={ROTA} />
          <span style={{ fontSize: 12, color: MUT }}>{visiveis.length} de {obras.length} obra(s)</span>
        </div>
      )}
      {obras.length > 0 && visiveis.length === 0 && <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra com esse filtro.</div>}
      {loading && <div style={{ color: MUT }}>Carregando…</div>}
      {erro && <div style={{ background: '#FBEAEA', color: '#B91C1C', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>{erro}</div>}
      {!loading && !erro && obras.length === 0 && (
        <div style={{ color: MUT, fontSize: 14 }}>Nenhuma obra ainda. Aprove um orçamento para criar a primeira obra em <Link href="/dashboard/projetos/obras?area=hub" style={{ color: ESP, textDecoration: 'underline' }}>Obras</Link>.</div>
      )}
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
        {visiveis.map(o => { const r = resumo(o); return (
          <Link key={o.obra_id} href={`/dashboard/projetos/obras/${o.obra_id}/cockpit?area=hub`} data-testid="cockpit-obra-link"
            style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 14px', textDecoration: 'none', color: ESP }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{o.numero}</div>
            <div style={{ fontSize: 13, color: MUT, marginTop: 2 }}>{o.nome || 'Sem nome'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, color: situacao(o.status).cor, border: `1px solid ${situacao(o.status).cor}`, background: situacao(o.status).fundo, borderRadius: 999, padding: '2px 9px' }}>{situacao(o.status).rotulo}</span>
              <AjudaCampo chave="projetos.cockpit.status_obra" rota={ROTA} />
            </div>
            <div style={{ marginTop: 10, height: 6, borderRadius: 999, background: 'rgba(61,35,20,0.08)' }} title="Avanço financeiro (medido ÷ contratado)">
              <div style={{ width: `${r.avanco ?? 0}%`, height: '100%', borderRadius: 999, background: GOLD }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginTop: 8, fontSize: 11, color: MUT }}>
              <div>Avanço <AjudaCampo chave="projetos.cockpit.avanco" rota={ROTA} /><div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{r.avanco == null ? '—' : `${r.avanco.toFixed(0)}%`}</div></div>
              <div>Custo <AjudaCampo chave="projetos.cockpit.custo" rota={ROTA} /><div style={{ fontSize: 14, fontWeight: 700, color: r.estouro ? '#B91C1C' : ESP }}>{brl(r.custo)}</div></div>
              <div>Margem <AjudaCampo chave="projetos.cockpit.margem" rota={ROTA} /><div style={{ fontSize: 14, fontWeight: 700, color: r.margem < 0 ? '#B91C1C' : '#15803D' }}>{brl(r.margem)}</div></div>
            </div>
            {r.estouro && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: '#B91C1C' }}>Custo acima do previsto</div>}
          </Link>
        )})}
      </div>
    </div>
  )
}
