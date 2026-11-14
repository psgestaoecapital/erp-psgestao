'use client'
// Indústria › RH › Gestão de Mão de Obra — PR2: CADASTRO de CARGO (aba), agnóstico de ramo.
// O cargo classifica pessoas e postos; é a base do salário por cargo e da comparação de custo/produtividade por função.
// Reaproveita os RPCs existentes fn_prod_cargo_salvar / fn_prod_cargo_excluir (RLS por company_id, soft-delete RD-98).
// prod_cargo exige plant_id (industrial_plants): resolvemos a planta ativa da empresa no cliente e enviamos no salvar.
// Mesmo padrão visual/UX da aba Setores (paleta plana, RPC {ok,erro}, RD-95, celular 390px). Code: desenvolvedor_4_g.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/industrial/rh/mao-de-obra'
const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', GREENBG = '#ECFDF5', RED = '#B42318', REDBG = '#FCEBEB'

type Cargo = { id: string; nome: string; ativo: boolean; postos: number }

const inp: React.CSSProperties = { padding: '9px 11px', fontSize: 14, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP, width: '100%', boxSizing: 'border-box' }
const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOut: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const btnDel: React.CSSProperties = { ...btnOut, color: RED, borderColor: 'rgba(180,35,24,0.35)' }

const erroCargo: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome do cargo.',
  nome_duplicado: 'Já existe um cargo com esse nome nesta empresa.',
  sem_acesso: 'Sem acesso a esta empresa.',
  contexto_incompleto: 'Escolha uma empresa antes de salvar.',
  cargo_nao_encontrado: 'Esse cargo não existe mais. Atualize a lista.',
}

