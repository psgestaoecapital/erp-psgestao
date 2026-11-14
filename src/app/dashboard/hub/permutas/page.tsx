'use client'
// Hub > Financeiro > Permutas (CEO 12/11, ctx 74dfdb57). Cada permuta é uma CONTA-CORRENTE DE IMÓVEL:
// valor do contrato + reajuste CUB = valor atualizado; quita por material/serviço/dinheiro/imóvel; saldo = atualizado − quitado.
// Multi-CNPJ (chips Todas/empresa/Consolidado) reusando useCompanyIds + expansão do grupo (padrão caixa-grupo, RD-26).
// Fonte única no banco: RPCs fn_permuta_* (guarda 'lider'/empresa, fail-closed). Tela só chama RPC.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CampoMoeda } from '@/components/comum/CampoMoeda'
import { moedaParaNumero, numeroParaMoeda } from '@/lib/moeda-mascara'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/hub/permutas'
const C = { bg: '#FAF7F2', bg2: '#F0ECE3', card: '#fff', tx: '#3D2314', txm: '#6B5D4F', txd: '#9C8E80', bd: '#E7DED3', gold: '#C8941A', verde: '#3f7d4e', verm: '#A32D2D', azul: '#2F6F9F' }
const brl = (v: number | null | undefined) => v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(v)
const brl0 = (v: number | null | undefined) => v == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const mesPt = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso + 'T00:00:00'); return ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][d.getMonth()] + '/' + d.getFullYear() }
const TIPO_MOV = [{ v: 'material', l: 'Material' }, { v: 'servico', l: 'Serviço / medição' }, { v: 'dinheiro', l: 'Dinheiro' }, { v: 'imovel', l: 'Imóvel' }]

type Permuta = { id: string; empresa: string; obra: string; ativo_descr: string; valor_atualizado: number; quitado: number; saldo: number; pct: number; status: string }
type Kpis = { permuta_a_receber: number; produzido_quitado: number; saldo: number; reajuste_acum: number; quitadas: number; em_aberto: number }
type Resp = { ok: boolean; erro?: string; kpis?: Kpis; permutas?: Permuta[] }
type Empresa = { id: string; nome: string }

const statusInfo: Record<string, { l: string; cor: string }> = {
  a_iniciar: { l: 'A iniciar', cor: C.txd }, em_andamento: { l: 'Em andamento', cor: C.azul },
  quitado: { l: 'Quitado', cor: C.verde }, pagou_a_mais: { l: 'Pagou a mais', cor: C.verm },
}

