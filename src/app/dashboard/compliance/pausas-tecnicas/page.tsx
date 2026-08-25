'use client'
// Compliance · Pausas Térmicas frigorífico (NR-36 psicofisiológica + Art.253 CLT térmica) — Fase 1.
// Rota mantida /pausas-tecnicas (não quebrar links); rótulo exibido = "Pausas Térmicas" (COMPL-L1 #24).
// 4 abas: Config (regras editáveis) · Elegíveis (quem cumpre, por função/manual) · Apuração (devido vs
// realizado, semáforo) · Prova (relatório cronológico por funcionário). O DEVIDO sai de ind_ponto_dia.
// ⚠️ O REALIZADO depende do endpoint de pausas da IOPoint (Fase 2, Jian). Enquanto não vem, o painel mostra
// só o DEVIDO e diz claramente que NÃO prova concessão (RD-58/RD-51 — passivo trabalhista, sem número falso).
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { rpc } from '@/lib/authFetch'
import { Timer, Users, Snowflake, ClipboardList, FileText, AlertTriangle, Save, Play } from 'lucide-react'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8', borderLt: '#ece3d2',
  ink: '#1a1a1a', green: '#2d6a3e', greenBg: '#e8f3ec', amber: '#8a6a10', amberBg: '#fdf4e0',
  red: '#a02020', redBg: '#fce8e8', gray: '#6b6b6b', blue: '#1f4e79', blueBg: '#e8f0f8',
}
type Regra = { id: string; tipo: string; nome: string; parametros: Record<string, unknown>; base_legal: string | null; ativo: boolean }
type Colab = { colaborador_id: string; nome: string; cpf: string; funcao: string | null; departamento: string | null; psico: boolean; termica: boolean }
type Resumo = { colaborador_id: string; cpf: string; nome: string; funcao: string | null; tipo: string; dias: number; devido_min: number; realizado_min: number | null; dias_nao_cumpridos: number; dias_parciais: number; dias_aguardando: number; status: string }
type ProvaLinha = { data: string; tipo: string; jornada_seg: number; devido_min: number; realizado_min: number | null; status: string }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const fmtData = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '—'
const hhmm = (seg: number) => `${Math.floor(seg / 3600)}h${String(Math.round((seg % 3600) / 60)).padStart(2, '0')}`
const tipoLabel = (t: string) => t === 'termica_253' ? 'Térmica (Art.253)' : t === 'psicofisiologica' ? 'Psicofisiológica (NR-36)' : t
const semColor: Record<string, { c: string; bg: string; l: string }> = {
  cumprida: { c: C.green, bg: C.greenBg, l: 'Cumprida' },
  parcial: { c: C.amber, bg: C.amberBg, l: 'Parcial' },
  nao_cumprida: { c: C.red, bg: C.redBg, l: 'Não cumprida' },
  aguardando_realizado: { c: C.blue, bg: C.blueBg, l: 'Aguardando realizado' },
}

