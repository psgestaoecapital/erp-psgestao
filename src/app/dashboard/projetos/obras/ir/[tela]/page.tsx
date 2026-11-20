'use client'

// Hub · Execução da obra — resolvedor (auditoria CEO 20/11).
// As telas de execução vivem em /dashboard/projetos/obras/[id]/<tela> (precisam de uma obra).
// O menu "Execução da obra" aponta para cá: abrimos a tela na ÚLTIMA obra usada (1 toque, sem
// perguntar); se não houver, pedimos a obra numa lista enxuta (ainda 1 toque). Uma obra só: abre
// direto. RD-38: lista vem de fn_obras_listar por company_id (nada fixo). Identidade Espresso.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { HardHat, AlertTriangle, ChevronRight, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CHAVE_ULTIMA_OBRA } from '../../[id]/layout'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const ROTA = '/dashboard/projetos/obras/ir'

// Telas de execução que abrem por obra. A chave é a pasta real em obras/[id]/<chave>.
const TELAS: Record<string, string> = {
  cronograma: 'Cronograma',
  rdo: 'Diário de obra (RDO)',
  medicoes: 'Medições',
  subempreiteiros: 'Subempreiteiros',
  revisoes: 'Revisões',
  custos: 'Custos',
  materiais: 'Materiais',
  horas: 'Lançar horas',
  'portal-cliente': 'Portal do cliente',
  encerramento: 'Encerramento',
  relatorio: 'Relatório',
  'linha-do-tempo': 'Linha do tempo',
}

type ObraLite = { id: string; numero: string; nome: string; cliente_nome: string | null; status: string }

const ST_LABEL: Record<string, string> = {
  em_andamento: 'Em andamento', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada',
}

export default function ResolverObraTela() {
  const router = useRouter()
  const params = useParams<{ tela: string }>()
  const tela = typeof params?.tela === 'string' ? params.tela : ''
  const telaLabel = TELAS[tela]
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<ObraLite[] | null>(null)
  const [erro, setErro] = useState('')
  const [precisaEscolher, setPrecisaEscolher] = useState(false)
  const [busca, setBusca] = useState('')

  const ir = useCallback((obraId: string) => {
    try { window.localStorage.setItem(CHAVE_ULTIMA_OBRA, obraId) } catch { /* sem storage */ }
    router.replace(`/dashboard/projetos/obras/${obraId}/${tela}`)
  }, [router, tela])

  // Passo 1: tela inválida → board de obras. Passo 2: última obra usada → abre direto.
  useEffect(() => {
    if (!tela) return
    if (!telaLabel) { router.replace('/dashboard/projetos/obras'); return }
    let ultima = ''
    try { ultima = window.localStorage.getItem(CHAVE_ULTIMA_OBRA) || '' } catch { /* sem storage */ }
    if (ultima) { router.replace(`/dashboard/projetos/obras/${ultima}/${tela}`); return }
    setPrecisaEscolher(true)
  }, [tela, telaLabel, router])

  // Passo 3: sem última obra → busca a lista pra escolher.
  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setObras([]); return }
    setErro('')
    try {
      const { data, error } = await comPrazo(
        () => supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null }),
        { ms: 8000, tentativas: 1, label: 'resolver_obra_tela' })
      if (error) throw error
      const lista = (data || []) as ObraLite[]
      // Uma obra só → nem pergunta.
      if (lista.length === 1) { ir(lista[0].id); return }
      setObras(lista)
    } catch (e) {
      setErro(erroAmigavel(e) || MSG_CARREGAMENTO_FALHOU)
      setObras([])
    }
  }, [companyIds, ir])

  useEffect(() => { if (precisaEscolher) carregar() }, [precisaEscolher, carregar])

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const l = obras || []
    if (!t) return l
    return l.filter((o) =>
      (o.nome || '').toLowerCase().includes(t) ||
      (o.numero || '').toLowerCase().includes(t) ||
      (o.cliente_nome || '').toLowerCase().includes(t))
  }, [obras, busca])

  // Enquanto redireciona (tela válida + última obra, ou uma obra só), mostra "Carregando…"
  // em vez de estado vazio falso (auditoria CEO 20/11, item 5).
  if (!precisaEscolher) {
    return (
      <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', background: BG, color: MUT }}>
        <div style={{ textAlign: 'center' }}>
          <HardHat size={28} color={GOLD} style={{ marginBottom: 8 }} />
          <div>Carregando…</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 48px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <button
          onClick={() => router.push('/dashboard/projetos/obras')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: MUT, cursor: 'pointer', padding: 0, marginBottom: 12, fontSize: 13 }}
        >
          <ArrowLeft size={15} /> Obras
        </button>

        <h1 style={{ color: ESP, fontSize: 22, fontWeight: 800, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
          {telaLabel}
          <AjudaCampo chave="projetos.execucao.escolher_obra" rota={ROTA} />
        </h1>
        <p style={{ color: MUT, margin: '0 0 20px', fontSize: 14 }}>
          Escolha a obra para abrir <strong>{telaLabel}</strong>. Na próxima vez abrimos direto na última usada.
        </p>

        {obras === null && !erro && (
          <div style={{ color: MUT, padding: 24, textAlign: 'center' }}>Carregando obras…</div>
        )}

        {erro && (
          <div style={{ border: `1px solid ${LINE}`, background: '#fff', borderRadius: 12, padding: 16, display: 'flex', gap: 10, color: '#B91C1C' }}>
            <AlertTriangle size={18} />
            <div>{erro}</div>
          </div>
        )}

        {obras !== null && !erro && obras.length === 0 && (
          <div style={{ border: `1px dashed ${LINE}`, background: '#fff', borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <HardHat size={30} color={GOLD} style={{ marginBottom: 10 }} />
            <div style={{ color: ESP, fontWeight: 700, marginBottom: 4 }}>Nenhuma obra ainda</div>
            <div style={{ color: MUT, fontSize: 14, marginBottom: 16 }}>Cadastre a primeira obra para usar a execução.</div>
            <button
              onClick={() => router.push('/dashboard/projetos/obras/nova')}
              style={{ background: GOLD, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}
            >
              Nova obra
            </button>
          </div>
        )}

        {obras !== null && !erro && obras.length > 0 && (
          <>
            {obras.length > 6 && (
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por obra, número ou cliente"
                aria-label="Buscar obra"
                style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 14, background: '#fff', color: ESP }}
              />
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              {filtradas.map((o) => (
                <button
                  key={o.id}
                  onClick={() => ir(o.id)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', color: ESP, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.nome || o.numero}</span>
                    <span style={{ display: 'block', color: MUT, fontSize: 12.5 }}>
                      {o.numero}{o.cliente_nome ? ` · ${o.cliente_nome}` : ''}{o.status ? ` · ${ST_LABEL[o.status] || o.status}` : ''}
                    </span>
                  </span>
                  <ChevronRight size={18} color={GOLD} style={{ flexShrink: 0 }} />
                </button>
              ))}
              {filtradas.length === 0 && (
                <div style={{ color: MUT, padding: 16, textAlign: 'center' }}>Nenhuma obra encontrada para “{busca}”.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
