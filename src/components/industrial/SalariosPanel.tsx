'use client'
// Indústria › RH › Gestão de Mão de Obra — PR4: SALÁRIO BASE por cargo (aba), agnóstico de ramo.
// O salário base do cargo é a referência do custo de mão de obra por hora/posto/produto (não é o salário individual).
// Reaproveita fn_prod_salario_salvar / fn_prod_salario_excluir (histórico por vigência; ao atualizar, fecha a anterior).
// LGPD: a leitura de prod_salario_base passa por fn__pode_ver_folha — a aba só mostra valores a quem pode ver a folha.
// Mesmo padrão visual/UX das abas Setores/Cargos. Code: desenvolvedor_4_g.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { erroAmigavel } from '@/lib/erroAmigavel'

const ROTA = '/dashboard/industrial/rh/mao-de-obra'
const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', GREENBG = '#ECFDF5', RED = '#B42318', REDBG = '#FCEBEB'

type Cargo = { id: string; nome: string }
type Base = { id: string; cargo_id: string; valor: number; fonte: string; vigencia_inicio: string }
type Linha = Cargo & { base: Base | null }

const FONTES: [string, string][] = [['manual', 'Manual'], ['folha', 'Folha'], ['acordo_coletivo', 'Acordo coletivo']]
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso: string) => { const [a, m, d] = iso.split('-'); return d ? `${d}/${m}/${a}` : iso }
const hojeISO = () => new Date().toISOString().slice(0, 10)

const inp: React.CSSProperties = { padding: '9px 11px', fontSize: 14, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP, width: '100%', boxSizing: 'border-box' }
const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOut: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const btnDel: React.CSSProperties = { ...btnOut, color: RED, borderColor: 'rgba(180,35,24,0.35)' }

const erroSal: Record<string, string> = {
  company_obrigatoria: 'Escolha uma empresa antes de salvar.',
  sem_acesso: 'Sem acesso a esta empresa.',
  valor_invalido: 'Informe um valor maior que zero.',
  fonte_invalida: 'Escolha uma fonte válida.',
  sem_alvo: 'Não foi possível identificar o cargo. Atualize a lista.',
  salario_nao_encontrado: 'Esse salário não existe mais. Atualize a lista.',
  ja_excluido: 'Esse salário já foi excluído.',
}

