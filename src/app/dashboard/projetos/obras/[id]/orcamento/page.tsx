'use client'
// Hub · Gestão de Obras · Orçamento por EAP (blueprint vivo tela 315, Onda C-2).
// Slice 1 (leitura): árvore da EAP com material × mão de obra × total e % por nó, mais o toggle Etapa/Local.
// Só leitura de fn_projetos_orcamento_eap_arvore (SECURITY DEFINER, guarda por empresa). O editor "+ Item" e o
// importador xlsx (tela 334) vêm nas próximas fatias. Aberta pelo cockpit da obra.
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { ehUuid, erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/projetos/obras/[id]/orcamento'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)', VERM = '#B91C1C'
const brl = (n: number | null | undefined) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`

// Nó da árvore EAP (modo 'eap')
type NoEap = { eap_codigo: string; nome: string; nivel: number; parent_codigo: string | null; material: number; mao_obra: number; total: number; pct: number }
// Linha por local (modo 'local')
type NoLocal = { local_tipo: string | null; local_nome: string; material: number; mao_obra: number; total: number; pct: number }
type Arvore = {
  orcamento_id: string; modo: 'eap' | 'local'
  total_geral: number; material_geral: number; mao_obra_geral: number
  nos: NoEap[] | NoLocal[]
}
type ObraInfo = { numero: string; nome: string | null; orcamento_id: string | null }

export default function OrcamentoEapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [obra, setObra] = useState<ObraInfo | null>(null)
  const [arvore, setArvore] = useState<Arvore | null>(null)
  const [porLocal, setPorLocal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // nós recolhidos (chave = eap_codigo). Começa tudo expandido.
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set())

  const carregar = useCallback(async () => {
    if (!ehUuid(id)) { setLoading(false); setErro('Obra não encontrada. Abra pela lista de obras.'); return }
    setLoading(true); setErro(null)
    const { data: od, error: oe } = await supabase.from('projetos_obras').select('numero,nome,orcamento_id').eq('id', id).maybeSingle()
    if (oe || !od) { setLoading(false); setErro(erroAmigavel(oe, 'Não foi possível carregar a obra.')); return }
    const info = od as ObraInfo
    setObra(info)
    if (!info.orcamento_id) { setLoading(false); setArvore(null); return }
    const { data, error } = await supabase.rpc('fn_projetos_orcamento_eap_arvore', { p_orcamento_id: info.orcamento_id, p_por_local: porLocal })
    setLoading(false)
    if (error || !data) { setErro(erroAmigavel(error, 'Não foi possível carregar o orçamento.')); return }
    setArvore(data as Arvore)
  }, [id, porLocal])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  // modo EAP: monta a árvore a partir da lista achatada (parent_codigo → filhos)
  const filhosPorPai = useMemo(() => {
    const m = new Map<string | null, NoEap[]>()
    if (arvore?.modo === 'eap') {
      for (const n of arvore.nos as NoEap[]) {
        const k = n.parent_codigo
        if (!m.has(k)) m.set(k, [])
        m.get(k)!.push(n)
      }
      for (const arr of m.values()) arr.sort((a, b) => a.eap_codigo.localeCompare(b.eap_codigo, undefined, { numeric: true }))
    }
    return m
  }, [arvore])

  const alternar = (cod: string) => setRecolhidos((s) => { const n = new Set(s); if (n.has(cod)) n.delete(cod); else n.add(cod); return n })

  const barra = (p: number) => (
    <div style={{ height: 5, borderRadius: 3, background: LINE, overflow: 'hidden', minWidth: 48, flex: '0 0 48px' }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, p))}%`, background: GOLD }} />
    </div>
  )

  const linhaNo = (n: NoEap) => {
    const filhos = filhosPorPai.get(n.eap_codigo) ?? []
    const temFilhos = filhos.length > 0
    const aberto = !recolhidos.has(n.eap_codigo)
    const recuo = (n.nivel - 1) * 16
    return (
      <div key={n.eap_codigo}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, paddingLeft: recuo }}>
            {temFilhos ? (
              <button data-testid={`orc-toggle-${n.eap_codigo}`} aria-label={aberto ? 'Recolher' : 'Expandir'} onClick={() => alternar(n.eap_codigo)}
                style={{ border: 'none', background: 'transparent', color: GOLD, fontSize: 12, fontWeight: 700, cursor: 'pointer', width: 16 }}>{aberto ? '▾' : '▸'}</button>
            ) : <span style={{ width: 16, color: MUT, textAlign: 'center' }}>•</span>}
            <span style={{ fontSize: 11, color: MUT, fontFamily: 'ui-monospace, monospace', flex: '0 0 auto' }}>{n.eap_codigo}</span>
            <span style={{ fontSize: 14, color: ESP, fontWeight: n.nivel <= 1 ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.nome}</span>
          </div>
          <span style={{ fontSize: 13, color: ESP, fontWeight: 600, flex: '0 0 auto', textAlign: 'right' }}>{brl(n.total)}</span>
          {barra(n.pct)}
          <span style={{ fontSize: 11, color: MUT, flex: '0 0 44px', textAlign: 'right' }}>{pct(n.pct)}</span>
        </div>
        {temFilhos && aberto && filhos.map((f) => linhaNo(f))}
      </div>
    )
  }

  const raizes = arvore?.modo === 'eap' ? (filhosPorPai.get(null) ?? []) : []
  const locais = arvore?.modo === 'local' ? (arvore.nos as NoLocal[]) : []
  const vazio = !!obra && (!obra.orcamento_id || (arvore != null && arvore.nos.length === 0))

  const chip = (ativo: boolean) => ({
    padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer' as const,
    border: `1px solid ${ativo ? ESP : LINE}`, background: ativo ? ESP : '#fff', color: ativo ? '#fff' : MUT,
  })

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }} data-testid="hub-obra-orcamento">
        <Link href={`/dashboard/projetos/obras/${id}/cockpit?area=hub`} style={{ fontSize: 12, color: GOLD, textDecoration: 'none', fontWeight: 600 }}>← Cockpit da obra</Link>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 8 }}>Hub · Obra{obra ? ` · ${obra.numero}` : ''}</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: ESP, margin: '2px 0 4px' }}>Orçamento por EAP</h1>
        <div style={{ fontSize: 13, color: MUT, marginBottom: 14 }}>O custo da obra estruturado pela EAP (serviço × local), com material e mão de obra separados. Veja o total e o peso de cada etapa.</div>

        {erro && <div role="alert" data-testid="orc-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>{erro}</div>}

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div> : vazio ? (
          <div data-testid="orc-vazio" style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 15, color: ESP, fontWeight: 600, marginBottom: 6 }}>Orçamento ainda sem itens</div>
            <div style={{ fontSize: 13, color: MUT, lineHeight: 1.5 }}>
              {obra && !obra.orcamento_id
                ? 'Esta obra ainda não tem um orçamento vinculado. Crie o orçamento da obra e volte aqui para montar a EAP.'
                : 'O orçamento está vinculado, mas ainda não tem itens. Adicione serviços por etapa e local — ou importe a planilha da obra pelo importador (em breve).'}
            </div>
          </div>
        ) : arvore && (
          <div style={{ display: 'grid', gap: 14 }}>
            {/* Totais do orçamento */}
            <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Total do orçamento <AjudaCampo chave="projetos.orcamento_eap.total" rota={ROTA} /></div>
                <div style={{ fontSize: 22, color: ESP, fontWeight: 700 }}>{brl(arvore.total_geral)}</div>
              </div>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Material <AjudaCampo chave="projetos.orcamento_eap.material" rota={ROTA} /></div>
                <div style={{ fontSize: 18, color: ESP, fontWeight: 600 }}>{brl(arvore.material_geral)}</div>
              </div>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>Mão de obra <AjudaCampo chave="projetos.orcamento_eap.mao_obra" rota={ROTA} /></div>
                <div style={{ fontSize: 18, color: ESP, fontWeight: 600 }}>{brl(arvore.mao_obra_geral)}</div>
              </div>
            </div>

            {/* Toggle Etapa / Local */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: MUT, fontWeight: 600 }}>Agrupar por</span>
              <button data-testid="orc-modo-eap" onClick={() => setPorLocal(false)} style={chip(!porLocal)}>Etapa (EAP)</button>
              <button data-testid="orc-modo-local" onClick={() => setPorLocal(true)} style={chip(porLocal)}>Local</button>
              <AjudaCampo chave="projetos.orcamento_eap.agrupar" rota={ROTA} />
            </div>

            {/* Árvore / lista */}
            <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '4px 16px 12px' }} data-testid="orc-arvore">
              {arvore.modo === 'eap'
                ? raizes.map((n) => linhaNo(n))
                : locais.map((l, i) => (
                  <div key={`${l.local_tipo ?? 'x'}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${LINE}` }}>
                    <span style={{ fontSize: 14, color: ESP, fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.local_nome}</span>
                    <span style={{ fontSize: 13, color: ESP, fontWeight: 600, flex: '0 0 auto', textAlign: 'right' }}>{brl(l.total)}</span>
                    {barra(l.pct)}
                    <span style={{ fontSize: 11, color: MUT, flex: '0 0 44px', textAlign: 'right' }}>{pct(l.pct)}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