export default function PermutasPage() {
  const { companyIds, companies } = useCompanyIds()
  const effectiveIds = useMemo(() => {
    const ids = new Set(companyIds); const grupos = new Set<string>()
    companies.forEach(c => { if (companyIds.includes(c.id) && c.group_id) grupos.add(c.group_id) })
    companies.forEach(c => { if (c.group_id && grupos.has(c.group_id)) ids.add(c.id) })
    return [...ids]
  }, [companyIds, companies])
  const empresasGrupo: Empresa[] = useMemo(() => effectiveIds.map(id => {
    const c = companies.find(x => x.id === id)
    return { id, nome: c ? (c.nome_fantasia || c.razao_social || id) : id }
  }), [effectiveIds, companies])
  const idsKey = useMemo(() => [...effectiveIds].sort().join(','), [effectiveIds])

  const [filtro, setFiltro] = useState<string>('todas') // 'todas' | companyId | 'consolidado'
  const [resp, setResp] = useState<Resp | null>(null)
  const [cons, setCons] = useState<{ permuta_a_receber: number; saldo: number; intragrupo: number } | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [cadastro, setCadastro] = useState<boolean>(false)
  const [editarId, setEditarId] = useState<string | null>(null)      // RD-98 p2: editar permuta na UI
  const [excluir, setExcluir] = useState<Permuta | null>(null)        // RD-98 p2: excluir permuta na UI
  const [extratoId, setExtratoId] = useState<string | null>(null)
  const [movDe, setMovDe] = useState<string | null>(null)

  const idsAtivos = useMemo(() => filtro === 'todas' || filtro === 'consolidado'
    ? idsKey.split(',').filter(Boolean) : [filtro], [filtro, idsKey])

  const carregar = useCallback(async () => {
    const ids = idsKey.split(',').filter(Boolean)
    if (ids.length === 0) { setResp(null); return }
    setCarregando(true); setErro(null)
    const alvo = filtro === 'todas' || filtro === 'consolidado' ? ids : [filtro]
    const { data, error } = await supabase.rpc('fn_permuta_listar', { p_company_ids: alvo })
    if (error) { setErro(erroAmigavel(error)); setResp(null) }
    else { const d = data as Resp; setResp(d); if (!d?.ok) setErro(d?.erro === 'sem_acesso_empresa' ? 'Sem acesso às empresas selecionadas.' : (d?.erro ?? null)) }
    if (filtro === 'consolidado') {
      const { data: dc } = await supabase.rpc('fn_permuta_consolidado_grupo', { p_company_ids: ids })
      const c = dc as { ok: boolean; consolidado?: { permuta_a_receber: number; saldo: number }; intragrupo_eliminado?: { permutas: number } } | null
      setCons(c?.ok ? { permuta_a_receber: c.consolidado?.permuta_a_receber ?? 0, saldo: c.consolidado?.saldo ?? 0, intragrupo: c.intragrupo_eliminado?.permutas ?? 0 } : null)
    } else setCons(null)
    setCarregando(false)
  }, [idsKey, filtro])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const kpis = resp?.kpis
  const permutas = resp?.permutas ?? []

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '16px 16px 48px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.tx, margin: 0 }}>Permutas</h1>
        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, color: C.txm }}>Como funciona<AjudaCampo chave="hub.permutas.como" rota={ROTA} /></span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setCadastro(true)} style={btnGold}>+ Incluir permuta<AjudaCampo chave="hub.permutas.incluir" rota={ROTA} /></button>
      </div>

      {/* chips multi-CNPJ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, color: C.txm, marginRight: 2 }}>Empresa<AjudaCampo chave="hub.permutas.empresa" rota={ROTA} /></span>
        <button type="button" onClick={() => setFiltro('todas')} style={chip(filtro === 'todas')}>Todas</button>
        {empresasGrupo.map(e => <button key={e.id} type="button" onClick={() => setFiltro(e.id)} style={chip(filtro === e.id)}>{e.nome}</button>)}
        {empresasGrupo.length > 1 && <button type="button" onClick={() => setFiltro('consolidado')} style={chip(filtro === 'consolidado', true)}>Consolidado</button>}
      </div>

      {erro && <div style={{ background: '#fff', border: `1px dashed ${C.bd}`, borderRadius: 12, padding: 16, color: C.txm, marginBottom: 12 }}>{erro}</div>}

      {/* cartões */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Cartao rot="Permuta a receber" chave="hub.permutas.a_receber" valor={brl0(filtro === 'consolidado' ? cons?.permuta_a_receber : kpis?.permuta_a_receber)} />
        <Cartao rot="Produzido / Quitado" chave="hub.permutas.produzido" valor={brl0(kpis?.produzido_quitado)} cor={C.verde} />
        <Cartao rot="Saldo" chave="hub.permutas.saldo" valor={brl0(filtro === 'consolidado' ? cons?.saldo : kpis?.saldo)} cor={(filtro === 'consolidado' ? cons?.saldo : kpis?.saldo) != null && (filtro === 'consolidado' ? cons!.saldo : kpis!.saldo) < 0 ? C.verm : C.tx} />
        <Cartao rot="Reajuste CUB acum." chave="hub.permutas.reajuste" valor={brl0(kpis?.reajuste_acum)} cor={C.gold} />
        <Cartao rot="Quitadas × Em aberto" chave="hub.permutas.status_resumo" valor={`${kpis?.quitadas ?? 0} × ${kpis?.em_aberto ?? 0}`} />
      </div>
      {filtro === 'consolidado' && cons && cons.intragrupo > 0 && (
        <div style={{ fontSize: 11.5, color: C.txm, marginTop: -6, marginBottom: 12 }}>
          Consolidado dos {empresasGrupo.length} CNPJs · <strong>{cons.intragrupo}</strong> permuta(s) intragrupo eliminada(s)<AjudaCampo chave="hub.permutas.consolidado" rota={ROTA} />
        </div>
      )}

      {/* lista */}
      <div style={{ background: C.card, border: `0.5px solid ${C.bd}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '11px 14px', borderBottom: `0.5px solid ${C.bd}` }}>
          <strong style={{ fontSize: 13.5, color: C.tx }}>Permutas</strong><AjudaCampo chave="hub.permutas.lista" rota={ROTA} />
          <span style={{ fontSize: 11, color: C.txm }}>· clique para ver o extrato</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ background: C.bg }}>
              <th style={thL}>Ativo / Obra</th><th style={thL}>Empresa</th>
              <th style={thR}>Valor atualizado</th><th style={thR}>Quitado</th><th style={thR}>Saldo</th>
              <th style={{ ...thL, width: 160 }}>Progresso</th>
              <th style={thL}><span style={{ display: 'inline-flex', alignItems: 'center' }}>Status<AjudaCampo chave="hub.permutas.status_col" rota={ROTA} /></span></th>
              <th style={{ ...thR, width: 150 }}>Ações</th>
            </tr></thead>
            <tbody>
              {permutas.map(p => {
                const st = statusInfo[p.status] ?? statusInfo.em_andamento
                return (
                  <tr key={p.id} onClick={() => setExtratoId(p.id)} style={{ borderTop: `0.5px solid ${C.bd}`, cursor: 'pointer' }}>
                    <td style={tdL}><div style={{ fontWeight: 700, color: C.tx }}>{p.ativo_descr}</div>{p.obra && <div style={{ fontSize: 11, color: C.txm }}>{p.obra}</div>}</td>
                    <td style={{ ...tdL, color: C.txm }}>{p.empresa}</td>
                    <td style={tdR}>{brl(p.valor_atualizado)}</td>
                    <td style={{ ...tdR, color: C.verde }}>{brl(p.quitado)}</td>
                    <td style={{ ...tdR, color: p.saldo < 0 ? C.verm : C.tx, fontWeight: 700 }}>{brl(p.saldo)}</td>
                    <td style={tdL}>
                      <div style={{ height: 7, background: C.bg2, borderRadius: 999 }}><div style={{ width: `${Math.max(0, Math.min(100, p.pct))}%`, height: '100%', background: p.status === 'quitado' ? C.verde : C.gold, borderRadius: 999 }} /></div>
                      <span style={{ fontSize: 10.5, color: C.txd }}>{p.pct}%</span>
                    </td>
                    <td style={tdL}><span style={{ fontSize: 11, fontWeight: 700, color: st.cor, border: `1px solid ${st.cor}`, borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>{st.l}</span></td>
                    <td style={{ ...tdR, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <button type="button" onClick={() => setEditarId(p.id)} style={btnMini(C.tx)}>Editar</button>
                        <AjudaCampo chave="hub.permutas.editar" rota={ROTA} />
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <button type="button" onClick={() => setExcluir(p)} style={btnMini(C.verm)}>Excluir</button>
                        <AjudaCampo chave="hub.permutas.excluir" rota={ROTA} />
                      </span>
                    </td>
                  </tr>
                )
              })}
              {!carregando && permutas.length === 0 && <tr><td colSpan={8} style={{ padding: 22, textAlign: 'center', color: C.txm }}>Nenhuma permuta ainda. Use <strong>+ Incluir permuta</strong> para cadastrar a primeira.</td></tr>}
              {carregando && <tr><td colSpan={8} style={{ padding: 18, textAlign: 'center', color: C.txm }}>Carregando…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {cadastro && <CadastroModal empresas={empresasGrupo} onClose={() => setCadastro(false)} onSalvo={() => { setCadastro(false); void carregar() }} />}
      {editarId && <CadastroModal permutaId={editarId} empresas={empresasGrupo} onClose={() => setEditarId(null)} onSalvo={() => { setEditarId(null); void carregar() }} />}
      {excluir && <ExcluirModal permuta={excluir} onClose={() => setExcluir(null)} onExcluido={() => { setExcluir(null); void carregar() }} />}
      {extratoId && <ExtratoModal id={extratoId} onClose={() => setExtratoId(null)} onMovimento={() => { setMovDe(extratoId); }} onMudou={() => void carregar()} />}
      {movDe && <MovimentoModal permutaId={movDe} empresas={empresasGrupo} onClose={() => setMovDe(null)} onSalvo={() => { setMovDe(null); void carregar() }} />}
    </div>
  )
}

function Cartao({ rot, chave, valor, cor }: { rot: string; chave: string; valor: string; cor?: string }) {
  return <div style={{ background: C.card, border: `0.5px solid ${C.bd}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 11, color: C.txm, display: 'inline-flex', alignItems: 'center', textTransform: 'uppercase', letterSpacing: 0.3 }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></div>
    <div style={{ fontSize: 19, fontWeight: 800, color: cor ?? C.tx, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
  </div>
}

function CadastroModal({ empresas, permutaId, onClose, onSalvo }: { empresas: Empresa[]; permutaId?: string | null; onClose: () => void; onSalvo: () => void }) {
  const edit = !!permutaId
  const [f, setF] = useState({ company_id: empresas[0]?.id ?? '', obra_id: '', contratante: '', ativo_descr: '', tipo_contrato: 'misto', pct_permuta: '', valor_permuta: '', valor_dinheiro: '', indice_reajuste: 'CUB-SC', data_base: '', contrato_anexo: '', intragrupo: false })
  const [statusAtual, setStatusAtual] = useState<string | null>(null)
  const [carregandoEdit, setCarregandoEdit] = useState<boolean>(edit)
  const [obras, setObras] = useState<{ id: string; nome: string }[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Edição: pré-preenche o formulário com os dados crus da permuta (fn_permuta_obter, RPC guardada).
  useEffect(() => {
    if (!permutaId) return
    let vivo = true
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    supabase.rpc('fn_permuta_obter', { p_id: permutaId }).then(({ data, error }) => {
      if (!vivo) return
      const d = data as { ok: boolean; erro?: string; permuta?: Record<string, unknown> } | null
      if (error || !d?.ok || !d.permuta) { setErro(error ? erroAmigavel(error) : (d?.erro ?? 'Não consegui carregar a permuta.')); setCarregandoEdit(false); return }
      const p = d.permuta
      const s = (k: string) => p[k] == null ? '' : String(p[k])
      const m = (k: string) => p[k] == null ? '' : numeroParaMoeda(Number(p[k]))
      setF({ company_id: s('company_id'), obra_id: s('obra_id'), contratante: s('contratante'), ativo_descr: s('ativo_descr'), tipo_contrato: s('tipo_contrato') || 'misto', pct_permuta: s('pct_permuta'), valor_permuta: m('valor_permuta'), valor_dinheiro: m('valor_dinheiro'), indice_reajuste: s('indice_reajuste') || 'CUB-SC', data_base: s('data_base'), contrato_anexo: s('contrato_anexo'), intragrupo: p.intragrupo === true })
      setStatusAtual((p.status as string) ?? null)
      setCarregandoEdit(false)
    })
    return () => { vivo = false }
  }, [permutaId])
  useEffect(() => { if (!f.company_id) { setObras([]); return }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    supabase.from('projetos_obras').select('id,nome').eq('company_id', f.company_id).is('deleted_at', null).order('nome').then(({ data }) => setObras((data as { id: string; nome: string }[]) ?? []))
  }, [f.company_id])
  const set = (k: string, v: string | boolean) => setF(p => ({ ...p, [k]: v }))
  const salvar = async () => {
    if (!f.ativo_descr.trim()) { setErro('Informe o ativo (imóvel).'); return }
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_permuta_salvar', {
      p_id: permutaId ?? null, p_company_id: f.company_id, p_obra_id: f.obra_id || null, p_contratante: f.contratante || null,
      p_ativo_descr: f.ativo_descr, p_tipo_contrato: f.tipo_contrato, p_pct_permuta: f.pct_permuta ? Number(f.pct_permuta) : null,
      p_valor_permuta: moedaParaNumero(f.valor_permuta) ?? 0, p_valor_dinheiro: moedaParaNumero(f.valor_dinheiro) ?? 0,
      p_indice_reajuste: f.indice_reajuste || null, p_data_base: f.data_base || null, p_contrato_anexo: f.contrato_anexo || null,
      p_status: statusAtual, p_intragrupo: f.intragrupo,
    })
    setSalvando(false)
    const d = data as { ok: boolean; erro?: string } | null
    if (error) setErro(erroAmigavel(error)); else if (!d?.ok) setErro(d?.erro ?? 'Erro'); else onSalvo()
  }
  return <Modal titulo={edit ? 'Editar permuta' : 'Incluir permuta'} onClose={onClose}>
    {carregandoEdit && <div style={{ color: C.txm, fontSize: 13, padding: '4px 0 10px' }}>Carregando dados da permuta…</div>}
    <Grid>
      <Campo data-ajuda="hub.permutas.empresa" chave="hub.permutas.empresa" rot="Empresa"><select style={inp} value={f.company_id} onChange={e => set('company_id', e.target.value)}>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></Campo>
      <Campo data-ajuda="hub.permutas.obra" chave="hub.permutas.obra" rot="Obra (opcional)"><select style={inp} value={f.obra_id} onChange={e => set('obra_id', e.target.value)}><option value="">—</option>{obras.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></Campo>
      <Campo data-ajuda="hub.permutas.ativo_descr" chave="hub.permutas.ativo_descr" rot="Ativo (imóvel) *"><input style={inp} value={f.ativo_descr} onChange={e => set('ativo_descr', e.target.value)} placeholder="Apto 1202 Amazon" /></Campo>
      <Campo data-ajuda="hub.permutas.contratante" chave="hub.permutas.contratante" rot="Contratante"><input style={inp} value={f.contratante} onChange={e => set('contratante', e.target.value)} placeholder="Incorporadora…" /></Campo>
      <Campo data-ajuda="hub.permutas.tipo_contrato" chave="hub.permutas.tipo_contrato" rot="Tipo de contrato"><select style={inp} value={f.tipo_contrato} onChange={e => set('tipo_contrato', e.target.value)}><option value="100_permuta">100% permuta</option><option value="misto">Misto</option><option value="100_dinheiro">100% dinheiro</option></select></Campo>
      <Campo data-ajuda="hub.permutas.pct_permuta" chave="hub.permutas.pct_permuta" rot="% de permuta"><input style={inp} type="number" value={f.pct_permuta} onChange={e => set('pct_permuta', e.target.value)} placeholder="40" /></Campo>
      <Campo data-ajuda="hub.permutas.valor_permuta" chave="hub.permutas.valor_permuta" rot="Valor da permuta (R$)"><CampoMoeda style={inp} value={f.valor_permuta} onChange={v => set('valor_permuta', v)} placeholder="0,00" /></Campo>
      <Campo data-ajuda="hub.permutas.valor_dinheiro" chave="hub.permutas.valor_dinheiro" rot="Valor em dinheiro (R$)"><CampoMoeda style={inp} value={f.valor_dinheiro} onChange={v => set('valor_dinheiro', v)} placeholder="0,00" /></Campo>
      <Campo data-ajuda="hub.permutas.indice_reajuste" chave="hub.permutas.indice_reajuste" rot="Índice de reajuste"><input style={inp} value={f.indice_reajuste} onChange={e => set('indice_reajuste', e.target.value)} placeholder="CUB-SC" /></Campo>
      <Campo data-ajuda="hub.permutas.data_base" chave="hub.permutas.data_base" rot="Data base"><input style={inp} type="date" value={f.data_base} onChange={e => set('data_base', e.target.value)} /></Campo>
      <Campo data-ajuda="hub.permutas.anexo" chave="hub.permutas.anexo" rot="Contrato (link)"><input style={inp} value={f.contrato_anexo} onChange={e => set('contrato_anexo', e.target.value)} placeholder="link do PDF (upload na próxima fatia)" /></Campo>
      <Campo data-ajuda="hub.permutas.intragrupo" chave="hub.permutas.intragrupo" rot="Permuta intragrupo"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.tx }}><input type="checkbox" checked={f.intragrupo} onChange={e => set('intragrupo', e.target.checked)} /> Entre empresas do grupo</span></Campo>
    </Grid>
    {erro && <div style={{ color: C.verm, fontSize: 12, marginTop: 8 }}>{erro}</div>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
      <button type="button" onClick={onClose} style={btnGhost}>Cancelar</button>
      <button type="button" onClick={() => void salvar()} disabled={salvando || carregandoEdit} style={btnGold}>{salvando ? 'Salvando…' : edit ? 'Salvar alterações' : 'Salvar permuta'}</button>
    </div>
  </Modal>
}

// RD-98 p2: excluir permuta (soft-delete rastreável via fn_permuta_excluir) com motivo.
function ExcluirModal({ permuta, onClose, onExcluido }: { permuta: Permuta; onClose: () => void; onExcluido: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const excluir = async () => {
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_permuta_excluir', { p_id: permuta.id, p_motivo: motivo.trim() || null })
    setSalvando(false)
    const d = data as { ok: boolean; erro?: string } | null
    if (error || !d?.ok) { setErro(error ? erroAmigavel(error) : (d?.erro === 'permuta_nao_encontrada' ? 'Permuta não encontrada.' : (d?.erro ?? 'Não consegui excluir.'))); return }
    onExcluido()
  }
  return <Modal titulo="Excluir permuta" onClose={onClose}>
    <div style={{ fontSize: 13.5, color: C.tx, marginBottom: 10 }}>
      Excluir <strong>{permuta.ativo_descr}</strong>? Ela sai da lista; o histórico fica registrado (exclusão rastreável, não apaga de verdade).
    </div>
    <Campo data-ajuda="hub.permutas.excluir" chave="hub.permutas.excluir" rot="Motivo (opcional)">
      <input style={inp} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: cadastrada em duplicidade" />
    </Campo>
    {erro && <div style={{ color: C.verm, fontSize: 12, marginTop: 8 }}>{erro}</div>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
      <button type="button" onClick={onClose} style={btnGhost}>Cancelar</button>
      <button type="button" onClick={() => void excluir()} disabled={salvando} style={{ ...btnGold, background: C.verm }}>{salvando ? 'Excluindo…' : 'Sim, excluir'}</button>
    </div>
  </Modal>
}

function MovimentoModal({ permutaId, empresas, onClose, onSalvo }: { permutaId: string; empresas: Empresa[]; onClose: () => void; onSalvo: () => void }) {
  const [aba, setAba] = useState<'mov' | 'cub'>('mov')
  const [m, setM] = useState({ tipo: 'material', competencia: '', valor: '', data: '', num_nota: '', cnpj_emissor: '', empresa_emissora_id: '', obs: '' })
  const [r, setR] = useState({ competencia: '', indice_valor: '', valor_reajuste: '' })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const compDate = (yyyymm: string) => yyyymm ? `${yyyymm}-01` : null
  const salvarMov = async () => {
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_permuta_movimento_add', {
      p_permuta_id: permutaId, p_tipo: m.tipo, p_competencia: compDate(m.competencia), p_valor: moedaParaNumero(m.valor) ?? 0,
      p_data: m.data || null, p_num_nota: m.num_nota || null, p_cnpj_emissor: m.cnpj_emissor || null,
      p_empresa_emissora_id: m.empresa_emissora_id || null, p_ref_tipo: null, p_ref_id: null, p_obs: m.obs || null,
    })
    setSalvando(false); const d = data as { ok: boolean; erro?: string } | null
    if (error) setErro(erroAmigavel(error)); else if (!d?.ok) setErro(d?.erro ?? 'Erro'); else onSalvo()
  }
  const salvarCub = async () => {
    setSalvando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_permuta_reajuste_add', {
      p_permuta_id: permutaId, p_competencia: compDate(r.competencia), p_indice_valor: r.indice_valor ? Number(r.indice_valor) : null, p_valor_reajuste: moedaParaNumero(r.valor_reajuste) ?? 0,
    })
    setSalvando(false); const d = data as { ok: boolean; erro?: string } | null
    if (error) setErro(erroAmigavel(error)); else if (!d?.ok) setErro(d?.erro ?? 'Erro'); else onSalvo()
  }
  return <Modal titulo="Lançar na permuta" onClose={onClose}>
    <div style={{ display: 'inline-flex', gap: 3, background: C.bg2, borderRadius: 999, padding: 3, marginBottom: 12 }}>
      <button type="button" onClick={() => setAba('mov')} style={pill(aba === 'mov')}>Movimento</button>
      <button type="button" onClick={() => setAba('cub')} style={pill(aba === 'cub')}>Reajuste CUB</button>
    </div>
    {aba === 'mov' ? <>
      <Grid>
        <Campo data-ajuda="hub.permutas.mov_tipo" chave="hub.permutas.mov_tipo" rot="Tipo"><select style={inp} value={m.tipo} onChange={e => setM(p => ({ ...p, tipo: e.target.value }))}>{TIPO_MOV.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select></Campo>
        <Campo data-ajuda="hub.permutas.mov_competencia" chave="hub.permutas.mov_competencia" rot="Competência (mês)"><input style={inp} type="month" value={m.competencia} onChange={e => setM(p => ({ ...p, competencia: e.target.value }))} /></Campo>
        <Campo data-ajuda="hub.permutas.mov_valor" chave="hub.permutas.mov_valor" rot="Valor (R$)"><CampoMoeda style={inp} value={m.valor} onChange={v => setM(p => ({ ...p, valor: v }))} placeholder="0,00" /></Campo>
        <Campo data-ajuda="hub.permutas.mov_data" chave="hub.permutas.mov_data" rot="Data"><input style={inp} type="date" value={m.data} onChange={e => setM(p => ({ ...p, data: e.target.value }))} /></Campo>
        <Campo data-ajuda="hub.permutas.mov_num_nota" chave="hub.permutas.mov_num_nota" rot="Nº da nota"><input style={inp} value={m.num_nota} onChange={e => setM(p => ({ ...p, num_nota: e.target.value }))} placeholder="NF 123" /></Campo>
        <Campo data-ajuda="hub.permutas.mov_cnpj" chave="hub.permutas.mov_cnpj" rot="CNPJ emissor"><input style={inp} value={m.cnpj_emissor} onChange={e => setM(p => ({ ...p, cnpj_emissor: e.target.value }))} placeholder="00.000.000/0001-00" /></Campo>
        <Campo data-ajuda="hub.permutas.mov_empresa_emissora" chave="hub.permutas.mov_empresa_emissora" rot="Empresa emissora"><select style={inp} value={m.empresa_emissora_id} onChange={e => setM(p => ({ ...p, empresa_emissora_id: e.target.value }))}><option value="">—</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></Campo>
        <Campo data-ajuda="hub.permutas.mov_obs" chave="hub.permutas.mov_obs" rot="Observação"><textarea style={{ ...inp, minHeight: 36 }} value={m.obs} onChange={e => setM(p => ({ ...p, obs: e.target.value }))} /></Campo>
      </Grid>
      {erro && <div style={{ color: C.verm, fontSize: 12, marginTop: 8 }}>{erro}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><button type="button" onClick={onClose} style={btnGhost}>Cancelar</button><button type="button" onClick={() => void salvarMov()} disabled={salvando} style={btnGold}>{salvando ? 'Salvando…' : 'Lançar movimento'}</button></div>
    </> : <>
      <Grid>
        <Campo data-ajuda="hub.permutas.reaj_competencia" chave="hub.permutas.reaj_competencia" rot="Competência do CUB"><input style={inp} type="month" value={r.competencia} onChange={e => setR(p => ({ ...p, competencia: e.target.value }))} /></Campo>
        <Campo data-ajuda="hub.permutas.reaj_indice" chave="hub.permutas.reaj_indice" rot="Valor do índice"><input style={inp} type="number" value={r.indice_valor} onChange={e => setR(p => ({ ...p, indice_valor: e.target.value }))} placeholder="2950" /></Campo>
        <Campo data-ajuda="hub.permutas.reaj_valor" chave="hub.permutas.reaj_valor" rot="Reajuste do mês (R$)"><CampoMoeda style={inp} value={r.valor_reajuste} onChange={v => setR(p => ({ ...p, valor_reajuste: v }))} placeholder="0,00" /></Campo>
      </Grid>
      {erro && <div style={{ color: C.verm, fontSize: 12, marginTop: 8 }}>{erro}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><button type="button" onClick={onClose} style={btnGhost}>Cancelar</button><button type="button" onClick={() => void salvarCub()} disabled={salvando} style={btnGold}>{salvando ? 'Salvando…' : 'Lançar CUB'}</button></div>
    </>}
  </Modal>
}

type ExtCab = { ativo_descr: string; valor_permuta: number; reajuste_acum: number; valor_atualizado: number; quitado: number; saldo: number; status: string }
type ExtMov = { id: string; tipo: string; num_nota: string | null; valor: number }
type ExtMes = { competencia: string; total: number; movimentos: ExtMov[] }
function ExtratoModal({ id, onClose, onMovimento, onMudou }: { id: string; onClose: () => void; onMovimento: () => void; onMudou: () => void }) {
  const [cab, setCab] = useState<ExtCab | null>(null)
  const [meses, setMeses] = useState<ExtMes[]>([])
  const [carregando, setCarregando] = useState(true)
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data } = await supabase.rpc('fn_permuta_extrato', { p_permuta_id: id })
    const d = data as { ok: boolean; cabecalho?: ExtCab; meses?: ExtMes[] } | null
    setCab(d?.cabecalho ?? null); setMeses(d?.meses ?? []); setCarregando(false)
  }, [id])
  useEffect(() => { void carregar() }, [carregar])
  // RD-98 p2: excluir movimento lançado errado (soft-delete via fn_permuta_movimento_excluir); recalcula o saldo.
  const excluirMov = async (movId: string) => {
    setExcluindo(movId); setErro(null)
    const { data, error } = await supabase.rpc('fn_permuta_movimento_excluir', { p_id: movId, p_motivo: null })
    setExcluindo(null)
    const d = data as { ok: boolean; erro?: string } | null
    if (error || !d?.ok) { setErro(error ? erroAmigavel(error) : (d?.erro ?? 'Não consegui excluir o movimento.')); return }
    await carregar(); onMudou()
  }
  const tipoL = (t: string) => TIPO_MOV.find(x => x.v === t)?.l ?? t
  return <Modal titulo={cab?.ativo_descr ?? 'Extrato'} onClose={onClose} larga>
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.txm, marginBottom: 8 }}>Extrato<AjudaCampo chave="hub.permutas.extrato" rota={ROTA} /></div>
    {carregando ? <div style={{ color: C.txm, padding: 12 }}>Carregando…</div> : cab && <>
      <div style={{ background: C.bg, border: `0.5px solid ${C.bd}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12, fontSize: 13.5 }}>
        <span>Valor do contrato <strong>{brl(cab.valor_permuta)}</strong></span>
        <span style={{ color: C.gold }}> + Reajuste CUB <strong>{brl(cab.reajuste_acum)}</strong></span>
        <span> = Valor atualizado <strong style={{ color: C.tx }}>{brl(cab.valor_atualizado)}</strong></span>
      </div>
      {meses.length === 0 && <div style={{ color: C.txm, fontSize: 13, padding: '4px 0 10px' }}>Nenhum movimento ainda.</div>}
      {meses.map(mes => (
        <div key={mes.competencia} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.tx, textTransform: 'capitalize', borderBottom: `0.5px solid ${C.bd}`, paddingBottom: 3, marginBottom: 4 }}>{mesPt(mes.competencia)} · total {brl(mes.total)}</div>
          {mes.movimentos.map((mv, i) => (
            <div key={mv.id ?? i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '2px 0', color: C.txm }}>
              <span>{tipoL(mv.tipo)}{mv.num_nota ? ` · ${mv.num_nota}` : ''}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: C.verde, fontVariantNumeric: 'tabular-nums' }}>− {brl(mv.valor)}</span>
                <button type="button" title="Excluir movimento" onClick={() => void excluirMov(mv.id)} disabled={excluindo === mv.id} style={{ border: 'none', background: 'transparent', color: C.verm, cursor: excluindo === mv.id ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700, padding: '0 2px' }}>{excluindo === mv.id ? '…' : '×'}</button>
                <AjudaCampo chave="hub.permutas.mov_excluir" rota={ROTA} />
              </span>
            </div>
          ))}
        </div>
      ))}
      {erro && <div style={{ color: C.verm, fontSize: 12, margin: '4px 0 8px' }}>{erro}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${C.bd}`, paddingTop: 10, marginTop: 6 }}>
        <span style={{ fontSize: 13 }}>Quitado <strong style={{ color: C.verde }}>{brl(cab.quitado)}</strong> · Saldo <strong style={{ color: cab.saldo < 0 ? C.verm : C.tx }}>{brl(cab.saldo)}</strong>{cab.saldo < 0 && <span style={{ color: C.verm }}> (pagou a mais)</span>}</span>
        <button type="button" onClick={() => { onMovimento(); }} style={btnGold}>+ Lançar na permuta</button>
      </div>
    </>}
  </Modal>
}

