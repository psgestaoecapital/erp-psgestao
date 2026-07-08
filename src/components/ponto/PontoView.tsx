'use client'

// PontoView — tela de ponto eletronico provider-agnostic (DIRETRIZ CEO 07/07,
// cristalizada em erp_contexto_projeto): dados de ponto em tabela UNICA
// (ind_ponto_colaborador / ind_ponto_horas / ind_ponto_provider_config —
// qualquer fornecedor: IO Point, Pontotel, Dominio), expostos em DUAS lentes:
//   - /dashboard/industrial/ponto  (lente='industrial')  · sync + operacao
//   - /dashboard/compliance/ponto  (lente='compliance')  · mesmos dados +
//     botao "Importar pro Compliance" (fn_compliance_projetar_de_ind_ponto)
// Mesma fonte, duas lentes, todo o historico. Gating por plan_modules.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { hhmmParaDecimal } from '@/lib/ponto/hhmm'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534'
const GREEN_BG = '#DCFCE7'
const RED = '#A32D2D'
const RED_BG = '#FCEBEB'

// Semaforo (mesma semantica de cor do componente SemaforoSaude · GE): verde/
// amarelo/vermelho SO aqui, nunca fora do semaforo (inviolavel de cores).
type Tom = 'verde' | 'amarelo' | 'vermelho'
const SEMAFORO: Record<Tom, { fg: string; bg: string; dot: string }> = {
  verde:    { fg: '#3B6D11', bg: '#EAF3DE', dot: '🟢' },
  amarelo:  { fg: '#854F0B', bg: '#FAEEDA', dot: '🟡' },
  vermelho: { fg: '#A32D2D', bg: '#FCEBEB', dot: '🔴' },
}
const h1 = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`

type Lente = 'industrial' | 'compliance'

type ProviderConfig = {
  id: string
  plant_id: string
  provider: string
  base_url: string
  vault_secret_name: string
  ativo: boolean
  nome_planta?: string
}

type Colaborador = {
  id: string
  cpf: string | null
  matricula: string | null
  nome: string | null
  email: string | null
  funcao: string | null
  departamento: string | null
  equipe: string | null
  admissao: string | null
  sincronizado_em: string | null
}

type HoraRow = {
  id: string
  cpf: string | null
  periodo_inicio: string | null
  periodo_fim: string | null
  total_horas: number | null
  funcao: string | null
  departamento: string | null
  sincronizado_em: string | null
  raw?: unknown // { linhas: [{ total_hours: {37 campos HH:MM} }] } — pro drill-down
}

// Retorno de fn_ponto_bi_agregado (Painel de Jornada · BI)
type BiTotais = {
  horas_trabalhadas: number; horas_extras: number; faltas: number
  noturno: number; banco: number; headcount: number; absenteismo_pct: number
}
type BiDepto = { departamento: string; trabalhadas: number; extras: number; faltas: number; absenteismo_pct: number; headcount: number }
type BiColab = { cpf: string | null; nome: string | null; departamento: string; trabalhadas: number; extras: number; faltas: number; noturno: number }
type BiResult = { totais: BiTotais; por_departamento: BiDepto[]; por_colaborador: BiColab[] }

const toISO = (d: Date) => d.toISOString().slice(0, 10)
const inicioMes = () => { const d = new Date(); return toISO(new Date(d.getFullYear(), d.getMonth(), 1)) }
const fmtD = (d: string | null) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') : '—')
const fmtDT = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR') : '—')

export default function PontoView({ lente }: { lente: Lente }) {
  const { selInfo, sel } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && sel ? sel : null

  const [config, setConfig] = useState<ProviderConfig | null>(null)
  const [vaultOk, setVaultOk] = useState(false)
  const [ultimaSync, setUltimaSync] = useState<string | null>(null)
  const [colabs, setColabs] = useState<Colaborador[]>([])
  const [horas, setHoras] = useState<HoraRow[]>([])
  const [aba, setAba] = useState<'colaboradores' | 'horas'>('colaboradores')
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [beginDate, setBeginDate] = useState(inicioMes())
  const [endDate, setEndDate] = useState(toISO(new Date()))
  const [sincronizando, setSincronizando] = useState(false)
  const [importando, setImportando] = useState(false)

  const carregar = useCallback(async () => {
    if (!empresaUnica) { setLoading(false); return }
    setLoading(true)
    setErro(null)
    const [cfgRes, credRes, syncRes, colabRes, horasRes] = await Promise.all([
      supabase
        .from('ind_ponto_provider_config')
        .select('id, plant_id, provider, base_url, vault_secret_name, ativo, industrial_plants:plant_id ( nome_planta )')
        .eq('company_id', empresaUnica)
        .eq('ativo', true)
        .maybeSingle(),
      supabase
        .from('erp_credencial')
        .select('id')
        .eq('escopo', 'empresa')
        .eq('company_id', empresaUnica)
        .eq('provider', 'iopoint')
        .eq('ativo', true)
        .limit(1),
      supabase
        .from('erp_banco_sync_log')
        .select('criado_em, status, qtd, mensagem')
        .eq('company_id', empresaUnica)
        .eq('tipo', 'ponto_sync')
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('ind_ponto_colaborador')
        .select('id, cpf, matricula, nome, email, funcao, departamento, equipe, admissao, sincronizado_em')
        .eq('company_id', empresaUnica)
        .order('nome')
        .limit(1000),
      supabase
        .from('ind_ponto_horas')
        .select('id, cpf, periodo_inicio, periodo_fim, total_horas, funcao, departamento, sincronizado_em, raw')
        .eq('company_id', empresaUnica)
        .order('periodo_inicio', { ascending: false })
        .limit(500),
    ])
    type CfgRow = ProviderConfig & { industrial_plants: { nome_planta: string | null } | { nome_planta: string | null }[] | null }
    const cfgRaw = cfgRes.data as CfgRow | null
    if (cfgRaw) {
      const ip = Array.isArray(cfgRaw.industrial_plants) ? cfgRaw.industrial_plants[0] : cfgRaw.industrial_plants
      setConfig({ ...cfgRaw, nome_planta: ip?.nome_planta ?? undefined })
    } else {
      setConfig(null)
    }
    setVaultOk(((credRes.data ?? []) as unknown[]).length > 0)
    const s = syncRes.data as { criado_em: string; status: string } | null
    setUltimaSync(s ? `${fmtDT(s.criado_em)} (${s.status})` : null)
    setColabs((colabRes.data ?? []) as Colaborador[])
    setHoras((horasRes.data ?? []) as HoraRow[])
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { void carregar() }, [carregar])

  async function sincronizar() {
    if (!empresaUnica || !config) return
    setSincronizando(true)
    setErro(null); setOk(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setErro('Sessão expirada. Faça login de novo.'); return }
      const params = new URLSearchParams({
        company_id: empresaUnica,
        plant_id: config.plant_id,
        begin_date: beginDate,
        end_date: endDate,
      })
      const r = await fetch(`/api/industrial/ponto/sync?${params.toString()}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErro(j.erro || j.detalhe || `HTTP ${r.status}`); return }
      // FIX-PONTO-SYNC-TIMEOUT: horas pode falhar (endpoint lento) sem derrubar
      // os colaboradores. Mostra sucesso + aviso ambar quando so as horas faltaram.
      if (j.horas_aviso) {
        setOk(`SINCRONIZOU · ${j.colaboradores} colaboradores (${j.provider}). ⚠️ ${j.horas_aviso}`)
      } else {
        setOk(`SINCRONIZOU · ${j.colaboradores} colaboradores e ${j.horas_registros ?? 0} registros de horas (${j.provider}).`)
      }
      await carregar()
    } catch (e) {
      setErro((e as Error).message || 'erro de rede')
    } finally {
      setSincronizando(false)
    }
  }

  async function importarCompliance() {
    if (!empresaUnica) return
    if (!window.confirm('Importar colaboradores do ponto pra ficha do Compliance?\n\nCampos já preenchidos à mão (RG, endereço, salário, ASO…) NÃO serão sobrescritos — só completa o que está vazio.')) return
    setImportando(true)
    setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('fn_compliance_projetar_de_ind_ponto', { p_company_id: empresaUnica })
    setImportando(false)
    if (error) { setErro('Erro na importação: ' + error.message); return }
    const j = data as { criados?: number; atualizados?: number; ignorados_sem_cpf?: number; total_processados?: number } | null
    setOk(`IMPORTOU ${j?.total_processados ?? 0} colaboradores pro Compliance · ${j?.criados ?? 0} novos · ${j?.atualizados ?? 0} atualizados${j?.ignorados_sem_cpf ? ` · ${j.ignorados_sem_cpf} sem CPF (ignorados)` : ''}`)
  }

  const colabsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return colabs
    return colabs.filter((c) =>
      (c.nome ?? '').toLowerCase().includes(q) ||
      (c.matricula ?? '').toLowerCase().includes(q) ||
      (c.funcao ?? '').toLowerCase().includes(q) ||
      (c.departamento ?? '').toLowerCase().includes(q) ||
      (c.cpf ?? '').includes(q)
    )
  }, [colabs, busca])

  // cpf -> nome: a aba horas mostra NOME (nunca CPF · P1 LGPD dado RH sensivel)
  const nomePorCpf = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of colabs) if (c.cpf) m.set(c.cpf, c.nome ?? '—')
    return m
  }, [colabs])

  const rotuloArea = lente === 'industrial' ? 'Industrial · RH / Ponto' : 'Compliance · SST'

  // ── Gates ──────────────────────────────────────────────────────────
  if (!empresaUnica) {
    return (
      <Casca rotulo={rotuloArea}>
        <EmptyBox titulo="Selecione uma empresa" texto="Ponto eletrônico é operacional por empresa. Escolha uma empresa específica no menu superior (sem modo consolidado/grupo)." />
      </Casca>
    )
  }

  return (
    <Casca rotulo={rotuloArea}>
      {/* Header provider + sync */}
      <section style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: 18, marginBottom: 14 }}>
        {loading ? (
          <div style={{ fontSize: 13, color: MUT }}>Carregando…</div>
        ) : !config ? (
          <EmptyBox
            titulo="Nenhum provider de ponto conectado"
            texto="Conecte um fornecedor de ponto eletrônico (IO Point, Pontotel, Domínio) pra esta empresa."
            cta={{ label: 'Ir pra Central de Conectores →', href: '/dashboard/conectores' }}
          />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: ESP, textTransform: 'capitalize' }}>{config.provider}</span>
              {config.nome_planta && <span style={{ fontSize: 12, color: MUT }}>· {config.nome_planta}</span>}
              {vaultOk && (
                <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, background: GREEN_BG, color: GREEN, fontWeight: 700, letterSpacing: 0.5 }}>
                  🔒 VAULT OK
                </span>
              )}
              <span style={{ fontSize: 11, color: MUT, marginLeft: 'auto' }}>
                Última sync: <b style={{ color: ultimaSync ? ESP : RED }}>{ultimaSync ?? 'Nunca'}</b>
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={lbl}>Início do período</label>
                <input type="date" value={beginDate} onChange={(e) => setBeginDate(e.target.value)} style={inp} />
              </div>
              <div>
                <label style={lbl}>Fim do período</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inp} />
              </div>
              <button
                type="button"
                onClick={sincronizar}
                disabled={sincronizando}
                style={{ ...btnGold, opacity: sincronizando ? 0.6 : 1, cursor: sincronizando ? 'not-allowed' : 'pointer' }}
              >
                {sincronizando ? 'Sincronizando…' : '⟳ Sincronizar'}
              </button>
              {lente === 'compliance' && (
                <button
                  type="button"
                  onClick={importarCompliance}
                  disabled={importando || colabs.length === 0}
                  title={colabs.length === 0 ? 'Sincronize primeiro pra ter colaboradores' : 'Projeta em compliance_funcionarios preservando dados manuais'}
                  style={{ ...btnOutlineGold, opacity: importando || colabs.length === 0 ? 0.5 : 1, cursor: importando || colabs.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                  {importando ? 'Importando…' : `⬇ Importar pro Compliance (${colabs.length})`}
                </button>
              )}
            </div>
            <p style={{ fontSize: 10, color: MUT, margin: '8px 0 0' }}>Período máximo: 31 dias (limite da API do provider).</p>
          </>
        )}
      </section>

      {erro && <div style={{ background: RED_BG, color: RED, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{erro}</div>}
      {ok && <div style={{ background: GREEN_BG, color: GREEN, padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600 }}>✓ {ok}</div>}

      {/* Painel de Jornada (BI) — so na lente industrial; Compliance mantem visao SST enxuta */}
      {lente === 'industrial' && !loading && config && (
        <PainelJornada companyId={empresaUnica} dataIni={beginDate} dataFim={endDate} colabs={colabs} horas={horas} />
      )}

      {/* Abas */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setAba('colaboradores')} style={aba === 'colaboradores' ? tabOn : tabOff}>
          👥 Colaboradores ({colabs.length})
        </button>
        <button onClick={() => setAba('horas')} style={aba === 'horas' ? tabOn : tabOff}>
          🕐 Histórico de horas ({horas.length})
        </button>
      </div>

      {aba === 'colaboradores' ? (
        <section style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: `0.5px solid ${LINE}` }}>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, matrícula, função, departamento…"
              style={{ ...inp, width: '100%' }}
            />
          </div>
          {colabs.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: MUT }}>
              Nenhum colaborador sincronizado ainda. Clique em <b>⟳ Sincronizar</b> acima pra puxar do provider.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                <thead style={{ background: BG }}>
                  <tr>
                    <Th>Nome</Th><Th>Matrícula</Th><Th>Função</Th><Th>Departamento</Th><Th>Admissão</Th><Th>Sync</Th>
                  </tr>
                </thead>
                <tbody>
                  {colabsFiltrados.map((c) => (
                    <tr key={c.id} style={{ borderTop: `0.5px solid ${LINE}` }}>
                      <Td><b>{c.nome ?? '—'}</b>{c.email && <div style={{ fontSize: 10, color: MUT }}>{c.email}</div>}</Td>
                      <Td>{c.matricula ?? '—'}</Td>
                      <Td>{c.funcao ?? '—'}</Td>
                      <Td>{c.departamento ?? '—'}{c.equipe ? ` · ${c.equipe}` : ''}</Td>
                      <Td>{fmtD(c.admissao)}</Td>
                      <Td><span style={{ fontSize: 10, color: MUT }}>{fmtDT(c.sincronizado_em)}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
          {horas.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: MUT }}>
              Nenhum registro de horas ainda. A sincronização traz o histórico do período escolhido.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 680 }}>
                <thead style={{ background: BG }}>
                  <tr>
                    <Th>Colaborador</Th><Th>Período</Th><Th>Total horas</Th><Th>Função</Th><Th>Departamento</Th><Th>Sync</Th>
                  </tr>
                </thead>
                <tbody>
                  {horas.map((h) => (
                    <tr key={h.id} style={{ borderTop: `0.5px solid ${LINE}` }}>
                      <Td><b>{(h.cpf && nomePorCpf.get(h.cpf)) || '—'}</b></Td>
                      <Td>{fmtD(h.periodo_inicio)} → {fmtD(h.periodo_fim)}</Td>
                      <Td><b style={{ color: GOLD }}>{Number(h.total_horas ?? 0).toFixed(2)}h</b></Td>
                      <Td>{h.funcao ?? '—'}</Td>
                      <Td>{h.departamento ?? '—'}</Td>
                      <Td><span style={{ fontSize: 10, color: MUT }}>{fmtDT(h.sincronizado_em)}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </Casca>
  )
}

// ── Peças visuais ────────────────────────────────────────────────────

function Casca({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GOLD, margin: 0 }}>{rotulo}</p>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: ESP, margin: '4px 0 4px' }}>Ponto Eletrônico</h1>
        <p style={{ fontSize: 12, color: MUT, margin: '0 0 18px' }}>
          Colaboradores e horas do provider de ponto (IO Point, Pontotel, Domínio) — mesma fonte pra Industrial e Compliance.
        </p>
        {children}
      </div>
    </div>
  )
}

