'use client'
// Quadro de pessoal (CEO 11/11, Frioeste) — cadastra o quadro (pessoa por CPF, cargo, setor, supervisor, salário)
// e mostra o custo da folha POR CARGO / SETOR / SUPERVISOR, base do custo/hora do cargo (regra do CEO).
// LGPD: salário/custo/CPF só para RH/diretoria/admin (flag pode_custo que vem do backend); grupo < 3 pessoas agrega.
// Casa com o padrão das telas industriais (mao-obra / produtividade): paleta plana, useCompanyIds, RPC {ok,erro}, RD-95.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/industrial/rh/quadro'
const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534', GREENBG = '#ECFDF5', RED = '#B42318', REDBG = '#FCEBEB'

const brl = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR')
const fmtComp = (d: string | null) => { if (!d) return '—'; const [y, m] = d.slice(0, 7).split('-'); return `${m}/${y}` }

type Pessoa = {
  cpf: string; matricula: string | null; nome: string | null; funcao: string | null
  cargo_id: string | null; cargo: string | null; setor_id: string | null; setor: string | null
  supervisor: string | null; salario: number | null; custo_mensal: number | null; custo_hora: number | null; origem: string
}
type Quadro = { ok: boolean; erro?: string; pode_custo?: boolean; competencia?: string; pessoas?: Pessoa[] }
type Opcao = { id: string; nome: string }
type Grupo = { grupo: string; pessoas: number; custo_total: number; custo_medio: number; custo_hora_medio: number }
type CustoPor = { ok: boolean; pode_detalhe?: boolean; horas_mes?: number; grupos?: Grupo[] }
type Param = { encargos_pct: number; horas_mes: number; fonte_custo: string; competencia_ref: string | null }
type Aba = 'quadro' | 'cargo' | 'setor' | 'supervisor'

