'use client'
// Indústria › RH › Gestão de Mão de Obra — PR1 do scaffold (CEO 10/11): CADASTRO de SETOR, agnóstico de ramo.
// Setor agrupa postos e pessoas; é a base do custo e das horas por setor no quadro de pessoal e nos painéis.
// Reaproveita os RPCs existentes fn_prod_setor_salvar / fn_prod_setor_excluir (RLS por company_id, soft-delete RD-98);
// nada de financeiro nem salário aqui. Próximas fatias: Cargos, Postos, Salário base. Casa com o padrão das telas
// industriais (quadro de pessoal / produtividade): paleta plana, useCompanyIds, RPC {ok,erro}, RD-95, celular 390px.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'
import CargosPanel from '@/components/industrial/CargosPanel'
import PostosPanel from '@/components/industrial/PostosPanel'
import SalariosPanel from '@/components/industrial/SalariosPanel'
import PessoasPanel from '@/components/industrial/PessoasPanel'

type Aba = 'setores' | 'cargos' | 'postos' | 'salarios' | 'pessoas'

const ROTA = '/dashboard/industrial/rh/mao-de-obra'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', GREENBG = '#ECFDF5', RED = '#B42318', REDBG = '#FCEBEB'

type Setor = { id: string; nome: string; ordem: number | null; ativo: boolean; postos: number }

const inp: React.CSSProperties = { padding: '9px 11px', fontSize: 14, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP, width: '100%', boxSizing: 'border-box' }
const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOut: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const btnDel: React.CSSProperties = { ...btnOut, color: RED, borderColor: 'rgba(180,35,24,0.35)' }

const erroSetor: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome do setor.',
  nome_duplicado: 'Já existe um setor com esse nome nesta empresa.',
  sem_acesso: 'Sem acesso a esta empresa.',
  contexto_incompleto: 'Escolha uma empresa antes de salvar.',
  setor_nao_encontrado: 'Esse setor não existe mais. Atualize a lista.',
}