export default function PausasTecnicasPage() {
  const { sel, selInfo, loading } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' ? sel : null
  const [aba, setAba] = useState<'config' | 'elegiveis' | 'apuracao' | 'prova'>('config')

  if (loading) return <Wrap><div style={{ color: C.gray, padding: 40 }}>Carregando…</div></Wrap>
  if (!companyId) return <Wrap><Header /><Vazio titulo="Selecione uma empresa" texto="As pausas térmicas são por empresa. Escolha uma empresa específica no topo (não Consolidado/Grupo)." /></Wrap>

  return (
    <Wrap>
      <Header />
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.borderLt}`, flexWrap: 'wrap' }}>
        {([['config', 'Config', Timer], ['elegiveis', 'Elegíveis', Users], ['apuracao', 'Apuração', ClipboardList], ['prova', 'Prova', FileText]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setAba(k)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: aba === k ? 700 : 500, color: aba === k ? C.espresso : C.gray, borderBottom: `2px solid ${aba === k ? C.gold : 'transparent'}`, marginBottom: -1 }}><Icon size={16} /> {label}</button>
        ))}
      </div>
      {aba === 'config' && <AbaConfig companyId={companyId} />}
      {aba === 'elegiveis' && <AbaElegiveis companyId={companyId} />}
      {aba === 'apuracao' && <AbaApuracao companyId={companyId} />}
      {aba === 'prova' && <AbaProva companyId={companyId} />}
    </Wrap>
  )
}

// ─────────────────────────────────── Config ───────────────────────────────────
function AbaConfig({ companyId }: { companyId: string }) {
  const [regras, setRegras] = useState<Regra[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    setLoading(true)
    try { const r = await rpc<{ regras: Regra[] }>('fn_nr36_regra_listar', { p_company_id: companyId }); setRegras(r.regras || []) }
    catch (e) { setErro((e as Error).message) } finally { setLoading(false) }
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  const seed = async () => {
    try { await rpc('fn_nr36_regra_seed_padrao', { p_company_id: companyId }); await carregar() } catch (e) { setErro((e as Error).message) }
  }
  const salvar = async (r: Regra) => {
    setErro(''); setMsg('')
    try {
      await rpc('fn_nr36_regra_salvar', { p_company_id: companyId, p_tipo: r.tipo, p_nome: r.nome, p_parametros: r.parametros, p_ativo: r.ativo })
      setMsg('Regra salva.'); await carregar()
    } catch (e) { setErro((e as Error).message) }
  }
  const setParam = (tipo: string, patch: Record<string, unknown>) => setRegras(rs => rs.map(r => r.tipo === tipo ? { ...r, parametros: { ...r.parametros, ...patch } } : r))
  const setFaixa = (tipo: string, idx: number, campo: 'ate_h' | 'min', val: number) => setRegras(rs => rs.map(r => {
    if (r.tipo !== tipo) return r
    const faixas = [...((r.parametros.faixas as Record<string, number>[]) || [])]; faixas[idx] = { ...faixas[idx], [campo]: val }
    return { ...r, parametros: { ...r.parametros, faixas } }
  }))

  if (loading) return <Load />
  return (
    <div>
      <p style={{ fontSize: 12.5, color: C.gray, marginBottom: 12 }}>As duas pausas têm fatos geradores distintos (ergonomia × térmico) e <b>coexistem</b>: conceder uma não isenta a outra. Parâmetros editáveis (genérico p/ qualquer frigorífico). Confira com o jurídico/SST da empresa.</p>
      {regras.length === 0 ? (
        <Vazio titulo="Nenhuma regra cadastrada" texto="Crie as regras padrão (NR-36 psicofisiológica + Art.253 térmica) e ajuste conforme o jurídico." acao={<Btn onClick={seed}>Criar regras padrão</Btn>} />
      ) : regras.map(r => (
        <div key={r.id} style={{ ...card(), flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div><span style={{ fontWeight: 700, color: C.espresso }}>{tipoLabel(r.tipo)}</span><div style={{ fontSize: 11.5, color: C.gray }}>{r.base_legal}</div></div>
            <label style={{ fontSize: 12.5, color: C.espresso, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={r.ativo} onChange={e => setRegras(rs => rs.map(x => x.tipo === r.tipo ? { ...x, ativo: e.target.checked } : x))} /> Ativa</label>
          </div>
          {r.tipo === 'termica_253' ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Campo label="A cada (min de trabalho)"><input type="number" style={inp()} value={Number(r.parametros.gatilho_min ?? 100)} onChange={e => setParam(r.tipo, { gatilho_min: Number(e.target.value) })} /></Campo>
              <Campo label="Pausa (min)"><input type="number" style={inp()} value={Number(r.parametros.pausa_min ?? 20)} onChange={e => setParam(r.tipo, { pausa_min: Number(e.target.value) })} /></Campo>
              <div style={{ flex: 2, fontSize: 11.5, color: C.gray, alignSelf: 'center' }}>Art.253: 20 min de repouso a cada 1h40 (100 min) de trabalho contínuo, computado como trabalho efetivo.</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 12, color: C.gray, marginBottom: 4 }}>Faixas por jornada (até X horas → Y minutos):</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {((r.parametros.faixas as Record<string, number>[]) || []).map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center', background: C.beigeLt, borderRadius: 8, padding: '4px 8px' }}>
                    <input type="number" step="0.001" style={{ ...inp(), width: 68 }} value={f.ate_h} onChange={e => setFaixa(r.tipo, i, 'ate_h', Number(e.target.value))} /><span style={{ fontSize: 12, color: C.gray }}>h →</span>
                    <input type="number" style={{ ...inp(), width: 60 }} value={f.min} onChange={e => setFaixa(r.tipo, i, 'min', Number(e.target.value))} /><span style={{ fontSize: 12, color: C.gray }}>min</span>
                  </div>
                ))}
                <Campo label="Acima de (h)"><input type="number" step="0.001" style={{ ...inp(), width: 80 }} value={Number(r.parametros.acima_h ?? 9.1667)} onChange={e => setParam(r.tipo, { acima_h: Number(e.target.value) })} /></Campo>
                <Campo label="+ min"><input type="number" style={{ ...inp(), width: 60 }} value={Number(r.parametros.acima_add ?? 10)} onChange={e => setParam(r.tipo, { acima_add: Number(e.target.value) })} /></Campo>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Btn onClick={() => salvar(r)}><Save size={14} /> Salvar</Btn></div>
        </div>
      ))}
      {msg && <div style={{ fontSize: 12.5, color: C.green, marginTop: 8 }}>{msg}</div>}
      {erro && <div style={erroBox()}>{erro}</div>}
    </div>
  )
}

// ─────────────────────────────────── Elegíveis ───────────────────────────────────
function AbaElegiveis({ companyId }: { companyId: string }) {
  const [colabs, setColabs] = useState<Colab[]>([])
  const [funcoes, setFuncoes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroFuncao, setFiltroFuncao] = useState('')
  const [bulkFuncao, setBulkFuncao] = useState('')
  const [bulkTipo, setBulkTipo] = useState('termica_253')

  const carregar = useCallback(async () => {
    setLoading(true)
    try { const r = await rpc<{ colaboradores: Colab[]; funcoes: string[] }>('fn_nr36_elegiveis_listar', { p_company_id: companyId }); setColabs(r.colaboradores || []); setFuncoes((r.funcoes || []).filter(Boolean).sort()) }
    finally { setLoading(false) }
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  const toggle = async (c: Colab, tipo: 'psico' | 'termica', ativo: boolean) => {
    setColabs(cs => cs.map(x => x.colaborador_id === c.colaborador_id ? { ...x, [tipo]: ativo } : x))
    try { await rpc('fn_nr36_elegivel_set', { p_company_id: companyId, p_colaborador_id: c.colaborador_id, p_tipo: tipo === 'psico' ? 'psicofisiologica' : 'termica_253', p_ativo: ativo }) }
    catch (e) { alert((e as Error).message); void carregar() }
  }
  const aplicarFuncao = async () => {
    if (!bulkFuncao) return
    try { await rpc('fn_nr36_elegiveis_por_funcao', { p_company_id: companyId, p_tipo: bulkTipo, p_funcoes: [bulkFuncao] }); await carregar() } catch (e) { alert((e as Error).message) }
  }
  const filtrados = useMemo(() => filtroFuncao ? colabs.filter(c => c.funcao === filtroFuncao) : colabs, [colabs, filtroFuncao])

  if (loading) return <Load />
  return (
    <div>
      <div style={{ ...card(), flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.espresso }}>Marcar por função:</div>
        <select style={inp()} value={bulkFuncao} onChange={e => setBulkFuncao(e.target.value)}><option value="">Selecione a função…</option>{funcoes.map(f => <option key={f} value={f}>{f}</option>)}</select>
        <select style={inp()} value={bulkTipo} onChange={e => setBulkTipo(e.target.value)}><option value="termica_253">Térmica (Art.253)</option><option value="psicofisiologica">Psicofisiológica (NR-36)</option></select>
        <Btn onClick={aplicarFuncao} disabled={!bulkFuncao}>Marcar todos dessa função</Btn>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: C.gray }}>Filtrar:</span>
        <select style={inp()} value={filtroFuncao} onChange={e => setFiltroFuncao(e.target.value)}><option value="">Todas as funções</option>{funcoes.map(f => <option key={f} value={f}>{f}</option>)}</select>
        <span style={{ fontSize: 12.5, color: C.gray }}>{filtrados.length} colaborador(es)</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
            <th style={th()}>Colaborador</th><th style={th()}>Função</th><th style={{ ...th(), textAlign: 'center' }}>Psico (NR-36)</th><th style={{ ...th(), textAlign: 'center' }}>Térmica (253)</th>
          </tr></thead>
          <tbody>
            {filtrados.map(c => (
              <tr key={c.colaborador_id} style={{ borderBottom: `1px solid ${C.beigeLt}` }}>
                <td style={td()}><div style={{ fontWeight: 600, color: C.espresso }}>{c.nome}</div><div style={{ fontSize: 11, color: C.gray }}>{c.departamento || ''}</div></td>
                <td style={td()}>{c.funcao || '—'}</td>
                <td style={{ ...td(), textAlign: 'center' }}><input type="checkbox" checked={c.psico} onChange={e => toggle(c, 'psico', e.target.checked)} /></td>
                <td style={{ ...td(), textAlign: 'center' }}><input type="checkbox" checked={c.termica} onChange={e => toggle(c, 'termica', e.target.checked)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────── Apuração ───────────────────────────────────
function AbaApuracao({ companyId }: { companyId: string }) {
  const hoje = new Date()
  const [ini, setIni] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)))
  const [fim, setFim] = useState(iso(hoje))
  const [resumo, setResumo] = useState<Resumo[]>([])
  const [temReal, setTemReal] = useState(false)
  const [rodando, setRodando] = useState(false)
  const [carregado, setCarregado] = useState(false)

  const apurar = async () => {
    setRodando(true)
    try {
      await rpc('fn_nr36_apurar', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
      const r = await rpc<{ resumo: Resumo[]; tem_realizado: boolean }>('fn_nr36_apuracao_listar', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
      setResumo(r.resumo || []); setTemReal(r.tem_realizado); setCarregado(true)
    } catch (e) { alert((e as Error).message) } finally { setRodando(false) }
  }

  return (
    <div>
      {!temReal && carregado && <BannerAguardando />}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <Campo label="De"><input type="date" style={inp()} value={ini} onChange={e => setIni(e.target.value)} /></Campo>
        <Campo label="Até"><input type="date" style={inp()} value={fim} onChange={e => setFim(e.target.value)} /></Campo>
        <Btn onClick={apurar} disabled={rodando}><Play size={14} /> {rodando ? 'Apurando…' : 'Apurar período'}</Btn>
      </div>
      {!carregado ? <Vazio titulo="Apure um período" texto="Escolha o período e clique em Apurar. O sistema cruza a jornada (ind_ponto_dia) com as regras para calcular o devido por funcionário/dia." /> :
        resumo.length === 0 ? <Vazio titulo="Sem elegíveis no período" texto="Marque funcionários elegíveis na aba Elegíveis e verifique se há jornada no período." /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={th()}>Funcionário</th><th style={th()}>Pausa</th><th style={th()}>Dias</th><th style={th()}>Devido</th><th style={th()}>Realizado</th><th style={th()}>Situação</th>
            </tr></thead>
            <tbody>
              {resumo.map((r, i) => { const s = semColor[r.status] || semColor.aguardando_realizado; return (
                <tr key={r.colaborador_id + r.tipo + i} style={{ borderBottom: `1px solid ${C.beigeLt}` }}>
                  <td style={td()}><div style={{ fontWeight: 600, color: C.espresso }}>{r.nome}</div><div style={{ fontSize: 11, color: C.gray }}>{r.funcao || ''}</div></td>
                  <td style={td()}>{tipoLabel(r.tipo)}</td>
                  <td style={td()}>{r.dias}</td>
                  <td style={td()}>{r.devido_min} min</td>
                  <td style={td()}>{r.realizado_min == null ? <span style={{ color: C.blue }}>aguardando</span> : `${r.realizado_min} min`}</td>
                  <td style={td()}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: s.bg, color: s.c, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 700 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: s.c }} /> {s.l}</span></td>
                </tr>
              ) })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────── Prova ───────────────────────────────────
function AbaProva({ companyId }: { companyId: string }) {
  const hoje = new Date()
  const [colabs, setColabs] = useState<Colab[]>([])
  const [cpf, setCpf] = useState('')
  const [ini, setIni] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)))
  const [fim, setFim] = useState(iso(hoje))
  const [linhas, setLinhas] = useState<ProvaLinha[]>([])
  const [colabInfo, setColabInfo] = useState<Record<string, unknown> | null>(null)
  const [temReal, setTemReal] = useState(false)
  const [carregado, setCarregado] = useState(false)

  useEffect(() => { (async () => { try { const r = await rpc<{ colaboradores: Colab[] }>('fn_nr36_elegiveis_listar', { p_company_id: companyId }); setColabs((r.colaboradores || []).filter(c => c.psico || c.termica)) } catch { /* */ } })() }, [companyId])

  const gerar = async () => {
    if (!cpf) return
    try {
      const r = await rpc<{ linhas: ProvaLinha[]; colaborador: Record<string, unknown>; tem_realizado: boolean }>('fn_nr36_relatorio_prova', { p_company_id: companyId, p_cpf: cpf, p_dt_ini: ini, p_dt_fim: fim })
      setLinhas(r.linhas || []); setColabInfo(r.colaborador); setTemReal(r.tem_realizado); setCarregado(true)
    } catch (e) { alert((e as Error).message) }
  }

  return (
    <div>
      {!temReal && carregado && <BannerAguardando prova />}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <Campo label="Funcionário elegível"><select style={inp()} value={cpf} onChange={e => setCpf(e.target.value)}><option value="">Selecione…</option>{colabs.map(c => <option key={c.colaborador_id} value={c.cpf}>{c.nome}</option>)}</select></Campo>
        <Campo label="De"><input type="date" style={inp()} value={ini} onChange={e => setIni(e.target.value)} /></Campo>
        <Campo label="Até"><input type="date" style={inp()} value={fim} onChange={e => setFim(e.target.value)} /></Campo>
        <Btn onClick={gerar} disabled={!cpf}><FileText size={14} /> Gerar prova</Btn>
        {carregado && linhas.length > 0 && <BtnGhost onClick={() => window.print()}>Imprimir/PDF</BtnGhost>}
      </div>
      {!carregado ? <Vazio titulo="Relatório-prova" texto="Selecione um funcionário e o período. O relatório cronológico é a base documental da defesa trabalhista (a jurisprudência 2025 exige que a empresa comprove a concessão)." /> :
        linhas.length === 0 ? <Vazio titulo="Sem apuração no período" texto="Rode a Apuração do período antes de gerar a prova." /> : (
        <div>
          {colabInfo && <div style={{ ...card(), marginBottom: 10, display: 'block' }}><b style={{ color: C.espresso }}>{String(colabInfo.nome || '')}</b> <span style={{ color: C.gray, fontSize: 12 }}>· {String(colabInfo.funcao || '')} · matrícula {String(colabInfo.matricula || '—')} · CPF {String(colabInfo.cpf || '')}</span></div>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
                <th style={th()}>Data</th><th style={th()}>Pausa</th><th style={th()}>Jornada</th><th style={th()}>Devido</th><th style={th()}>Realizado</th><th style={th()}>Situação</th>
              </tr></thead>
              <tbody>
                {linhas.map((l, i) => { const s = semColor[l.status] || semColor.aguardando_realizado; return (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.beigeLt}` }}>
                    <td style={td()}>{fmtData(l.data)}</td><td style={td()}>{tipoLabel(l.tipo)}</td><td style={td()}>{hhmm(l.jornada_seg)}</td>
                    <td style={td()}>{l.devido_min} min</td><td style={td()}>{l.realizado_min == null ? <span style={{ color: C.blue }}>aguardando</span> : `${l.realizado_min} min`}</td>
                    <td style={td()}><span style={{ color: s.c, fontWeight: 700 }}>{s.l}</span></td>
                  </tr>
                ) })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function BannerAguardando({ prova }: { prova?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 10, background: C.blueBg, border: `1px solid ${C.blue}33`, borderRadius: 12, padding: 13, marginBottom: 14 }}>
      <AlertTriangle size={18} style={{ color: C.blue, flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontSize: 12.5, color: C.espresso }}>
        <b>Realizado indisponível — este painel mostra só o DEVIDO.</b> O coletor IOPoint ainda não puxa as pausas térmicas (endpoint pendente do Jian, Fase 2). {prova ? 'Esta prova documenta o DEVIDO; ' : ''}<b>NÃO comprova a concessão</b> enquanto o realizado não for integrado. Não use como prova de conformidade sem o realizado.
      </div>
    </div>
  )
}

