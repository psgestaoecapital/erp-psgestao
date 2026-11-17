'use client'
// Indústria › RH › Gestão de Mão de Obra — PR5: ALOCAR PESSOA ao posto (aba Pessoas), agnóstico de ramo.
// Fecha o elo setor → cargo → posto → PESSOA: quem trabalha em cada posto, desde quando. É o que liga as horas
// e o custo de mão de obra ao posto (e depois ao produto). Reaproveita os RPCs que já existem
// fn_prod_posto_pessoa_alocar / fn_prod_posto_pessoa_desalocar (RLS por company_id, amarração por CPF ao cadastro
// da própria empresa; terceiro/sem par fica manual, só o CPF). A fonte de pessoas é ind_pessoa (quadro industrial).
// Mesmo padrão visual/UX das abas Setores, Cargos, Postos e Salário (paleta plana, RPC {ok,erro}, RD-95, celular 390px).
// Code: desenvolvedor_4_g.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/industrial/rh/mao-de-obra'
const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', GREENBG = '#ECFDF5', RED = '#B42318', REDBG = '#FCEBEB'

type Posto = { id: string; numero: string | null; atividade: string; setor_id: string | null }
type Setor = { id: string; nome: string }
type Pessoa = { id: string; nome: string; cpf: string | null; setor: string | null }
type Aloc = { id: string; cpf: string | null; funcionario_id: string | null; vigencia_inicio: string; vigencia_fim: string | null }

const inp: React.CSSProperties = { padding: '9px 11px', fontSize: 14, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP, width: '100%', boxSizing: 'border-box' }
const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOut: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const btnDel: React.CSSProperties = { ...btnOut, color: RED, borderColor: 'rgba(180,35,24,0.35)' }