function EmptyBox({ titulo, texto, cta }: { titulo: string; texto: string; cta?: { label: string; href: string } }) {
  return (
    <div style={{ padding: '28px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: ESP, marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 13, color: MUT, maxWidth: 460, margin: '0 auto' }}>{texto}</div>
      {cta && (
        <Link href={cta.href} style={{ display: 'inline-block', marginTop: 14, padding: '10px 18px', borderRadius: 8, background: GOLD, color: '#FFF', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
          {cta.label}
        </Link>
      )}
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT }}>{children}</th>
}
function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '10px 14px', verticalAlign: 'middle', color: ESP, ...style }}>{children}</td>
}

const lbl: React.CSSProperties = { display: 'block', fontSize: 10, color: MUT, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }
const inp: React.CSSProperties = { padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }
const btnGold: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, border: 'none', background: GOLD, color: '#FFF', fontSize: 13, fontWeight: 700, minHeight: 40 }
const btnOutlineGold: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, border: `1px solid ${GOLD}`, background: 'transparent', color: GOLD, fontSize: 13, fontWeight: 700, minHeight: 40 }
const tabOn: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: `1px solid ${GOLD}`, background: 'rgba(200,148,26,0.10)', color: '#A57A15', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const tabOff: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#FFF', color: MUT, fontSize: 12, fontWeight: 600, cursor: 'pointer' }

