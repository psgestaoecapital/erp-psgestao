'use client'
// Indústria › RH › Gestão de Mão de Obra — PR3: CADASTRO de POSTO (aba), agnóstico de ramo.
// O posto é a atividade de trabalho dentro de um setor (ex.: "Desossa dianteiro", "Montagem da linha 2").
// É onde se alocam as pessoas e onde o custo de mão de obra ganha capacidade (peças/kg por hora) para virar
// custo por produto depois. Reaproveita os RPCs existentes fn_prod_posto_salvar / fn_prod_posto_excluir
// (RLS por company_id, confirmação de exclusão com o que será afetado). prod_posto exige plant_id
// (industrial_plants): resolvemos a planta ativa da empresa no cliente e enviamos no salvar.
// Mesmo padrão visual/UX das abas Setores e Cargos (paleta plana, RPC {ok,erro}, RD-95, celular 390px).
// Code: desenvolvedor_4_g.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/industrial/rh/mao-de-obra'
const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', GREENBG = '#ECFDF5', RED = '#B42318', REDBG = '#FCEBEB'

type Posto = { id: string; numero: string | null; atividade: string; setor_id: string | null; cargo_id: string | null; capacidade_hora: number | null }
type Setor = { id: string; nome: string }
type Cargo = { id: string; nome: string }
type Form = { atividade: string; setor_id: string; cargo_id: string; capacidade_hora: string }

const vazio: Form = { atividade: '', setor_id: '', cargo_id: '', capacidade_hora: '' }

const inp: React.CSSProperties = { padding: '9px 11px', fontSize: 14, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP, width: '100%', boxSizing: 'border-box' }
const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOut: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const btnDel: React.CSSProperties = { ...btnOut, color: RED, borderColor: 'rgba(180,35,24,0.35)' }

const erroPosto: Record<string, string> = {
  atividade_obrigatoria: 'Informe a atividade do posto.',
  contexto_incompleto: 'Escolha a empresa e o setor antes de salvar.',
  sem_acesso: 'Sem acesso a esta empresa.',
  posto_nao_encontrado: 'Esse posto não existe mais. Atualize a lista.',
  numero_duplicado: 'Já existe um posto com esse número neste setor.',
}