const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/[^0-9]/g, '')
const cpfMask = (s: string | null) => {
  const d = soDigitos(s)
  if (d.length !== 11) return s ?? ''
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

const erroAloc: Record<string, string> = {
  posto_obrigatorio: 'Escolha o posto antes de alocar.',
  posto_nao_encontrado: 'Esse posto não existe mais. Atualize a lista.',
  posto_sem_planta: 'O posto está sem planta industrial. Cadastre a planta da empresa primeiro.',
  sem_pessoa: 'Escolha a pessoa que vai ocupar o posto.',
  sem_acesso: 'Sem acesso a esta empresa.',
  funcionario_outra_empresa: 'Essa pessoa é de outra empresa. Escolha alguém do quadro desta empresa.',
  alocacao_nao_encontrada: 'Essa alocação não existe mais. Atualize a lista.',
  ja_encerrada: 'Essa alocação já estava encerrada.',
}

export default function PessoasPanel({ empresa }: { empresa: string | null }) {
  const [postos, setPostos] = useState<Posto[]>([])
  const [setores, setSetores] = useState<Setor[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [alocacoes, setAlocacoes] = useState<Aloc[]>([])
  const [postoSel, setPostoSel] = useState('')
  const [loading, setLoading] = useState(true)
  const [carregandoAloc, setCarregandoAloc] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [pessoaSel, setPessoaSel] = useState('')
  const [vigencia, setVigencia] = useState('')
  const [mostrarEncerradas, setMostrarEncerradas] = useState(false)
  const [busy, setBusy] = useState(false)
  const userId = useRef<string | null>(null)
  const seq = useRef(0)
  const seqA = useRef(0)

  const flash = (m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }
  const flashErr = (m: string) => { setErro(m); window.setTimeout(() => setErro(null), 6000) }

  // base: postos ativos, setores (para rotular) e o quadro de pessoas da empresa (ind_pessoa, ativos)
  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    const minha = ++seq.current
    setLoading(true); setErro(null)
    if (!userId.current) { const { data } = await supabase.auth.getUser(); userId.current = data.user?.id ?? null }
    const [po, st, pe] = await Promise.all([
      supabase.from('prod_posto').select('id, numero, atividade, setor_id').eq('company_id', empresa).eq('ativo', true).order('atividade', { ascending: true }),
      supabase.from('prod_setor').select('id, nome').eq('company_id', empresa).eq('ativo', true).order('nome', { ascending: true }),
      supabase.from('ind_pessoa').select('id, nome, cpf, setor').eq('company_id', empresa).eq('ativo', true).order('nome', { ascending: true }),
    ])
    if (minha !== seq.current) return
    if (po.error) { setErro(erroAmigavel(po.error, 'Não foi possível carregar os postos. Tente de novo.')); setLoading(false); return }
    setPostos((po.data ?? []) as Posto[])
    setSetores((st.data ?? []) as Setor[])
    setPessoas((pe.data ?? []) as Pessoa[])
    setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  // alocações do posto selecionado (vigentes; opcionalmente também as encerradas)
  const carregarAloc = useCallback(async () => {
    if (!empresa || !postoSel) { setAlocacoes([]); return }
    const minha = ++seqA.current
    setCarregandoAloc(true)
    const { data, error } = await supabase
      .from('prod_posto_pessoa')
      .select('id, cpf, funcionario_id, vigencia_inicio, vigencia_fim')
      .eq('company_id', empresa).eq('posto_id', postoSel)
      .order('vigencia_fim', { ascending: true, nullsFirst: true })
      .order('vigencia_inicio', { ascending: false })
    if (minha !== seqA.current) return
    setCarregandoAloc(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar as pessoas do posto. Tente de novo.')); return }
    setAlocacoes((data ?? []) as Aloc[])
  }, [empresa, postoSel])
  useEffect(() => { void carregarAloc() }, [carregarAloc])

  const setorNome = useMemo(() => new Map(setores.map((s) => [s.id, s.nome])), [setores])
  const pessoaPorCpf = useMemo(() => {
    const m = new Map<string, Pessoa>()
    for (const p of pessoas) { const d = soDigitos(p.cpf); if (d) m.set(d, p) }
    return m
  }, [pessoas])

  const postoLabel = useCallback((p: Posto) => {
    const s = p.setor_id ? setorNome.get(p.setor_id) : null
    return `${p.atividade}${s ? ` · ${s}` : ''}`
  }, [setorNome])

  const nomeDaAloc = useCallback((a: Aloc) => {
    const d = soDigitos(a.cpf)
    const p = d ? pessoaPorCpf.get(d) : undefined
    return p?.nome ?? (d ? cpfMask(a.cpf) : 'Pessoa sem identificação')
  }, [pessoaPorCpf])

  const pessoasFiltradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return pessoas.slice(0, 50)
    return pessoas.filter((p) => p.nome.toLowerCase().includes(t) || soDigitos(p.cpf).includes(soDigitos(t))).slice(0, 50)
  }, [pessoas, busca])

  const vigentes = useMemo(() => alocacoes.filter((a) => !a.vigencia_fim), [alocacoes])
  const encerradas = useMemo(() => alocacoes.filter((a) => a.vigencia_fim), [alocacoes])

  const alocar = useCallback(async () => {
    if (!empresa || !postoSel) { flashErr('Escolha o posto antes de alocar.'); return }
    const pessoa = pessoas.find((p) => p.id === pessoaSel)
    if (!pessoa) { flashErr('Escolha a pessoa que vai ocupar o posto.'); return }
    if (!soDigitos(pessoa.cpf)) { flashErr('Essa pessoa está sem CPF no cadastro — complete o CPF em RH para alocá-la.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_posto_pessoa_alocar', {
      p_dados: { posto_id: postoSel, cpf: pessoa.cpf, vigencia_inicio: vigencia || null },
      p_user: userId.current,
    })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível alocar a pessoa. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroAloc[r?.erro ?? ''] ?? 'Não foi possível alocar a pessoa.'); return }
    flash(`${pessoa.nome} alocado(a) ao posto.`)
    setPessoaSel(''); setBusca(''); setVigencia('')
    void carregarAloc()
  }, [empresa, postoSel, pessoaSel, vigencia, pessoas, carregarAloc])

  const desalocar = useCallback(async (a: Aloc) => {
    if (!window.confirm(`Encerrar a alocação de "${nomeDaAloc(a)}" neste posto?\n\nA pessoa sai do posto a partir de hoje; o histórico da alocação não é apagado.`)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_posto_pessoa_desalocar', { p_id: a.id, p_user: userId.current })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível encerrar a alocação. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroAloc[r?.erro ?? ''] ?? 'Não foi possível encerrar a alocação.'); return }
    flash('Alocação encerrada (registro guardado).')
    void carregarAloc()
  }, [nomeDaAloc, carregarAloc])

  if (loading) return <div style={{ ...card, color: MUT }}>Carregando o quadro de postos e pessoas…</div>

  if (postos.length === 0) {
    return (
      <div style={{ ...card, textAlign: 'center', display: 'grid', gap: 10, padding: '28px 16px' }} data-testid="pessoa-sem-posto">
        <div style={{ fontSize: 15, fontWeight: 600 }}>Nenhum posto cadastrado ainda</div>
        <div style={{ fontSize: 13, color: MUT, maxWidth: '54ch', margin: '0 auto' }}>
          Para alocar pessoas é preciso ter postos. Cadastre os postos na aba <strong>Postos</strong> e volte aqui para ligar as pessoas a cada posto.
        </div>
      </div>
    )
  }

  const posto = postos.find((p) => p.id === postoSel)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {msg && <div role="status" style={{ background: GREENBG, color: GREEN, border: `1px solid ${GREEN}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{msg}</div>}
      {erro && <div role="alert" style={{ background: REDBG, color: RED, border: `1px solid ${RED}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{erro}</div>}

      {/* Escolha do posto */}
      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Posto<AjudaCampo chave="maoobra.pessoa.posto" rota={ROTA} /></span>
          <select data-testid="pessoa-posto" value={postoSel} onChange={(e) => { setPostoSel(e.target.value); setPessoaSel(''); setBusca('') }} style={inp}>
            <option value="">Escolha um posto…</option>
            {postos.map((p) => <option key={p.id} value={p.id}>{postoLabel(p)}</option>)}
          </select>
        </label>
      </div>

      {!posto ? (
        <div style={{ ...card, color: MUT }}>Escolha um posto acima para ver e gerenciar quem trabalha nele.</div>
      ) : (
        <>
          {/* Alocar nova pessoa */}
          <div style={{ ...card, display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Alocar pessoa em “{posto.atividade}”</div>
            {pessoas.length === 0 ? (
              <div style={{ fontSize: 13, color: MUT }} data-testid="pessoa-sem-quadro">
                Esta empresa ainda não tem pessoas no quadro industrial. Cadastre o quadro de pessoal (RH) para alocar alguém ao posto.
              </div>
            ) : (
              <>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Buscar pessoa<AjudaCampo chave="maoobra.pessoa.busca" rota={ROTA} /></span>
                  <input data-testid="pessoa-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome ou CPF" style={inp} />
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Pessoa<AjudaCampo chave="maoobra.pessoa.pessoa" rota={ROTA} /></span>
                  <select data-testid="pessoa-select" value={pessoaSel} onChange={(e) => setPessoaSel(e.target.value)} style={inp}>
                    <option value="">Escolha a pessoa…</option>
                    {pessoasFiltradas.map((p) => (
                      <option key={p.id} value={p.id}>{p.nome}{p.cpf ? ` — ${cpfMask(p.cpf)}` : ''}{p.setor ? ` (${p.setor})` : ''}</option>
                    ))}
                  </select>
                  {busca.trim() && pessoasFiltradas.length === 0 && <span style={{ fontSize: 12, color: MUT }}>Ninguém encontrado com esse nome/CPF no quadro ativo.</span>}
                </label>
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: MUT, maxWidth: 220 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Início da alocação<AjudaCampo chave="maoobra.pessoa.vigencia" rota={ROTA} /></span>
                  <input data-testid="pessoa-vigencia" type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} style={inp} />
                </label>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <button data-testid="pessoa-alocar" onClick={() => void alocar()} style={btnGold} disabled={busy || !pessoaSel}>Alocar ao posto</button>
                  <AjudaCampo chave="maoobra.pessoa.alocar" rota={ROTA} />
                </div>
              </>
            )}
          </div>

          {/* Pessoas no posto */}
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: MUT, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>{vigentes.length} pessoa(s) no posto agora{encerradas.length ? ` · ${encerradas.length} encerrada(s)` : ''}</span>
              {encerradas.length > 0 && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: ESP }}>
                  <input data-testid="pessoa-mostrar-encerradas" type="checkbox" checked={mostrarEncerradas} onChange={(e) => setMostrarEncerradas(e.target.checked)} />
                  Mostrar encerradas<AjudaCampo chave="maoobra.pessoa.mostrar_encerradas" rota={ROTA} />
                </label>
              )}
            </div>

            {carregandoAloc ? (
              <div style={{ ...card, color: MUT }}>Carregando quem trabalha no posto…</div>
            ) : vigentes.length === 0 && (!mostrarEncerradas || encerradas.length === 0) ? (
              <div style={{ ...card, textAlign: 'center', display: 'grid', gap: 8, padding: '24px 16px' }} data-testid="pessoa-vazio">
                <div style={{ fontSize: 14, fontWeight: 600 }}>Ninguém alocado neste posto ainda</div>
                <div style={{ fontSize: 13, color: MUT, maxWidth: '50ch', margin: '0 auto' }}>Use o formulário acima para alocar a primeira pessoa ao posto “{posto.atividade}”.</div>
              </div>
            ) : (
              <>
                {vigentes.map((a) => (
                  <div key={a.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }} data-testid="pessoa-linha">
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{nomeDaAloc(a)}</div>
                      <div style={{ fontSize: 12, color: MUT }}>
                        {a.cpf ? cpfMask(a.cpf) : 'sem CPF'} · desde {new Date(a.vigencia_inicio + 'T00:00:00').toLocaleDateString('pt-BR')}
                        {a.funcionario_id ? '' : ' · manual (fora do cadastro)'}
                      </div>
                    </div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
                      <button data-testid="pessoa-desalocar" onClick={() => void desalocar(a)} style={btnDel} disabled={busy}>Encerrar</button>
                      <AjudaCampo chave="maoobra.pessoa.desalocar" rota={ROTA} />
                    </div>
                  </div>
                ))}
                {mostrarEncerradas && encerradas.map((a) => (
                  <div key={a.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: 0.7 }} data-testid="pessoa-linha-encerrada">
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{nomeDaAloc(a)}</div>
                      <div style={{ fontSize: 12, color: MUT }}>
                        {new Date(a.vigencia_inicio + 'T00:00:00').toLocaleDateString('pt-BR')} até {a.vigencia_fim ? new Date(a.vigencia_fim + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: MUT, background: '#00000008', border: `1px solid ${LINE}`, borderRadius: 999, padding: '2px 9px' }}>Encerrada</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