const inp: React.CSSProperties = { padding: '7px 9px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 7, background: '#fff', color: ESP, width: '100%', boxSizing: 'border-box' }
const th: React.CSSProperties = { padding: '9px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 13, color: ESP, borderTop: `0.5px solid ${LINE}`, verticalAlign: 'middle' }
const card: React.CSSProperties = { background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }
const btnGold: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnOut: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }

export default function QuadroPessoalPage() {
  const { selInfo, sel } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && sel ? sel : null

  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [quadro, setQuadro] = useState<Quadro | null>(null)
  const [competencias, setCompetencias] = useState<string[]>([])
  const [competencia, setCompetencia] = useState<string>('')
  const [param, setParam] = useState<Param>({ encargos_pct: 38.35, horas_mes: 220, fonte_custo: 'folha_total', competencia_ref: null })
  const [cargos, setCargos] = useState<Opcao[]>([])
  const [setores, setSetores] = useState<Opcao[]>([])
  const [busca, setBusca] = useState('')
  const [aba, setAba] = useState<Aba>('quadro')
  const [custoPor, setCustoPor] = useState<CustoPor | null>(null)
  const [loteAberto, setLoteAberto] = useState(false)
  const reqSeq = useRef(0) // descarta resposta obsoleta: load antigo não sobrescreve a competência atual (seletor × grade)

  const flash = (m: string) => { setMsg(m); setErro(null); window.setTimeout(() => setMsg(null), 3500) }
  const flashErr = (m: string) => { setErro(m); window.setTimeout(() => setErro(null), 6000) }

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    const seq = ++reqSeq.current
    setLoading(true); setErro(null)
    const [q, comps, par, cg, st] = await Promise.all([
      supabase.rpc('fn_rh_quadro_pessoas', { p_company_id: empresa, p_competencia: competencia || null }),
      supabase.from('folha_competencia').select('competencia').eq('company_id', empresa),
      supabase.from('rh_parametro_custo').select('encargos_pct, horas_mes, fonte_custo, competencia_ref').eq('company_id', empresa).maybeSingle(),
      supabase.from('prod_cargo').select('id, nome').eq('company_id', empresa).eq('ativo', true).order('nome'),
      supabase.from('prod_setor').select('id, nome').eq('company_id', empresa).eq('ativo', true).order('nome'),
    ])
    if (seq !== reqSeq.current) return // resposta obsoleta: descarta — seletor e grade ficam na MESMA competência
    if (q.error) { setErro(q.error.message); setLoading(false); return }
    const r = q.data as Quadro
    if (r && !r.ok) { setErro(r.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : 'Falha ao carregar o quadro.'); setLoading(false); return }
    setQuadro(r)
    const cs = [...new Set(((comps.data ?? []) as { competencia: string }[]).map((x) => x.competencia))].sort().reverse()
    setCompetencias(cs)
    if (!competencia && r?.competencia) setCompetencia(r.competencia)
    if (par.data) setParam(par.data as Param)
    setCargos((cg.data ?? []) as Opcao[])
    setSetores((st.data ?? []) as Opcao[])
    setLoading(false)
  }, [empresa, competencia])
  useEffect(() => { void carregar() }, [carregar])

  const carregarAba = useCallback(async (a: Aba) => {
    if (!empresa || a === 'quadro') return
    const { data, error } = await supabase.rpc('fn_rh_custo_por', { p_company_id: empresa, p_agrupar: a, p_competencia: competencia || null })
    if (error) { flashErr(error.message); return }
    setCustoPor(data as CustoPor)
  }, [empresa, competencia])
  useEffect(() => { if (aba !== 'quadro') void carregarAba(aba) }, [aba, carregarAba])

  const pode = quadro?.pode_custo === true
  const pessoasFiltradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const list = quadro?.pessoas ?? []
    if (!t) return list
    return list.filter((p) => (p.nome ?? '').toLowerCase().includes(t) || (p.cpf ?? '').includes(t.replace(/\D/g, '')) || (p.funcao ?? '').toLowerCase().includes(t))
  }, [quadro, busca])

  async function salvarParam() {
    if (!empresa) return
    const { data, error } = await supabase.rpc('fn_rh_parametro_custo_salvar', { p_company_id: empresa, p_dados: param })
    if (error || (data as { ok?: boolean })?.ok === false) { flashErr(error?.message || 'Sem permissão para alterar os parâmetros (só RH/diretoria/admin).'); return }
    flash('Parâmetros salvos.'); void carregar()
  }

  async function salvarPessoa(cpf: string, patch: Record<string, string>) {
    if (!empresa) return
    const { data, error } = await supabase.rpc('fn_rh_pessoa_complemento_salvar', { p_company_id: empresa, p_cpf: cpf, p_dados: patch })
    const r = data as { ok?: boolean; erro?: string }
    if (error || r?.ok === false) {
      const map: Record<string, string> = { sem_permissao_rh: 'Só RH/diretoria/admin editam o quadro.', cpf_invalido: 'CPF inválido.', sem_acesso: 'Sem acesso.' }
      flashErr(error?.message || map[r?.erro ?? ''] || 'Não consegui salvar.'); return
    }
    flash('Salvo.'); void carregar()
  }

  // RD-98 p2 (auditor): excluir rastreável do complemento da pessoa (cargo/setor/supervisor/salário).
  // Exclusão lógica (recuperável) com motivo obrigatório; o ponto/folha da pessoa continua intacto.
  async function excluirPessoa(cpf: string, matricula: string, nome: string) {
    if (!empresa) return
    if (!window.confirm(`Excluir o complemento de ${nome || 'esta pessoa'}?\nCargo, setor, supervisor e salário saem do custo da folha. É recuperável e fica registrado; o ponto/folha continua.`)) return
    const motivo = window.prompt('Motivo da exclusão (fica no histórico):')
    if (motivo === null) return
    if (motivo.trim().length < 3) { flashErr('Informe o motivo (mínimo 3 caracteres).'); return }
    const { data, error } = await supabase.rpc('fn_rh_pessoa_complemento_excluir', { p_company_id: empresa, p_cpf: cpf, p_matricula: matricula, p_motivo: motivo.trim() })
    const r = data as { ok?: boolean; erro?: string }
    if (error || r?.ok === false) {
      const map: Record<string, string> = { sem_permissao_rh: 'Só RH/diretoria/admin editam o quadro.', sem_acesso: 'Sem acesso.', motivo_obrigatorio: 'Informe o motivo (mínimo 3 caracteres).', nao_encontrado: 'Esta pessoa não tem complemento para excluir.', identificacao_invalida: 'Não foi possível identificar a pessoa (sem CPF nem matrícula).' }
      flashErr(error?.message || map[r?.erro ?? ''] || 'Não consegui excluir.'); return
    }
    flash('Complemento excluído.'); void carregar()
  }

  if (!empresa) return <Casca><div style={card}>Selecione uma empresa específica para ver o quadro de pessoal.</div></Casca>
  if (loading) return <Casca><div style={{ ...card, color: MUT }}>Carregando…</div></Casca>

  return (
    <Casca>
      {msg && <div style={{ background: GREENBG, color: GREEN, padding: '9px 13px', borderRadius: 8, fontSize: 13 }}>{msg}</div>}
      {erro && <div style={{ background: REDBG, color: RED, padding: '9px 13px', borderRadius: 8, fontSize: 13 }}>{erro}</div>}

      {/* Parâmetros de custo */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, color: MUT, minWidth: 140, flex: '1 1 150px' }}>
            Competência <AjudaCampo chave="rh.quadro.competencia" rota={ROTA} />
            <select style={inp} value={competencia} onChange={(e) => setCompetencia(e.target.value)}>
              {competencias.length === 0 && <option value="">— sem folha —</option>}
              {competencias.map((c) => <option key={c} value={c}>{fmtComp(c)}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: MUT, flex: '1 1 110px' }}>
            Encargos (%) <AjudaCampo chave="rh.quadro.encargos" rota={ROTA} />
            <input style={inp} inputMode="decimal" value={String(param.encargos_pct)} onChange={(e) => setParam({ ...param, encargos_pct: Number(e.target.value.replace(',', '.')) || 0 })} />
          </label>
          <label style={{ fontSize: 12, color: MUT, flex: '1 1 100px' }}>
            Horas/mês <AjudaCampo chave="rh.quadro.horas_mes" rota={ROTA} />
            <input style={inp} inputMode="numeric" value={String(param.horas_mes)} onChange={(e) => setParam({ ...param, horas_mes: Number(e.target.value.replace(',', '.')) || 0 })} />
          </label>
          <label style={{ fontSize: 12, color: MUT, flex: '1 1 170px' }}>
            Fonte do custo <AjudaCampo chave="rh.quadro.fonte_custo" rota={ROTA} />
            <select style={inp} value={param.fonte_custo} onChange={(e) => setParam({ ...param, fonte_custo: e.target.value })}>
              <option value="folha_total">Folha (total com encargos)</option>
              <option value="salario_mais_encargos">Salário + encargos</option>
            </select>
          </label>
          {pode && <button style={btnGold} onClick={() => void salvarParam()}>Salvar parâmetros</button>}
        </div>
        {!pode && <div style={{ fontSize: 11, color: MUT, marginTop: 10 }}>🔒 Salário, custo e CPF ocultos — visíveis só para o perfil de RH, diretoria ou admin (LGPD).</div>}
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([['quadro', 'Quadro'], ['cargo', 'Por cargo'], ['setor', 'Por setor'], ['supervisor', 'Por supervisor']] as [Aba, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setAba(k)} style={{ ...btnOut, background: aba === k ? '#FBF3DE' : '#fff', borderColor: aba === k ? GOLD : LINE, fontWeight: aba === k ? 700 : 600 }}>
            {label}{k !== 'quadro' && <AjudaCampo chave={`rh.quadro.aba_${k}`} rota={ROTA} />}
          </button>
        ))}
      </div>

      {aba === 'quadro' ? (
        <div style={card}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <input style={{ ...inp, maxWidth: 280 }} placeholder="Buscar por nome, CPF ou função…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <AjudaCampo chave="rh.quadro.cpf" rota={ROTA} />
            <span style={{ fontSize: 12, color: MUT }}>{pessoasFiltradas.length} pessoa(s) · competência {fmtComp(quadro?.competencia ?? null)}</span>
            <div style={{ flex: 1 }} />
            {pode && <button style={btnOut} onClick={() => setLoteAberto(true)}>Colar da planilha <AjudaCampo chave="rh.quadro.colar" rota={ROTA} /></button>}
            <Link href="/dashboard/produtividade" style={{ ...btnOut, textDecoration: 'none' }}>Ligar funções aos cargos <AjudaCampo chave="rh.quadro.ligar_cargos" rota={ROTA} /></Link>
          </div>
          <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead style={{ background: BG }}>
                <tr>
                  <th style={th}>Nome</th>
                  <th style={th}>CPF <AjudaCampo chave="rh.quadro.cpf" rota={ROTA} /></th>
                  <th style={th}>Função (ponto)</th>
                  <th style={th}>Cargo <AjudaCampo chave="rh.quadro.cargo" rota={ROTA} /></th>
                  <th style={th}>Setor <AjudaCampo chave="rh.quadro.setor" rota={ROTA} /></th>
                  <th style={th}>Supervisor <AjudaCampo chave="rh.quadro.supervisor" rota={ROTA} /></th>
                  <th style={th}>Salário <AjudaCampo chave="rh.quadro.salario" rota={ROTA} /></th>
                  <th style={{ ...th, textAlign: 'right' }}>Custo mês <AjudaCampo chave="rh.quadro.custo_mensal" rota={ROTA} /></th>
                  <th style={{ ...th, textAlign: 'right' }}>R$/h <AjudaCampo chave="rh.quadro.custo_hora" rota={ROTA} /></th>
                </tr>
              </thead>
              <tbody>
                {pessoasFiltradas.map((p) => (
                  <LinhaPessoa key={p.cpf || p.matricula || (p.nome ?? '')} p={p} pode={pode} cargos={cargos} setores={setores} onSalvar={salvarPessoa} onExcluir={excluirPessoa} />
                ))}
                {pessoasFiltradas.length === 0 && <tr><td style={{ ...td, color: MUT }} colSpan={9}>Nenhuma pessoa nesta competência.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={card}>
          {!custoPor?.pode_detalhe && <div style={{ fontSize: 11, color: MUT, marginBottom: 10 }}>🔒 Grupos com menos de 3 pessoas aparecem somados em “Apoio (menos de 3 pessoas)” (LGPD).</div>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead style={{ background: BG }}>
                <tr>
                  <th style={th}>{aba === 'cargo' ? 'Cargo' : aba === 'setor' ? 'Setor' : 'Supervisor'}</th>
                  <th style={{ ...th, textAlign: 'right' }}>Pessoas</th>
                  <th style={{ ...th, textAlign: 'right' }}>Custo total</th>
                  <th style={{ ...th, textAlign: 'right' }}>Custo médio</th>
                  <th style={{ ...th, textAlign: 'right' }}>R$/h médio</th>
                </tr>
              </thead>
              <tbody>
                {(custoPor?.grupos ?? []).map((g) => (
                  <tr key={g.grupo}>
                    <td style={{ ...td, fontWeight: 600 }}>{g.grupo}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{num(g.pessoas)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{brl(g.custo_total)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{brl(g.custo_medio)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: GOLD }}>{brl(g.custo_hora_medio)}</td>
                  </tr>
                ))}
                {(custoPor?.grupos ?? []).length === 0 && <tr><td style={{ ...td, color: MUT }} colSpan={5}>Sem dados para esta competência.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loteAberto && empresa && <LoteModal empresa={empresa} onClose={() => setLoteAberto(false)} onGravou={() => { setLoteAberto(false); flash('Lote gravado.'); void carregar() }} />}
    </Casca>
  )
}

function LinhaPessoa({ p, pode, cargos, setores, onSalvar, onExcluir }: { p: Pessoa; pode: boolean; cargos: Opcao[]; setores: Opcao[]; onSalvar: (cpf: string, patch: Record<string, string>) => void; onExcluir: (cpf: string, matricula: string, nome: string) => void }) {
  const [cargo, setCargo] = useState(p.cargo_id ?? '')
  const [setor, setSetor] = useState(p.setor_id ?? '')
  const [sup, setSup] = useState(p.supervisor ?? '')
  const [sal, setSal] = useState(p.salario != null ? String(p.salario) : '')
  const mudou = cargo !== (p.cargo_id ?? '') || setor !== (p.setor_id ?? '') || sup !== (p.supervisor ?? '') || sal !== (p.salario != null ? String(p.salario) : '')
  // Só há complemento para excluir quando a pessoa tem cargo/setor/supervisor/salário lançados (origem com complemento).
  const temComplemento = !!(p.cargo_id || p.setor_id || (p.supervisor && p.supervisor.trim()) || p.salario != null)
  return (
    // data-ajuda: os campos editáveis da linha são documentados pelo "?" de cada coluna no cabeçalho (RD-95).
    <tr data-ajuda="rh.quadro.cargo">
      <td style={{ ...td, fontWeight: 600 }}>{p.nome ?? '—'}{p.origem !== 'ponto_folha' && <span style={{ fontSize: 10, color: GOLD, marginLeft: 6 }}>{p.origem === 'so_folha' ? 'só folha' : 'só ponto'}</span>}</td>
      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: MUT }}>{p.cpf || (p.matricula ? `mat. ${p.matricula}` : '—')}</td>
      <td style={{ ...td, color: MUT }}>{p.funcao ?? '—'}</td>
      <td style={td}>
        {pode ? (
          <select style={{ ...inp, minWidth: 140 }} value={cargo} onChange={(e) => setCargo(e.target.value)}>
            <option value="">—</option>
            {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        ) : (p.cargo ?? '—')}
      </td>
      <td style={td}>
        {pode ? (
          <select style={{ ...inp, minWidth: 130 }} value={setor} onChange={(e) => setSetor(e.target.value)}>
            <option value="">—</option>
            {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        ) : (p.setor ?? '—')}
      </td>
      <td style={td}>{pode ? <input style={{ ...inp, minWidth: 120 }} value={sup} onChange={(e) => setSup(e.target.value)} /> : (p.supervisor ?? '—')}</td>
      <td style={td}>{pode ? <input style={{ ...inp, minWidth: 90 }} inputMode="decimal" value={sal} onChange={(e) => setSal(e.target.value)} /> : brl(p.salario)}</td>
      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pode ? brl(p.custo_mensal) : '🔒'}</td>
      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: GOLD, fontWeight: 700 }}>
        {pode ? brl(p.custo_hora) : '🔒'}
        {pode && mudou && <button style={{ ...btnGold, padding: '4px 8px', fontSize: 11, marginLeft: 6 }} onClick={() => onSalvar(p.cpf ?? '', { cargo_id: cargo, setor_id: setor, supervisor_nome: sup, salario_base: sal, matricula: p.matricula ?? '' })}>Salvar</button>}
        {pode && temComplemento && !mudou && <button style={{ ...btnOut, padding: '4px 8px', fontSize: 11, marginLeft: 6, borderColor: RED, color: RED }} onClick={() => onExcluir(p.cpf ?? '', p.matricula ?? '', p.nome ?? '')}>Excluir</button>}
        {pode && temComplemento && !mudou && <AjudaCampo chave="rh.quadro.excluir" rota={ROTA} />}
      </td>
    </tr>
  )
}