// ── Painel de Jornada (BI de ponto · SO lente industrial) ────────────────
// Os 37 campos de total_hours (rotulos em pt-BR, sem jargao) pro drill-down.
const CAMPOS_37: { key: string; label: string }[] = [
  { key: 'worked_time', label: 'Horas trabalhadas' },
  { key: 'worked_actual_time', label: 'Trabalhadas (efetivas)' },
  { key: 'over_time_1', label: 'Hora extra · faixa 1' },
  { key: 'over_time_2', label: 'Hora extra · faixa 2' },
  { key: 'over_time_3', label: 'Hora extra · faixa 3' },
  { key: 'over_time_4', label: 'Hora extra · faixa 4' },
  { key: 'over_time_1_day', label: 'Extra 1 · diurna' },
  { key: 'over_time_1_night', label: 'Extra 1 · noturna' },
  { key: 'over_time_1_night_reduced', label: 'Extra 1 · noturna reduzida' },
  { key: 'over_time_2_day', label: 'Extra 2 · diurna' },
  { key: 'over_time_2_night', label: 'Extra 2 · noturna' },
  { key: 'over_time_2_night_reduced', label: 'Extra 2 · noturna reduzida' },
  { key: 'over_time_3_day', label: 'Extra 3 · diurna' },
  { key: 'over_time_3_night', label: 'Extra 3 · noturna' },
  { key: 'over_time_3_night_reduced', label: 'Extra 3 · noturna reduzida' },
  { key: 'over_time_4_day', label: 'Extra 4 · diurna' },
  { key: 'over_time_4_night', label: 'Extra 4 · noturna' },
  { key: 'over_time_4_night_reduced', label: 'Extra 4 · noturna reduzida' },
  { key: 'over_time_dsr', label: 'Extra em DSR' },
  { key: 'over_time_dsr_day', label: 'Extra DSR · diurna' },
  { key: 'over_time_dsr_night', label: 'Extra DSR · noturna' },
  { key: 'over_time_dsr_night_reduced', label: 'Extra DSR · noturna reduzida' },
  { key: 'over_time_holiday', label: 'Extra em feriado' },
  { key: 'over_time_holiday_day', label: 'Extra feriado · diurna' },
  { key: 'over_time_holiday_night', label: 'Extra feriado · noturna' },
  { key: 'over_time_holiday_night_reduced', label: 'Extra feriado · noturna reduzida' },
  { key: 'fault_full_time', label: 'Falta integral' },
  { key: 'fault_partial_time', label: 'Falta parcial' },
  { key: 'justified_time', label: 'Falta justificada' },
  { key: 'justified_not_paid_time', label: 'Justificada não paga' },
  { key: 'medical_certificate_time', label: 'Atestado médico' },
  { key: 'night_time', label: 'Adicional noturno' },
  { key: 'night_time_reduced', label: 'Adicional noturno reduzido' },
  { key: 'bank_time', label: 'Banco de horas' },
  { key: 'bank_time_factored', label: 'Banco de horas (fatorado)' },
  { key: 'interjourney', label: 'Interjornada' },
  { key: 'intrajourney', label: 'Intrajornada' },
]

