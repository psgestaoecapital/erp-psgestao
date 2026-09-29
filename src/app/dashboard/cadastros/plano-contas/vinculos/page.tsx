'use client'

// Vínculos Gerencial × Contábil (CEO 29/09 · FC). Cada conta contábil analítica recebe uma conta gerencial:
// PROPOSTO (editável, descartável) → CONFIRMADO (imutável, regra da contabilidade 15/09). Ações em massa (propor,
// confirmar, descartar), criar/editar conta gerencial sem sair da tela, e filtro de pendências como padrão.
// Regras na migration 20260929060000 (fn_conta_contabil_vinculo_*) e em src/lib/contabil/vinculosTela.ts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { supabase } from '@/lib/supabase'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import PlanoContasForm, { type ContaPlano } from '@/components/ge/PlanoContasForm'
import { PSGC_COLORS, PSGC_RADIUS } from '@/lib/psgc-tokens'
import {
  FILTRO_PADRAO, MSG_IMUTAVEL, alvosDaSelecao, contarVinculos, editavel, filtrarVinculos, statusDaLinha,
  type FiltroVinculo, type LinhaVinculoTela,
} from '@/lib/contabil/vinculosTela'

export const dynamic = 'force-dynamic'

const C = PSGC_COLORS
const INK = C.espresso

const FILTROS: Array<[FiltroVinculo, string]> = [
  ['pendencias', 'Pendências'], ['sem_vinculo', 'Sem vínculo'], ['proposto', 'Propostos'], ['confirmado', 'Confirmados'], ['todas', 'Todas'],
]