// ─────────────────────────────────── UI helpers ───────────────────────────────────
function Wrap({ children }: { children: React.ReactNode }) { return <div style={{ background: C.offwhite, minHeight: '100vh', padding: '24px clamp(14px,4vw,36px)' }}><div style={{ maxWidth: 1100, margin: '0 auto' }}>{children}</div></div> }
function Header() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <span style={{ width: 42, height: 42, borderRadius: 12, background: '#F3E6C9', color: C.gold, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Snowflake size={22} /></span>
      <div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 23, fontWeight: 400, color: C.espresso, margin: 0 }}>Pausas Térmicas</h1>
        <div style={{ fontSize: 12, color: C.gray }}>NR-36 psicofisiológica + Art.253 CLT térmica · devido vs realizado + prova</div>
      </div>
    </div>
  )
}
function Vazio({ titulo, texto, acao }: { titulo: string; texto: string; acao?: React.ReactNode }) { return <div style={{ background: '#fff', border: `1px dashed ${C.borderLt}`, borderRadius: 14, padding: '32px 20px', textAlign: 'center' }}><div style={{ fontSize: 15, fontWeight: 600, color: C.espresso }}>{titulo}</div><div style={{ fontSize: 13, color: C.gray, marginTop: 5, maxWidth: 460, marginInline: 'auto' }}>{texto}</div>{acao && <div style={{ marginTop: 14 }}>{acao}</div>}</div> }
function Load() { return <div style={{ color: C.gray, padding: 30, textAlign: 'center', fontSize: 13 }}>Carregando…</div> }
function card(): React.CSSProperties { return { display: 'flex', gap: 12, alignItems: 'center', background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 12, padding: '12px 14px', marginBottom: 10 } }
function th(): React.CSSProperties { return { padding: '8px 10px', fontWeight: 600, fontSize: 12 } }
function td(): React.CSSProperties { return { padding: '9px 10px', verticalAlign: 'top' } }
function inp(): React.CSSProperties { return { border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: '8px 10px', fontSize: 13.5, color: C.ink, background: '#fff' } }
function erroBox(): React.CSSProperties { return { background: C.redBg, color: C.red, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, marginTop: 10 } }
function Campo({ label, children }: { label: string; children: React.ReactNode }) { return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><label style={{ fontSize: 12, color: C.gray }}>{label}</label>{children}</div> }
function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) { return <button onClick={onClick} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: disabled ? '#d9c9a6' : C.gold, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer' }}>{children}</button> }
function BtnGhost({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) { return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.borderLt}`, background: '#fff', color: C.espresso, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{children}</button> }