function LoteModal({ empresa, onClose, onGravou }: { empresa: string; onClose: () => void; onGravou: () => void }) {
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [rej, setRej] = useState<{ linha: unknown; motivo: string }[] | null>(null)

  async function gravar() {
    setBusy(true); setErro(null)
    const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [cpf, cargo, setor, supervisor, salario] = l.split(';').map((x) => (x ?? '').trim())
      return { cpf, cargo_nome: cargo, setor_nome: setor, supervisor_nome: supervisor, salario_base: salario }
    })
    const { data, error } = await supabase.rpc('fn_rh_pessoa_complemento_lote', { p_company_id: empresa, p_linhas: linhas })
    setBusy(false)
    const r = data as { ok?: boolean; erro?: string; gravadas?: number; rejeitadas?: { linha: unknown; motivo: string }[] }
    if (error || r?.ok === false) { setErro(error?.message || (r?.erro === 'sem_permissao_rh' ? 'Só RH/diretoria/admin.' : 'Falha ao gravar.')); return }
    if ((r?.rejeitadas ?? []).length > 0) { setRej(r!.rejeitadas!); setErro(`${r!.gravadas} gravada(s); ${r!.rejeitadas!.length} rejeitada(s) — veja abaixo.`); return }
    onGravou()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, padding: 20, maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: ESP }}>Colar da planilha</div>
        <label style={{ display: 'block' }}>
          <span style={{ display: 'block', fontSize: 12, color: MUT, margin: '4px 0 10px' }}>
            Uma pessoa por linha, colunas separadas por <code>;</code> na ordem: <b>CPF;cargo;setor;supervisor;salário</b>. O nome vem do ponto. <AjudaCampo chave="rh.quadro.colar" rota={ROTA} />
          </span>
          <textarea data-testid="rh-colar-texto" value={texto} onChange={(e) => { setTexto(e.target.value); setRej(null) }} rows={8}
            placeholder={'12345678900;Eviscerador;Abate;João da Silva;2500'}
            style={{ ...inp, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, resize: 'vertical' }} />
        </label>
        {erro && <div style={{ marginTop: 10, fontSize: 12.5, color: RED }}>{erro}</div>}
        {(rej ?? []).length > 0 && (
          <div style={{ marginTop: 8, maxHeight: 160, overflowY: 'auto', border: `1px solid ${LINE}`, borderRadius: 8 }}>
            {rej!.map((n, i) => <div key={i} style={{ padding: '6px 10px', fontSize: 11.5, borderTop: i ? `0.5px solid ${LINE}` : 'none' }}><b>{JSON.stringify(n.linha)}</b> — <span style={{ color: RED }}>{n.motivo}</span></div>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button style={btnOut} onClick={onClose}>Cancelar</button>
          <button style={btnGold} onClick={() => void gravar()} disabled={busy}>{busy ? 'Gravando…' : 'Gravar'}</button>
        </div>
      </div>
    </div>
  )
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px clamp(14px, 4vw, 40px)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 14 }}>
        <header>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>Indústria · Recursos Humanos</p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 0' }}>Quadro de pessoal</h1>
          <p style={{ fontSize: 12.5, color: MUT, margin: '6px 0 0', lineHeight: 1.5 }}>Pessoa por CPF, cargo, setor, supervisor e salário — e o custo da folha por cargo, setor e supervisor. Base do custo/hora do cargo.</p>
        </header>
        {children}
      </div>
    </div>
  )
}