export default function PostosPanel({ empresa }: { empresa: string | null }) {
  const [postos, setPostos] = useState<Posto[]>([])
  const [setores, setSetores] = useState<Setor[]>([])
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [plantId, setPlantId] = useState<string | null>(null)
  const [semPlanta, setSemPlanta] = useState(false)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [filtroSetor, setFiltroSetor] = useState('')
  const [novoAberto, setNovoAberto] = useState(false)
  const [novo, setNovo] = useState<Form>(vazio)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Form>(vazio)
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
    const [po, st, cg, pl] = await Promise.all([
      supabase.from('prod_posto').select('id, numero, atividade, setor_id, cargo_id, capacidade_hora').eq('company_id', empresa).eq('ativo', true).order('setor_id', { ascending: true }).order('numero', { ascending: true }),
      supabase.from('prod_setor').select('id, nome').eq('company_id', empresa).eq('ativo', true).order('nome', { ascending: true }),
      supabase.from('prod_cargo').select('id, nome').eq('company_id', empresa).eq('ativo', true).order('nome', { ascending: true }),
      supabase.from('industrial_plants').select('id, is_active').eq('company_id', empresa).order('created_at', { ascending: true }),
    ])
    if (minha !== seq.current) return
    if (po.error) { setErro(erroAmigavel(po.error, 'Não foi possível carregar os postos. Tente de novo.')); setLoading(false); return }
    const plants = (pl.data ?? []) as { id: string; is_active: boolean | null }[]
    const ativa = plants.find((p) => p.is_active !== false) ?? plants[0]
    setPlantId(ativa?.id ?? null)
    setSemPlanta(plants.length === 0)
    setSetores((st.data ?? []) as Setor[])
    setCargos((cg.data ?? []) as Cargo[])
    setPostos((po.data ?? []) as Posto[])
    setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  const setorNome = useMemo(() => new Map(setores.map((s) => [s.id, s.nome])), [setores])
  const cargoNome = useMemo(() => new Map(cargos.map((c) => [c.id, c.nome])), [cargos])

  const salvar = useCallback(async (f: Form, id?: string) => {
    if (!empresa) return
    const atividade = f.atividade.trim()
    if (!atividade) { flashErr('Informe a atividade do posto.'); return }
    if (!id && !f.setor_id) { flashErr('Escolha o setor do posto.'); return }
    if (!id && !plantId) { flashErr('Cadastre a planta industrial da empresa antes de criar postos.'); return }
    const cap = f.capacidade_hora.trim().replace(',', '.')
    if (cap && !(Number(cap) > 0)) { flashErr('A capacidade por hora, quando informada, precisa ser maior que zero.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_posto_salvar', {
      p_dados: {
        id: id ?? null,
        company_id: empresa,
        plant_id: id ? null : plantId,
        setor_id: f.setor_id || null,
        atividade,
        cargo_id: f.cargo_id || null,
        capacidade_hora: cap || null,
      },
      p_user: userId.current,
    })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível salvar o posto. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroPosto[r?.erro ?? ''] ?? 'Não foi possível salvar o posto.'); return }
    flash(id ? `Posto "${atividade}" atualizado.` : `Posto "${atividade}" criado.`)
    if (id) { setEditId(null); setEditForm(vazio) } else { setNovo(vazio); setNovoAberto(false) }
    void carregar()
  }, [empresa, plantId, carregar])

  const excluir = useCallback(async (p: Posto) => {
    if (!empresa) return
    // 1ª chamada: descobre o que a exclusão afeta (pessoas alocadas, etapas, turnos) para avisar antes de confirmar.
    setBusy(true); setErro(null)
    const previa = await supabase.rpc('fn_prod_posto_excluir', { p_posto_id: p.id, p_confirmar: false, p_user: userId.current })
    if (previa.error) { setBusy(false); flashErr(erroAmigavel(previa.error, 'Não foi possível excluir o posto. Tente de novo.')); return }
    const pr = previa.data as { ok: boolean; erro?: string; afeta?: Record<string, number> }
    if (!pr?.ok) { setBusy(false); flashErr(erroPosto[pr?.erro ?? ''] ?? 'Não foi possível excluir o posto.'); return }
    const a = pr.afeta ?? {}
    const partes = [
      a.pessoas ? `${a.pessoas} pessoa(s) alocada(s)` : '',
      a.etapas_fluxo ? `${a.etapas_fluxo} etapa(s) de fluxo` : '',
      a.quadros ? `${a.quadros} turno(s)` : '',
    ].filter(Boolean)
    const aviso = partes.length ? `\n\nIsto também remove: ${partes.join(', ')}.` : ''
    if (!window.confirm(`Excluir o posto "${p.atividade}"?${aviso}\n\nO histórico de apontamentos não é apagado.`)) { setBusy(false); return }
    const { data, error } = await supabase.rpc('fn_prod_posto_excluir', { p_posto_id: p.id, p_confirmar: true, p_user: userId.current })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível excluir o posto. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroPosto[r?.erro ?? ''] ?? 'Não foi possível excluir o posto.'); return }
    flash(`Posto "${p.atividade}" excluído.`)
    void carregar()
  }, [empresa, carregar])

  const abrirEdicao = (p: Posto) => {
    setEditId(p.id)
    setEditForm({ atividade: p.atividade, setor_id: p.setor_id ?? '', cargo_id: p.cargo_id ?? '', capacidade_hora: p.capacidade_hora != null ? String(p.capacidade_hora) : '' })
  }

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return postos.filter((p) =>
      (!filtroSetor || p.setor_id === filtroSetor) &&
      (!t || p.atividade.toLowerCase().includes(t) || (p.numero ?? '').toLowerCase().includes(t)))
  }, [postos, busca, filtroSetor])

  if (!empresa) return null

  const setorOptions = setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)
  const cargoOptions = cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {msg && <div role="status" style={{ background: GREENBG, color: GREEN, border: `1px solid ${GREEN}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{msg}</div>}
      {erro && <div role="alert" style={{ background: REDBG, color: RED, border: `1px solid ${RED}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{erro}</div>}
      {semPlanta && <div style={{ ...card, color: MUT, fontSize: 13 }}>Esta empresa ainda não tem uma planta industrial cadastrada. Cadastre a planta antes de criar postos.</div>}
      {!semPlanta && setores.length === 0 && <div style={{ ...card, color: MUT, fontSize: 13 }}>Cadastre ao menos um setor na aba Setores antes de criar postos.</div>}

      {/* Barra: busca + filtro por setor + novo posto */}
      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <label style={{ flex: '1 1 220px', display: 'inline-flex', flexDirection: 'column', gap: 4, fontSize: 12, color: MUT }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Buscar posto<AjudaCampo chave="maoobra.posto.busca" rota={ROTA} /></span>
          <input data-testid="posto-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="atividade ou número" style={inp} />
        </label>
        <label style={{ flex: '1 1 180px', display: 'inline-flex', flexDirection: 'column', gap: 4, fontSize: 12, color: MUT }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Filtrar por setor<AjudaCampo chave="maoobra.posto.filtro_setor" rota={ROTA} /></span>
          <select data-testid="posto-filtro-setor" value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)} style={inp}>
            <option value="">Todos os setores</option>
            {setorOptions}
          </select>
        </label>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'end' }}>
          <button data-testid="posto-novo" onClick={() => { setNovoAberto(true); setNovo({ ...vazio, setor_id: filtroSetor }) }} style={btnGold} disabled={busy || semPlanta || setores.length === 0}>+ Novo posto</button>
          <AjudaCampo chave="maoobra.posto.novo" rota={ROTA} />
        </span>
      </div>

      {/* Form de novo posto */}
      {novoAberto && (
        <div style={{ ...card, display: 'grid', gap: 10 }} data-testid="posto-novo-form">
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Atividade do posto<AjudaCampo chave="maoobra.posto.atividade" rota={ROTA} /></span>
              <input data-testid="posto-novo-atividade" autoFocus value={novo.atividade} onChange={(e) => setNovo({ ...novo, atividade: e.target.value })} placeholder="ex.: Desossa do dianteiro" style={inp} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Setor<AjudaCampo chave="maoobra.posto.setor" rota={ROTA} /></span>
              <select data-testid="posto-novo-setor" value={novo.setor_id} onChange={(e) => setNovo({ ...novo, setor_id: e.target.value })} style={inp}>
                <option value="">Escolha o setor…</option>
                {setorOptions}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Cargo (opcional)<AjudaCampo chave="maoobra.posto.cargo" rota={ROTA} /></span>
              <select data-testid="posto-novo-cargo" value={novo.cargo_id} onChange={(e) => setNovo({ ...novo, cargo_id: e.target.value })} style={inp}>
                <option value="">Sem cargo definido</option>
                {cargoOptions}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Capacidade por hora (opcional)<AjudaCampo chave="maoobra.posto.capacidade" rota={ROTA} /></span>
              <input data-testid="posto-novo-capacidade" inputMode="decimal" value={novo.capacidade_hora} onChange={(e) => setNovo({ ...novo, capacidade_hora: e.target.value })} placeholder="ex.: 120" style={inp} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button data-testid="posto-novo-salvar" onClick={() => void salvar(novo)} style={btnGold} disabled={busy || !novo.atividade.trim() || !novo.setor_id}>Salvar posto</button>
            <button onClick={() => { setNovoAberto(false); setNovo(vazio) }} style={btnOut} disabled={busy}>Cancelar</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ ...card, color: MUT }}>Carregando os postos…</div>
      ) : postos.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', display: 'grid', gap: 10, padding: '28px 16px' }} data-testid="posto-vazio">
          <div style={{ fontSize: 15, fontWeight: 600 }}>Nenhum posto cadastrado ainda</div>
          <div style={{ fontSize: 13, color: MUT, maxWidth: '54ch', margin: '0 auto' }}>O posto é a atividade de trabalho dentro de um setor (ex.: Desossa do dianteiro, Montagem da linha 2). Depois de criar, você aloca as pessoas e define a capacidade de cada posto.</div>
          <div><button data-testid="posto-vazio-novo" onClick={() => { setNovoAberto(true); setNovo(vazio) }} style={btnGold} disabled={semPlanta || setores.length === 0}>+ Criar o primeiro posto</button></div>
        </div>
      ) : filtrados.length === 0 ? (
        <div style={{ ...card, color: MUT }}>Nenhum posto encontrado com esse filtro.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, color: MUT }}>{filtrados.length} posto(s)</div>
          {filtrados.map((p) => (
            <div key={p.id} style={{ ...card, display: 'grid', gap: 10 }} data-testid="posto-linha">
              {editId === p.id ? (
                <>
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Atividade do posto<AjudaCampo chave="maoobra.posto.atividade" rota={ROTA} /></span>
                      <input data-testid="posto-edit-atividade" autoFocus value={editForm.atividade} onChange={(e) => setEditForm({ ...editForm, atividade: e.target.value })} style={inp} />
                    </label>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Setor<AjudaCampo chave="maoobra.posto.setor" rota={ROTA} /></span>
                      <select data-testid="posto-edit-setor" value={editForm.setor_id} onChange={(e) => setEditForm({ ...editForm, setor_id: e.target.value })} style={inp}>
                        <option value="">Escolha o setor…</option>
                        {setorOptions}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Cargo (opcional)<AjudaCampo chave="maoobra.posto.cargo" rota={ROTA} /></span>
                      <select data-testid="posto-edit-cargo" value={editForm.cargo_id} onChange={(e) => setEditForm({ ...editForm, cargo_id: e.target.value })} style={inp}>
                        <option value="">Sem cargo definido</option>
                        {cargoOptions}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Capacidade por hora (opcional)<AjudaCampo chave="maoobra.posto.capacidade" rota={ROTA} /></span>
                      <input data-testid="posto-edit-capacidade" inputMode="decimal" value={editForm.capacidade_hora} onChange={(e) => setEditForm({ ...editForm, capacidade_hora: e.target.value })} style={inp} />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button data-testid="posto-edit-salvar" onClick={() => void salvar(editForm, p.id)} style={btnGold} disabled={busy || !editForm.atividade.trim()}>Salvar</button>
                    <button onClick={() => { setEditId(null); setEditForm(vazio) }} style={btnOut} disabled={busy}>Cancelar</button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.numero ? <span style={{ color: MUT, fontWeight: 600 }}>#{p.numero} · </span> : null}{p.atividade}
                    </div>
                    <div style={{ fontSize: 12, color: MUT }}>
                      {p.setor_id ? setorNome.get(p.setor_id) ?? 'Setor removido' : 'Sem setor'}
                      {p.cargo_id ? ` · ${cargoNome.get(p.cargo_id) ?? 'Cargo removido'}` : ''}
                      {p.capacidade_hora != null ? ` · ${p.capacidade_hora}/h` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <button data-testid="posto-editar" onClick={() => abrirEdicao(p)} style={btnOut} disabled={busy}>Editar</button>
                      <AjudaCampo chave="maoobra.posto.editar" rota={ROTA} />
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <button data-testid="posto-excluir" onClick={() => void excluir(p)} style={btnDel} disabled={busy}>Excluir</button>
                      <AjudaCampo chave="maoobra.posto.excluir" rota={ROTA} />
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