export default function MaoDeObraSetoresPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && sel ? sel : null

  const [aba, setAba] = useState<Aba>('setores')
  const [setores, setSetores] = useState<Setor[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [novoAberto, setNovoAberto] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')
  const [busy, setBusy] = useState(false)
  const userId = useRef<string | null>(null)
  const seq = useRef(0)

  const flash = (m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }
  const flashErr = (m: string) => { setErro(m); window.setTimeout(() => setErro(null), 6000) }

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    const minha = ++seq.current
    setLoading(true); setErro(null)
    if (!userId.current) { const { data } = await supabase.auth.getUser(); userId.current = data.user?.id ?? null }
    const [st, po] = await Promise.all([
      supabase.from('prod_setor').select('id, nome, ordem, ativo').eq('company_id', empresa).order('ordem', { ascending: true }).order('nome', { ascending: true }),
      supabase.from('prod_posto').select('setor_id').eq('company_id', empresa).eq('ativo', true),
    ])
    if (minha !== seq.current) return
    if (st.error) { setErro(erroAmigavel(st.error, 'Não foi possível carregar os setores. Tente de novo.')); setLoading(false); return }
    const conta = new Map<string, number>()
    for (const p of ((po.data ?? []) as { setor_id: string | null }[])) if (p.setor_id) conta.set(p.setor_id, (conta.get(p.setor_id) ?? 0) + 1)
    setSetores(((st.data ?? []) as Omit<Setor, 'postos'>[]).map((s) => ({ ...s, postos: conta.get(s.id) ?? 0 })))
    setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  const salvar = useCallback(async (nome: string, id?: string) => {
    if (!empresa) return
    const limpo = nome.trim()
    if (!limpo) { flashErr('Informe o nome do setor.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_setor_salvar', {
      p_dados: { id: id ?? null, company_id: empresa, nome: limpo }, p_user: userId.current,
    })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível salvar o setor. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroSetor[r?.erro ?? ''] ?? 'Não foi possível salvar o setor.'); return }
    flash(id ? `Setor "${limpo}" atualizado.` : `Setor "${limpo}" criado.`)
    if (id) { setEditId(null); setEditNome('') } else { setNovoNome(''); setNovoAberto(false) }
    void carregar()
  }, [empresa, carregar])

  const excluir = useCallback(async (s: Setor) => {
    if (!window.confirm(`Arquivar o setor "${s.nome}"?\n\nEle sai da lista, mas o histórico não é apagado. Você pode reativá-lo depois em "Mostrar inativos".`)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_setor_excluir', { p_id: s.id, p_user: userId.current })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível excluir o setor. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string; postos?: number }
    if (!r?.ok) {
      if (r?.erro === 'setor_em_uso') { flashErr(`Esse setor tem ${r.postos ?? 'alguns'} posto(s) ativo(s). Mova ou arquive os postos antes de excluir o setor.`); return }
      flashErr(erroSetor[r?.erro ?? ''] ?? 'Não foi possível excluir o setor.'); return
    }
    flash(`Setor "${s.nome}" arquivado (registro guardado).`)
    void carregar()
  }, [carregar])

  const reativar = useCallback(async (s: Setor) => {
    if (!empresa) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_setor_salvar', {
      p_dados: { id: s.id, company_id: empresa, nome: s.nome, ativo: true }, p_user: userId.current,
    })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível reativar o setor. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroSetor[r?.erro ?? ''] ?? 'Não foi possível reativar o setor.'); return }
    flash(`Setor "${s.nome}" reativado.`); void carregar()
  }, [empresa, carregar])

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return setores.filter((s) => (mostrarInativos || s.ativo) && (!t || s.nome.toLowerCase().includes(t)))
  }, [setores, busca, mostrarInativos])
  const totalAtivos = setores.filter((s) => s.ativo).length

  return (
    <div style={{ background: BG, minHeight: '100%', color: ESP, padding: 'clamp(12px, 2.5vw, 24px)' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'grid', gap: 16 }}>
        <header style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 12, color: MUT }}>Indústria · RH</div>
          <h1 style={{ margin: 0, fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 700 }}>Gestão de mão de obra</h1>
          <p style={{ margin: 0, fontSize: 14, color: MUT, maxWidth: '70ch' }}>
            Cadastre os setores, os cargos e os postos que organizam a produção. São a base do custo e das horas por área, por função e por atividade no quadro de pessoal e nos painéis.
          </p>
        </header>

        {!empresa && <div style={card}>Escolha uma empresa no topo para gerenciar a mão de obra.</div>}

        {empresa && (
          <div role="tablist" aria-label="Seções da mão de obra" style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
            {([['setores', 'Setores'], ['cargos', 'Cargos'], ['postos', 'Postos'], ['salarios', 'Salário'], ['pessoas', 'Pessoas']] as [Aba, string][]).map(([k, lbl]) => (
              <button key={k} role="tab" aria-selected={aba === k} data-testid={`aba-${k}`} onClick={() => setAba(k)}
                style={{ padding: '9px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: aba === k ? 700 : 500, color: aba === k ? ESP : MUT, borderBottom: aba === k ? `2px solid ${GOLD}` : '2px solid transparent', marginBottom: -1 }}>
                {lbl}
              </button>
            ))}
          </div>
        )}

        {empresa && aba === 'cargos' && <CargosPanel empresa={empresa} />}

        {empresa && aba === 'postos' && <PostosPanel empresa={empresa} />}

        {empresa && aba === 'salarios' && <SalariosPanel empresa={empresa} />}

        {empresa && aba === 'pessoas' && <PessoasPanel empresa={empresa} />}

        {empresa && aba === 'setores' && (
          <>
            {msg && <div role="status" style={{ background: GREENBG, color: GREEN, border: `1px solid ${GREEN}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{msg}</div>}
            {erro && <div role="alert" style={{ background: REDBG, color: RED, border: `1px solid ${RED}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{erro}</div>}
            {/* Barra: busca + mostrar inativos + novo setor */}
            <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <label style={{ flex: '1 1 220px', display: 'inline-flex', flexDirection: 'column', gap: 4, fontSize: 12, color: MUT }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Buscar setor<AjudaCampo chave="maoobra.setor.busca" rota={ROTA} /></span>
                <input data-testid="setor-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome do setor" style={inp} />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: ESP, alignSelf: 'end', padding: '6px 0' }}>
                <input data-testid="setor-mostrar-inativos" type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
                Mostrar inativos<AjudaCampo chave="maoobra.setor.mostrar_inativos" rota={ROTA} />
              </label>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'end' }}>
                <button data-testid="setor-novo" onClick={() => { setNovoAberto(true); setNovoNome('') }} style={btnGold} disabled={busy}>+ Novo setor</button>
                <AjudaCampo chave="maoobra.setor.novo" rota={ROTA} />
              </span>
            </div>

            {/* Form de novo setor */}
            {novoAberto && (
              <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="setor-novo-form">
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Nome do setor<AjudaCampo chave="maoobra.setor.nome" rota={ROTA} /></span>
                  <input data-testid="setor-novo-nome" autoFocus value={novoNome} onChange={(e) => setNovoNome(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void salvar(novoNome) }} placeholder="ex.: Desossa" style={inp} />
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button data-testid="setor-novo-salvar" onClick={() => void salvar(novoNome)} style={btnGold} disabled={busy || !novoNome.trim()}>Salvar setor</button>
                  <button onClick={() => { setNovoAberto(false); setNovoNome('') }} style={btnOut} disabled={busy}>Cancelar</button>
                </div>
              </div>
            )}

            {loading ? (
              <div style={{ ...card, color: MUT }}>Carregando os setores…</div>
            ) : setores.length === 0 ? (
              <div style={{ ...card, textAlign: 'center', display: 'grid', gap: 10, padding: '28px 16px' }} data-testid="setor-vazio">
                <div style={{ fontSize: 15, fontWeight: 600 }}>Nenhum setor cadastrado ainda</div>
                <div style={{ fontSize: 13, color: MUT, maxWidth: '52ch', margin: '0 auto' }}>Comece criando os setores da sua produção (ex.: Abate, Desossa, Expedição). Depois você liga os postos e as pessoas a cada setor.</div>
                <div><button data-testid="setor-vazio-novo" onClick={() => { setNovoAberto(true); setNovoNome('') }} style={btnGold}>+ Criar o primeiro setor</button></div>
              </div>
            ) : filtrados.length === 0 ? (
              <div style={{ ...card, color: MUT }}>Nenhum setor encontrado com esse filtro.</div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12, color: MUT, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span>{totalAtivos} setor(es) ativo(s){mostrarInativos && setores.length > totalAtivos ? ` · ${setores.length - totalAtivos} inativo(s)` : ''}</span>
                </div>
                {filtrados.map((s) => (
                  <div key={s.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: s.ativo ? 1 : 0.7 }} data-testid="setor-linha">
                    {editId === s.id ? (
                      <div style={{ flex: '1 1 240px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ flex: '1 1 180px', display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Nome do setor<AjudaCampo chave="maoobra.setor.nome" rota={ROTA} /></span>
                          <input data-testid="setor-edit-nome" autoFocus value={editNome} onChange={(e) => setEditNome(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void salvar(editNome, s.id) }} style={inp} />
                        </label>
                        <div style={{ display: 'flex', gap: 8, alignSelf: 'end' }}>
                          <button data-testid="setor-edit-salvar" onClick={() => void salvar(editNome, s.id)} style={btnGold} disabled={busy || !editNome.trim()}>Salvar</button>
                          <button onClick={() => { setEditId(null); setEditNome('') }} style={btnOut} disabled={busy}>Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nome}</div>
                          <div style={{ fontSize: 12, color: MUT, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {s.postos} posto(s)<AjudaCampo chave="maoobra.setor.postos" rota={ROTA} />
                          </div>
                        </div>
                        {!s.ativo && <span style={{ fontSize: 11, fontWeight: 700, color: MUT, background: '#00000008', border: `1px solid ${LINE}`, borderRadius: 999, padding: '2px 9px' }}>Inativo</span>}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                          {s.ativo ? (
                            <>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <button data-testid="setor-editar" onClick={() => { setEditId(s.id); setEditNome(s.nome) }} style={btnOut} disabled={busy}>Editar</button>
                                <AjudaCampo chave="maoobra.setor.editar" rota={ROTA} />
                              </span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                <button data-testid="setor-excluir" onClick={() => void excluir(s)} style={btnDel} disabled={busy}>Excluir</button>
                                <AjudaCampo chave="maoobra.setor.excluir" rota={ROTA} />
                              </span>
                            </>
                          ) : (
                            <button data-testid="setor-reativar" onClick={() => void reativar(s)} style={btnOut} disabled={busy}>Reativar</button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