const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

type SortKey = 'trabalhadas' | 'extras' | 'faltas' | 'noturno'
type DrillState = { nome: string; departamento: string; campos: { label: string; valor: number }[] }

function PainelJornada({ companyId, dataIni, dataFim, colabs, horas }: {
  companyId: string | null; dataIni: string; dataFim: string; colabs: Colaborador[]; horas: HoraRow[]
}) {
  const [bi, setBi] = useState<BiResult | null>(null)
  const [loadingBi, setLoadingBi] = useState(true)
  const [erroBi, setErroBi] = useState<string | null>(null)
  const [depto, setDepto] = useState('')
  const [buscaColab, setBuscaColab] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('extras')
  const [drill, setDrill] = useState<DrillState | null>(null)

  const departamentos = useMemo(() => {
    const s = new Set<string>()
    for (const c of colabs) { const d = (c.departamento ?? '').trim(); if (d) s.add(d) }
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [colabs])

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    const run = async () => {
      setLoadingBi(true); setErroBi(null)
      const { data, error } = await supabase
        .rpc('fn_ponto_bi_agregado', { p_company_id: companyId, p_data_ini: dataIni, p_data_fim: dataFim, p_departamento: depto || null })
      if (ignore) return
      if (error) { setErroBi(error.message); setBi(null) }
      else setBi(data as BiResult)
      setLoadingBi(false)
    }
    void run()
    return () => { ignore = true }
  }, [companyId, dataIni, dataFim, depto])

  const totais = bi?.totais
  const pctExtras = totais && totais.horas_trabalhadas > 0 ? (totais.horas_extras / totais.horas_trabalhadas) * 100 : 0

  const ranking = useMemo(() => {
    const arr = [...(bi?.por_colaborador ?? [])]
    const q = buscaColab.trim().toLowerCase()
    const filt = q ? arr.filter((c) => (c.nome ?? '').toLowerCase().includes(q) || c.departamento.toLowerCase().includes(q)) : arr
    return filt.sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0))
  }, [bi, buscaColab, sortKey])

  const barras = useMemo(() => (bi?.por_departamento ?? []).slice(0, 12).map((d) => ({ nome: d.departamento, extras: d.extras })), [bi])

  function abrirDrill(colab: BiColab) {
    const soma = new Map<string, number>()
    for (const h of horas.filter((x) => x.cpf === colab.cpf)) {
      const rawObj = asObj(h.raw)
      const linhas = rawObj && Array.isArray(rawObj.linhas) ? (rawObj.linhas as unknown[]) : (rawObj ? [rawObj] : [])
      for (const l of linhas) {
        const th = asObj(asObj(l)?.total_hours)
        if (!th) continue
        for (const c of CAMPOS_37) soma.set(c.key, (soma.get(c.key) ?? 0) + hhmmParaDecimal(th[c.key]))
      }
    }
    setDrill({ nome: colab.nome ?? '—', departamento: colab.departamento, campos: CAMPOS_37.map((c) => ({ label: c.label, valor: soma.get(c.key) ?? 0 })) })
  }

  const tomExtras: Tom = pctExtras > 12 ? 'vermelho' : pctExtras > 8 ? 'amarelo' : 'verde'
  const tomAbsent: Tom = !totais ? 'verde' : totais.absenteismo_pct > 15 ? 'vermelho' : totais.absenteismo_pct > 10 ? 'amarelo' : 'verde'

  return (
    <section style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: ESP }}>📊 Painel de Jornada</span>
        <span style={{ fontSize: 11, color: MUT }}>horas extras, faltas e absenteísmo por setor · {fmtD(dataIni)} → {fmtD(dataFim)}</span>
      </div>

      {/* Filtros (topo · mobile-first) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={depto} onChange={(e) => setDepto(e.target.value)} style={{ ...inp, minWidth: 180 }}>
          <option value="">Todos os setores ({departamentos.length})</option>
          {departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input value={buscaColab} onChange={(e) => setBuscaColab(e.target.value)} placeholder="Buscar colaborador…" style={{ ...inp, flex: 1, minWidth: 160 }} />
      </div>

      {erroBi ? (
        <div style={{ background: RED_BG, color: RED, padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>Não foi possível carregar o painel: {erroBi}</div>
      ) : loadingBi ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: MUT }}>Carregando painel…</div>
      ) : !totais || totais.headcount === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: MUT }}>
          Nenhuma hora no período/setor selecionado. Ajuste o período acima e clique em <b>⟳ Sincronizar</b> se ainda não sincronizou.
        </div>
      ) : (
        <>
          {/* 4 cartoes com semaforo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            <KpiSemaforo tom="verde" titulo="Horas trabalhadas" valor={h1(totais.horas_trabalhadas)} contexto={`${totais.headcount} colaboradores no período`} />
            <KpiSemaforo tom={tomExtras} titulo="Horas extras" valor={h1(totais.horas_extras)} contexto={`${pctExtras.toFixed(1)}% sobre as trabalhadas`} />
            <KpiSemaforo tom={tomAbsent} titulo="Absenteísmo" valor={`${totais.absenteismo_pct.toFixed(1)}%`} contexto={`${h1(totais.faltas)} de faltas no período`} />
            <KpiSemaforo tom="verde" titulo="Noturno + Banco" valor={h1(totais.noturno + totais.banco)} contexto={`${h1(totais.noturno)} noturno · ${h1(totais.banco)} banco`} />
          </div>

          {/* Barras: HE por setor (maior -> menor, top 12) */}
          {barras.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, marginBottom: 6 }}>
                Horas extras por setor {barras.length === 12 ? '(top 12)' : ''}
              </div>
              <ResponsiveContainer width="100%" height={Math.max(140, barras.length * 30)}>
                <BarChart data={barras} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: MUT }} />
                  <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 10, fill: ESP }} />
                  <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}h`, 'Horas extras'] as [string, string]} />
                  <Bar dataKey="extras" radius={[0, 4, 4, 0]}>
                    {barras.map((_, i) => <Cell key={i} fill={GOLD} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Ranking por colaborador (ordenavel · HE em destaque) */}
          <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
              <thead style={{ background: BG }}>
                <tr>
                  <Th>#</Th><Th>Colaborador</Th><Th>Setor</Th>
                  <ThSort ativo={sortKey === 'trabalhadas'} onClick={() => setSortKey('trabalhadas')}>Trabalhadas</ThSort>
                  <ThSort ativo={sortKey === 'extras'} onClick={() => setSortKey('extras')}>Extras</ThSort>
                  <ThSort ativo={sortKey === 'faltas'} onClick={() => setSortKey('faltas')}>Faltas</ThSort>
                  <ThSort ativo={sortKey === 'noturno'} onClick={() => setSortKey('noturno')}>Noturno</ThSort>
                </tr>
              </thead>
              <tbody>
                {ranking.map((c, i) => (
                  <tr key={c.cpf ?? i} onClick={() => abrirDrill(c)} style={{ borderTop: `0.5px solid ${LINE}`, cursor: 'pointer' }}>
                    <Td style={{ color: MUT, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</Td>
                    <Td><b>{c.nome ?? '—'}</b></Td>
                    <Td style={{ fontSize: 12, color: MUT }}>{c.departamento}</Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums' }}>{h1(c.trabalhadas)}</Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: c.extras > 0 ? GOLD : MUT }}>{h1(c.extras)}</Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums' }}>{h1(c.faltas)}</Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums' }}>{h1(c.noturno)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 10, color: MUT, margin: '6px 2px 0' }}>Toque num colaborador pra abrir os 37 campos da jornada dele.</p>
        </>
      )}

      {drill && <DrillJornada drill={drill} onClose={() => setDrill(null)} />}
    </section>
  )
}

function KpiSemaforo({ tom, titulo, valor, contexto }: { tom: Tom; titulo: string; valor: string; contexto: string }) {
  const s = SEMAFORO[tom]
  return (
    <div style={{ background: s.bg, borderRadius: 10, padding: '12px 14px', border: `0.5px solid ${LINE}` }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 9 }}>{s.dot}</span> {titulo}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: s.fg, fontVariantNumeric: 'tabular-nums', margin: '2px 0' }}>{valor}</div>
      <div style={{ fontSize: 11, color: MUT }}>{contexto}</div>
    </div>
  )
}

function ThSort({ children, ativo, onClick }: { children: React.ReactNode; ativo: boolean; onClick: () => void }) {
  return (
    <th onClick={onClick} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: ativo ? GOLD : MUT, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {children} {ativo ? '↓' : ''}
    </th>
  )
}

function DrillJornada({ drill, onClose }: { drill: DrillState; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.35)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 92vw)', height: '100%', background: '#FFF', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: ESP }}>{drill.nome}</div>
            <div style={{ fontSize: 12, color: MUT }}>{drill.departamento} · jornada detalhada</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 6, padding: '4px 10px', fontSize: 16, color: MUT, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ marginTop: 14 }}>
          {drill.campos.map((c) => (
            <div key={c.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderTop: `0.5px solid ${LINE}` }}>
              <span style={{ fontSize: 12.5, color: c.valor > 0 ? ESP : MUT }}>{c.label}</span>
              <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', fontWeight: c.valor > 0 ? 700 : 400, color: c.valor > 0 ? ESP : 'rgba(61,35,20,0.35)' }}>{h1(c.valor)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