function Modal({ titulo, onClose, children, larga }: { titulo: string; onClose: () => void; children: React.ReactNode; larga?: boolean }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', zIndex: 60, overflowY: 'auto' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: C.card, borderRadius: 16, width: larga ? 640 : 560, maxWidth: '100%', padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}><strong style={{ fontSize: 16, color: C.tx }}>{titulo}</strong><span style={{ flex: 1 }} /><button type="button" onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 20, color: C.txm, cursor: 'pointer' }}>×</button></div>
      {children}
    </div>
  </div>
}
function Grid({ children }: { children: React.ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>{children}</div> }
function Campo({ chave, rot, children }: { chave: string; rot: string; children: React.ReactNode; 'data-ajuda'?: string }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 11.5, color: C.txm, display: 'inline-flex', alignItems: 'center' }}>{rot}<AjudaCampo chave={chave} rota={ROTA} /></span>{children}</label>
}

const chip = (on: boolean, cons?: boolean): React.CSSProperties => ({ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', border: `0.5px solid ${on ? (cons ? C.gold : C.tx) : C.bd}`, background: on ? (cons ? C.gold : C.tx) : '#fff', color: on ? '#fff' : C.txm })
const pill = (on: boolean): React.CSSProperties => ({ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', border: 'none', background: on ? C.gold : 'transparent', color: on ? '#fff' : C.txm })
const btnGold: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 10, border: 'none', background: C.gold, color: '#fff', cursor: 'pointer' }
const btnGhost: React.CSSProperties = { fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: 10, border: `0.5px solid ${C.bd}`, background: '#fff', color: C.txm, cursor: 'pointer' }
const btnMini = (cor: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8, border: `0.5px solid ${cor}`, background: '#fff', color: cor, cursor: 'pointer' })
const inp: React.CSSProperties = { fontSize: 13, padding: '7px 10px', borderRadius: 8, border: `0.5px solid ${C.bd}`, background: '#fff', color: C.tx, width: '100%', boxSizing: 'border-box' }
const thL: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: C.txm, whiteSpace: 'nowrap' }
const thR: React.CSSProperties = { ...thL, textAlign: 'right' }
const tdL: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', verticalAlign: 'top' }
const tdR: React.CSSProperties = { ...tdL, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