export default function Page() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [linhas, setLinhas] = useState<LinhaVinculoTela[]>([])
  const [gerenciais, setGerenciais] = useState<ContaPlano[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroVinculo>(FILTRO_PADRAO)
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [gerMassa, setGerMassa] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [form, setForm] = useState<{ aberto: boolean; conta: ContaPlano | null }>({ aberto: false, conta: null })

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true); setErro(null)
    const [tela, ger] = await Promise.all([
      supabase.rpc('fn_conta_contabil_vinculo_tela', { p_company_id: empresa }),
      supabase.from('erp_plano_contas').select('id, codigo, descricao, grupo, tipo, pai_codigo, nivel, ativo, is_totalizador')
        .eq('company_id', empresa).order('codigo'),
    ])
    if (tela.error) setErro(tela.error.message)
    setLinhas((tela.data ?? []) as LinhaVinculoTela[])
    setGerenciais((ger.data ?? []) as ContaPlano[])
    setSel(new Set())
    setLoading(false)
  }, [empresa])

  useEffect(() => { void carregar() }, [carregar])

  const opcoesGer = useMemo(() => gerenciais.filter((g) => g.ativo && !g.is_totalizador), [gerenciais])
  const visiveis = useMemo(() => filtrarVinculos(linhas, filtro, busca), [linhas, filtro, busca])
  const cont = useMemo(() => contarVinculos(linhas), [linhas])
  const alvos = useMemo(() => alvosDaSelecao(linhas, sel), [linhas, sel])
  const selecionaveis = visiveis.filter(editavel)
  const todasMarcadas = selecionaveis.length > 0 && selecionaveis.every((l) => sel.has(l.conta_contabil_id))

  async function rodar(fn: () => Promise<{ data: unknown; error: { message: string } | null }>, okMsg: (d: Record<string, number>) => string) {
    setOcupado(true); setMsg(null)
    try {
      const { data, error } = await fn()
      const d = (data ?? {}) as Record<string, number> & { ok?: boolean; erro?: string; mensagem?: string }
      if (error) setMsg({ tipo: 'erro', texto: error.message })
      else if (d.ok === false) setMsg({ tipo: 'erro', texto: d.mensagem ?? (d.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : String(d.erro)) })
      else { setMsg({ tipo: 'ok', texto: okMsg(d) }); await carregar() }
    } finally { setOcupado(false) }
  }

  const propor = (contabilIds: string[], planoId: string) => rodar(
    async () => supabase.rpc('fn_conta_contabil_vinculo_propor', { p_company_id: empresa, p_conta_contabil_ids: contabilIds, p_plano_conta_id: planoId, p_origem: 'tela' }),
    (d) => `Proposta gravada: ${d.propostos ?? 0} nova(s), ${d.trocados ?? 0} trocada(s)${d.ignoradas_confirmadas ? `, ${d.ignoradas_confirmadas} confirmada(s) não alterada(s)` : ''}.`)

  function confirmarSelecionados() {
    const ids = alvos.confirmarVinculoIds
    if (ids.length === 0) return
    if (!window.confirm(`Confirmar ${ids.length} vínculo(s)?\n\n${MSG_IMUTAVEL}`)) return
    void rodar(async () => supabase.rpc('fn_conta_contabil_vinculo_confirmar', { p_company_id: empresa, p_vinculo_ids: ids }),
      (d) => `${d.confirmados ?? 0} vínculo(s) confirmado(s).`)
  }

  function descartarSelecionados() {
    const ids = alvos.descartarVinculoIds
    if (ids.length === 0) return
    if (!window.confirm(`Descartar ${ids.length} proposta(s)? A conta contábil volta para "sem vínculo".`)) return
    void rodar(async () => supabase.rpc('fn_conta_contabil_vinculo_descartar', { p_company_id: empresa, p_vinculo_ids: ids }),
      (d) => `${d.descartados ?? 0} proposta(s) descartada(s).`)
  }

  function alternar(id: string) {
    setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  if (!empresa) {
    return <div style={{ padding: 32, color: INK, background: C.offWhite, minHeight: '100vh' }}>Selecione uma empresa específica para vincular o plano de contas.</div>
  }

  return (
    <div style={{ background: C.offWhite, minHeight: '100vh', padding: '24px 16px 64px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <button type="button" onClick={() => router.push('/dashboard/cadastros/plano-contas')}
              style={{ background: 'transparent', color: INK, border: 'none', padding: 0, fontSize: 12, cursor: 'pointer', marginBottom: 8 }}>← Plano de Contas</button>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: INK, margin: 0, fontWeight: 400 }}>Vínculos · Gerencial × Contábil</h1>
            <div style={{ fontSize: 13, color: INK, marginTop: 4, maxWidth: 680 }}>
              Cada conta contábil recebe uma conta gerencial. A proposta pode ser trocada à vontade; depois de <b>confirmada</b>, não muda mais.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" data-testid="vinc-nova-gerencial" onClick={() => setForm({ aberto: true, conta: null })}
              style={{ background: 'transparent', color: INK, border: '1px solid rgba(61,35,20,0.3)', padding: '10px 14px', borderRadius: PSGC_RADIUS.md, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Nova conta gerencial</button>
            <button type="button" onClick={() => router.push('/dashboard/cadastros/plano-contas/relatorio')}
              style={{ background: C.espresso, color: '#fff', border: 'none', padding: '10px 14px', borderRadius: PSGC_RADIUS.md, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Ver relatório</button>
          </div>
        </div>

        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: PSGC_RADIUS.md, background: C.amareloSoft, color: INK, fontSize: 12.5 }}>
          {MSG_IMUTAVEL}
        </div>

        {msg && (
          <div data-testid="vinc-msg" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: PSGC_RADIUS.md, fontSize: 12.5,
            background: msg.tipo === 'ok' ? C.verdeSoft : C.vermelhoSoft, color: INK }}>{msg.texto}</div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: INK }}>Carregando…</div>
        ) : erro ? (
          <div style={{ padding: 16, borderRadius: PSGC_RADIUS.md, background: C.vermelhoSoft, color: INK }}>Não foi possível carregar: {erro}</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
              <PSGCMetric label="Contas contábeis" valor={cont.total} cor={C.espresso} />
              <PSGCMetric label="Sem vínculo" valor={cont.sem_vinculo} cor={cont.sem_vinculo ? C.alta : C.baixa} />
              <PSGCMetric label="Propostos" valor={cont.proposto} cor={C.espresso} />
              <PSGCMetric label="Confirmados" valor={cont.confirmado} cor={C.baixa} />
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              {FILTROS.map(([k, label]) => (
                <button key={k} type="button" data-testid={`vinc-filtro-${k}`} onClick={() => { setFiltro(k); setSel(new Set()) }}
                  style={{ padding: '7px 12px', borderRadius: PSGC_RADIUS.sm, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${filtro === k ? C.dourado : 'rgba(61,35,20,0.25)'}`, background: filtro === k ? C.dourado : 'transparent', color: INK }}>
                  {label}{k === 'pendencias' ? ` (${cont.pendencias})` : ''}
                </button>
              ))}
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar código ou descrição…" data-testid="vinc-busca"
                style={{ flex: '1 1 220px', minWidth: 180, padding: '8px 10px', border: '1px solid rgba(61,35,20,0.25)', borderRadius: PSGC_RADIUS.sm, fontSize: 12.5, color: INK, background: '#fff' }} />
            </div>

            <div data-testid="vinc-massa" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: '10px 12px', background: '#fff', border: '1px solid rgba(61,35,20,0.15)', borderRadius: PSGC_RADIUS.md }}>
              <span style={{ fontSize: 12.5, color: INK, fontWeight: 600 }}>{sel.size} selecionada(s)</span>
              <select value={gerMassa} onChange={(e) => setGerMassa(e.target.value)} data-testid="vinc-massa-gerencial"
                style={{ flex: '1 1 240px', padding: '8px 10px', border: '1px solid rgba(61,35,20,0.25)', borderRadius: PSGC_RADIUS.sm, fontSize: 12.5, color: INK, background: '#fff' }}>
                <option value="">— conta gerencial para as selecionadas —</option>
                {opcoesGer.map((g) => <option key={g.id} value={g.id}>{g.codigo} · {g.descricao}</option>)}
              </select>
              <button type="button" data-testid="vinc-massa-propor" disabled={ocupado || !gerMassa || alvos.proporContabilIds.length === 0}
                onClick={() => void propor(alvos.proporContabilIds, gerMassa)}
                style={botao(C.espresso, '#fff', ocupado || !gerMassa || alvos.proporContabilIds.length === 0)}>Propor ({alvos.proporContabilIds.length})</button>
              <button type="button" data-testid="vinc-massa-confirmar" disabled={ocupado || alvos.confirmarVinculoIds.length === 0} onClick={confirmarSelecionados}
                style={botao(C.dourado, INK, ocupado || alvos.confirmarVinculoIds.length === 0)}>Confirmar ({alvos.confirmarVinculoIds.length})</button>
              <button type="button" data-testid="vinc-massa-descartar" disabled={ocupado || alvos.descartarVinculoIds.length === 0} onClick={descartarSelecionados}
                style={botao('transparent', INK, ocupado || alvos.descartarVinculoIds.length === 0, true)}>Descartar proposta ({alvos.descartarVinculoIds.length})</button>
            </div>

            <div style={{ border: '1px solid rgba(61,35,20,0.2)', borderRadius: PSGC_RADIUS.lg, background: '#fff', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: C.offWhiteDark, color: INK, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <input type="checkbox" aria-label="Selecionar todas as visíveis" data-testid="vinc-sel-todas" checked={todasMarcadas} disabled={selecionaveis.length === 0}
                  onChange={() => setSel(todasMarcadas ? new Set() : new Set(selecionaveis.map((l) => l.conta_contabil_id)))} />
                <span style={{ flex: '1 1 300px' }}>Conta contábil</span>
                <span style={{ flex: '1 1 300px' }}>Conta gerencial</span>
                <span style={{ width: 96 }}>Situação</span>
              </div>
              {visiveis.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: INK }}>{filtro === 'pendencias' ? 'Nenhuma pendência: todas as contas contábeis estão confirmadas.' : 'Nenhuma conta neste filtro.'}</div>
              ) : visiveis.map((l) => {
                const st = statusDaLinha(l)
                const pode = editavel(l)
                return (
                  <div key={l.conta_contabil_id} data-testid={`vinc-linha-${l.cont_codigo}`} data-status={st}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', borderTop: '1px solid rgba(61,35,20,0.1)' }}>
                    <input type="checkbox" aria-label={`Selecionar ${l.cont_codigo}`} disabled={!pode} checked={sel.has(l.conta_contabil_id)} onChange={() => alternar(l.conta_contabil_id)} />
                    <div style={{ flex: '1 1 300px', minWidth: 220 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>{l.cont_codigo}</div>
                      <div style={{ fontSize: 12, color: INK }}>{l.cont_descricao}{l.cont_codigo_antigo ? ` · antigo ${l.cont_codigo_antigo}` : ''}</div>
                    </div>
                    <div style={{ flex: '1 1 300px', minWidth: 220 }}>
                      {pode ? (
                        <select value={l.plano_conta_id ?? ''} disabled={ocupado} data-testid={`vinc-ger-${l.cont_codigo}`}
                          onChange={(e) => { if (e.target.value) void propor([l.conta_contabil_id], e.target.value) }}
                          style={{ width: '100%', padding: '7px 9px', border: '1px solid rgba(61,35,20,0.25)', borderRadius: PSGC_RADIUS.sm, fontSize: 12.5, color: INK, background: '#fff' }}>
                          <option value="">— escolher conta gerencial —</option>
                          {opcoesGer.map((g) => <option key={g.id} value={g.id}>{g.codigo} · {g.descricao}</option>)}
                        </select>
                      ) : (
                        <div style={{ fontSize: 12.5, color: INK }} title={MSG_IMUTAVEL}>🔒 {l.ger_codigo} · {l.ger_descricao}</div>
                      )}
                    </div>
                    <span data-testid={`vinc-status-${l.cont_codigo}`} style={{ width: 96, fontSize: 11.5, fontWeight: 700, color: INK }}>
                      {st === 'confirmado' ? 'Confirmado' : st === 'proposto' ? 'Proposto' : 'Sem vínculo'}
                    </span>
                  </div>
                )
              })}
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 6 }}>Contas gerenciais</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {gerenciais.map((g) => (
                  <button key={g.id} type="button" data-testid={`vinc-editar-ger-${g.codigo}`} onClick={() => setForm({ aberto: true, conta: g })}
                    style={{ padding: '5px 9px', borderRadius: PSGC_RADIUS.sm, border: '1px solid rgba(61,35,20,0.2)', background: '#fff', color: INK, fontSize: 12, cursor: 'pointer', fontWeight: g.is_totalizador ? 700 : 400, opacity: g.ativo ? 1 : 0.6 }}>
                    ✎ {g.codigo} · {g.descricao}{g.ativo ? '' : ' (inativa)'}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {form.aberto && (
        <PlanoContasForm companyId={empresa} conta={form.conta} contasExistentes={gerenciais}
          onClose={() => setForm({ aberto: false, conta: null })}
          onSaved={() => { setForm({ aberto: false, conta: null }); setMsg({ tipo: 'ok', texto: 'Conta gerencial salva.' }); void carregar() }} />
      )}
    </div>
  )
}

function botao(bg: string, cor: string, desabilitado: boolean, contorno = false): React.CSSProperties {
  return {
    background: bg, color: cor, border: contorno ? '1px solid rgba(61,35,20,0.3)' : 'none', padding: '8px 14px',
    borderRadius: PSGC_RADIUS.sm, fontSize: 12.5, fontWeight: 700, cursor: desabilitado ? 'not-allowed' : 'pointer', opacity: desabilitado ? 0.5 : 1,
  }
}