export default function CargosPanel({ empresa }: { empresa: string | null }) {
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [semPlanta, setSemPlanta] = useState(false)
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
    const [cg, po, pl] = await Promise.all([
      supabase.from('prod_cargo').select('id, nome, ativo').eq('company_id', empresa).order('nome', { ascending: true }),
      supabase.from('prod_posto').select('cargo_id').eq('company_id', empresa).eq('ativo', true),
      supabase.from('industrial_plants').select('id, is_active').eq('company_id', empresa).order('created_at', { ascending: true }),
    ])
    if (minha !== seq.current) return
    if (cg.error) { setErro(erroAmigavel(cg.error, 'Não foi possível carregar os cargos. Tente de novo.')); setLoading(false); return }
    const plants = (pl.data ?? []) as { id: string; is_active: boolean | null }[]
    const ativa = plants.find((p) => p.is_active !== false) ?? plants[0]
    setPlantId(ativa?.id ?? null)
    setSemPlanta(plants.length === 0)
    const conta = new Map<string, number>()
    for (const p of ((po.data ?? []) as { cargo_id: string | null }[])) if (p.cargo_id) conta.set(p.cargo_id, (conta.get(p.cargo_id) ?? 0) + 1)
    setCargos(((cg.data ?? []) as Omit<Cargo, 'postos'>[]).map((c) => ({ ...c, postos: conta.get(c.id) ?? 0 })))
    setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  const salvar = useCallback(async (nome: string, id?: string) => {
    if (!empresa) return
    const limpo = nome.trim()
    if (!limpo) { flashErr('Informe o nome do cargo.'); return }
    if (!id && !plantId) { flashErr('Cadastre a planta industrial da empresa antes de criar cargos.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_cargo_salvar', {
      p_dados: { id: id ?? null, company_id: empresa, plant_id: id ? null : plantId, nome: limpo }, p_user: userId.current,
    })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível salvar o cargo. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroCargo[r?.erro ?? ''] ?? 'Não foi possível salvar o cargo.'); return }
    flash(id ? `Cargo "${limpo}" atualizado.` : `Cargo "${limpo}" criado.`)
    if (id) { setEditId(null); setEditNome('') } else { setNovoNome(''); setNovoAberto(false) }
    void carregar()
  }, [empresa, plantId, carregar])

  const excluir = useCallback(async (c: Cargo) => {
    if (!window.confirm(`Arquivar o cargo "${c.nome}"?\n\nEle sai da lista, mas o histórico não é apagado. Você pode reativá-lo depois em "Mostrar inativos".`)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_cargo_excluir', { p_id: c.id, p_user: userId.current })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível excluir o cargo. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string; postos?: number }
    if (!r?.ok) {
      if (r?.erro === 'cargo_em_uso') { flashErr(`Esse cargo tem ${r.postos ?? 'alguns'} posto(s) ativo(s). Mude ou arquive os postos antes de excluir o cargo.`); return }
      flashErr(erroCargo[r?.erro ?? ''] ?? 'Não foi possível excluir o cargo.'); return
    }
    flash(`Cargo "${c.nome}" arquivado (registro guardado).`)
    void carregar()
  }, [carregar])

  const reativar = useCallback(async (c: Cargo) => {
    if (!empresa) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_cargo_salvar', {
      p_dados: { id: c.id, company_id: empresa, nome: c.nome, ativo: true }, p_user: userId.current,
    })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível reativar o cargo. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroCargo[r?.erro ?? ''] ?? 'Não foi possível reativar o cargo.'); return }
    flash(`Cargo "${c.nome}" reativado.`); void carregar()
  }, [empresa, carregar])

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return cargos.filter((c) => (mostrarInativos || c.ativo) && (!t || c.nome.toLowerCase().includes(t)))
  }, [cargos, busca, mostrarInativos])
  const totalAtivos = cargos.filter((c) => c.ativo).length

  if (!empresa) return null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {msg && <div role="status" style={{ background: GREENBG, color: GREEN, border: `1px solid ${GREEN}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{msg}</div>}
      {erro && <div role="alert" style={{ background: REDBG, color: RED, border: `1px solid ${RED}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{erro}</div>}
      {semPlanta && <div style={{ ...card, color: MUT, fontSize: 13 }}>Esta empresa ainda não tem uma planta industrial cadastrada. Cadastre a planta antes de criar cargos.</div>}

      {/* Barra: busca + mostrar inativos + novo cargo */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <label style={{ flex: '1 1 220px', display: 'inline-flex', flexDirection: 'column', gap: 4, fontSize: 12, color: MUT }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Buscar cargo<AjudaCampo chave="maoobra.cargo.busca" rota={ROTA} /></span>
          <input data-testid="cargo-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome do cargo" style={inp} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: ESP, alignSelf: 'end', padding: '6px 0' }}>
          <input data-testid="cargo-mostrar-inativos" type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
          Mostrar inativos<AjudaCampo chave="maoobra.cargo.mostrar_inativos" rota={ROTA} />
        </label>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'end' }}>
          <button data-testid="cargo-novo" onClick={() => { setNovoAberto(true); setNovoNome('') }} style={btnGold} disabled={busy || semPlanta}>+ Novo cargo</button>
          <AjudaCampo chave="maoobra.cargo.novo" rota={ROTA} />
        </span>
      </div>

      {/* Form de novo cargo */}
      {novoAberto && (
        <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="cargo-novo-form">
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Nome do cargo<AjudaCampo chave="maoobra.cargo.nome" rota={ROTA} /></span>
            <input data-testid="cargo-novo-nome" autoFocus value={novoNome} onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void salvar(novoNome) }} placeholder="ex.: Operador de produção" style={inp} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button data-testid="cargo-novo-salvar" onClick={() => void salvar(novoNome)} style={btnGold} disabled={busy || !novoNome.trim()}>Salvar cargo</button>
            <button onClick={() => { setNovoAberto(false); setNovoNome('') }} style={btnOut} disabled={busy}>Cancelar</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ ...card, color: MUT }}>Carregando os cargos…</div>
      ) : cargos.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', display: 'grid', gap: 10, padding: '28px 16px' }} data-testid="cargo-vazio">
          <div style={{ fontSize: 15, fontWeight: 600 }}>Nenhum cargo cadastrado ainda</div>
          <div style={{ fontSize: 13, color: MUT, maxWidth: '52ch', margin: '0 auto' }}>Comece criando os cargos da sua operação (ex.: Operador de produção, Encarregado, Auxiliar). Depois você define o salário base de cada cargo e liga os postos a ele.</div>
          <div><button data-testid="cargo-vazio-novo" onClick={() => { setNovoAberto(true); setNovoNome('') }} style={btnGold} disabled={semPlanta}>+ Criar o primeiro cargo</button></div>
        </div>
      ) : filtrados.length === 0 ? (
        <div style={{ ...card, color: MUT }}>Nenhum cargo encontrado com esse filtro.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, color: MUT, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>{totalAtivos} cargo(s) ativo(s){mostrarInativos && cargos.length > totalAtivos ? ` · ${cargos.length - totalAtivos} inativo(s)` : ''}</span>
          </div>
          {filtrados.map((c) => (
            <div key={c.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: c.ativo ? 1 : 0.7 }} data-testid="cargo-linha">
              {editId === c.id ? (
                <div style={{ flex: '1 1 240px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ flex: '1 1 180px', display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Nome do cargo<AjudaCampo chave="maoobra.cargo.nome" rota={ROTA} /></span>
                    <input data-testid="cargo-edit-nome" autoFocus value={editNome} onChange={(e) => setEditNome(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void salvar(editNome, c.id) }} style={inp} />
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignSelf: 'end' }}>
                    <button data-testid="cargo-edit-salvar" onClick={() => void salvar(editNome, c.id)} style={btnGold} disabled={busy || !editNome.trim()}>Salvar</button>
                    <button onClick={() => { setEditId(null); setEditNome('') }} style={btnOut} disabled={busy}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nome}</div>
                    <div style={{ fontSize: 12, color: MUT, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {c.postos} posto(s)<AjudaCampo chave="maoobra.cargo.postos" rota={ROTA} />
                    </div>
                  </div>
                  {!c.ativo && <span style={{ fontSize: 11, fontWeight: 700, color: MUT, background: '#00000008', border: `1px solid ${LINE}`, borderRadius: 999, padding: '2px 9px' }}>Inativo</span>}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                    {c.ativo ? (
                      <>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <button data-testid="cargo-editar" onClick={() => { setEditId(c.id); setEditNome(c.nome) }} style={btnOut} disabled={busy}>Editar</button>
                          <AjudaCampo chave="maoobra.cargo.editar" rota={ROTA} />
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <button data-testid="cargo-excluir" onClick={() => void excluir(c)} style={btnDel} disabled={busy}>Excluir</button>
                          <AjudaCampo chave="maoobra.cargo.excluir" rota={ROTA} />
                        </span>
                      </>
                    ) : (
                      <button data-testid="cargo-reativar" onClick={() => void reativar(c)} style={btnOut} disabled={busy}>Reativar</button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