export default function SalariosPanel({ empresa }: { empresa: string | null }) {
  const [podeVer, setPodeVer] = useState<boolean | null>(null)
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [bases, setBases] = useState<Record<string, Base>>({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [valor, setValor] = useState('')
  const [fonte, setFonte] = useState('manual')
  const [vigencia, setVigencia] = useState(hojeISO())
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
    const { data: pode } = await supabase.rpc('fn__pode_ver_folha', { p_company_id: empresa })
    if (minha !== seq.current) return
    if (pode !== true) { setPodeVer(false); setLoading(false); return }
    setPodeVer(true)
    const [cg, sb] = await Promise.all([
      supabase.from('prod_cargo').select('id, nome').eq('company_id', empresa).eq('ativo', true).order('nome', { ascending: true }),
      supabase.from('prod_salario_base').select('id, cargo_id, valor, fonte, vigencia_inicio')
        .eq('company_id', empresa).is('funcionario_id', null).is('vigencia_fim', null).is('excluido_em', null)
        .not('cargo_id', 'is', null),
    ])
    if (minha !== seq.current) return
    if (cg.error) { setErro(erroAmigavel(cg.error, 'Não foi possível carregar os cargos. Tente de novo.')); setLoading(false); return }
    const mapa: Record<string, Base> = {}
    for (const b of ((sb.data ?? []) as Base[])) if (b.cargo_id) mapa[b.cargo_id] = b
    setBases(mapa)
    setCargos((cg.data ?? []) as Cargo[])
    setLoading(false)
  }, [empresa])
  useEffect(() => { void carregar() }, [carregar])

  const abrir = (c: Linha) => {
    setEditId(c.id)
    setValor(c.base ? String(c.base.valor).replace('.', ',') : '')
    setFonte(c.base?.fonte ?? 'manual')
    setVigencia(hojeISO())
  }

  const salvar = useCallback(async (cargoId: string) => {
    if (!empresa) return
    const n = Number(valor.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) { flashErr('Informe um valor maior que zero.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_salario_salvar', {
      p_dados: { company_id: empresa, cargo_id: cargoId, valor: n, fonte, vigencia_inicio: vigencia || hojeISO() },
      p_user: userId.current,
    })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível salvar o salário. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroSal[r?.erro ?? ''] ?? 'Não foi possível salvar o salário.'); return }
    flash('Salário base registrado.')
    setEditId(null); void carregar()
  }, [empresa, valor, fonte, vigencia, carregar])

  const excluir = useCallback(async (c: Linha) => {
    if (!c.base) return
    if (!window.confirm(`Excluir o salário base de "${c.nome}" (${brl(c.base.valor)})?\n\nO histórico é preservado; o cargo volta a ficar sem salário definido.`)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_prod_salario_excluir', { p_id: c.base.id, p_user: userId.current })
    setBusy(false)
    if (error) { flashErr(erroAmigavel(error, 'Não foi possível excluir o salário. Tente de novo.')); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r?.ok) { flashErr(erroSal[r?.erro ?? ''] ?? 'Não foi possível excluir o salário.'); return }
    flash(`Salário base de "${c.nome}" excluído (histórico guardado).`)
    void carregar()
  }, [carregar])

  const linhas: Linha[] = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return cargos.filter((c) => !t || c.nome.toLowerCase().includes(t)).map((c) => ({ ...c, base: bases[c.id] ?? null }))
  }, [cargos, bases, busca])
  const definidos = Object.keys(bases).length

  if (!empresa) return null

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {msg && <div role="status" style={{ background: GREENBG, color: GREEN, border: `1px solid ${GREEN}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{msg}</div>}
      {erro && <div role="alert" style={{ background: REDBG, color: RED, border: `1px solid ${RED}33`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{erro}</div>}

      {podeVer === false ? (
        <div style={{ ...card, color: MUT, fontSize: 13 }} data-testid="salario-sem-permissao">
          Você não tem permissão para ver os salários (folha) desta empresa. Peça acesso ao responsável pela folha.
        </div>
      ) : loading ? (
        <div style={{ ...card, color: MUT }}>Carregando os salários…</div>
      ) : cargos.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', display: 'grid', gap: 10, padding: '28px 16px' }} data-testid="salario-vazio">
          <div style={{ fontSize: 15, fontWeight: 600 }}>Nenhum cargo ativo ainda</div>
          <div style={{ fontSize: 13, color: MUT, maxWidth: '52ch', margin: '0 auto' }}>Cadastre os cargos na aba "Cargos"; depois defina aqui o salário base de cada um.</div>
        </div>
      ) : (
        <>
          <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <label style={{ flex: '1 1 220px', display: 'inline-flex', flexDirection: 'column', gap: 4, fontSize: 12, color: MUT }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Buscar cargo<AjudaCampo chave="maoobra.salario.busca" rota={ROTA} /></span>
              <input data-testid="salario-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome do cargo" style={inp} />
            </label>
            <div style={{ fontSize: 12, color: MUT, alignSelf: 'end', padding: '6px 0' }}>{definidos} de {cargos.length} cargo(s) com salário definido</div>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {linhas.map((c) => (
              <div key={c.id} style={{ ...card, display: 'grid', gap: 10 }} data-testid="salario-linha">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nome}</div>
                    <div style={{ fontSize: 12.5, color: c.base ? ESP : MUT, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {c.base ? `${brl(c.base.valor)} · desde ${dataBR(c.base.vigencia_inicio)}` : 'Sem salário definido'}
                      <AjudaCampo chave="maoobra.salario.atual" rota={ROTA} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <button data-testid="salario-definir" onClick={() => abrir(c)} style={btnGold} disabled={busy}>{c.base ? 'Atualizar' : 'Definir'}</button>
                      <AjudaCampo chave="maoobra.salario.definir" rota={ROTA} />
                    </span>
                    {c.base && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <button data-testid="salario-excluir" onClick={() => void excluir(c)} style={btnDel} disabled={busy}>Excluir</button>
                        <AjudaCampo chave="maoobra.salario.excluir" rota={ROTA} />
                      </span>
                    )}
                  </div>
                </div>

                {editId === c.id && (
                  <div style={{ display: 'grid', gap: 10, borderTop: `1px solid ${LINE}`, paddingTop: 10 }} data-testid="salario-form">
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <label style={{ flex: '1 1 140px', display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Valor (R$)<AjudaCampo chave="maoobra.salario.valor" rota={ROTA} /></span>
                        <input data-testid="salario-valor" inputMode="decimal" autoFocus value={valor} onChange={(e) => setValor(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void salvar(c.id) }} placeholder="2400,00" style={inp} />
                      </label>
                      <label style={{ flex: '1 1 140px', display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Fonte<AjudaCampo chave="maoobra.salario.fonte" rota={ROTA} /></span>
                        <select data-testid="salario-fonte" value={fonte} onChange={(e) => setFonte(e.target.value)} style={inp}>
                          {FONTES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <label style={{ flex: '1 1 140px', display: 'grid', gap: 4, fontSize: 12, color: MUT }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Vigência início<AjudaCampo chave="maoobra.salario.vigencia" rota={ROTA} /></span>
                        <input data-testid="salario-vigencia" type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} style={inp} />
                      </label>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button data-testid="salario-salvar" onClick={() => void salvar(c.id)} style={btnGold} disabled={busy || !valor.trim()}>Salvar salário</button>
                      <button onClick={() => setEditId(null)} style={btnOut} disabled={busy}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
