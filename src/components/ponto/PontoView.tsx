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
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const GREEN = '#166534'
const GREEN_BG = '#DCFCE7'
const RED = '#A32D2D'
const RED_BG = '#FCEBEB'

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
}

const toISO = (d: Date) => d.toISOString().slice(0, 10)
const inicioMes = () => { const d = new Date(); return toISO(new Date(d.getFullYear(), d.getMonth(), 1)) }
const fmtD = (d: string | null) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') : '—')
const fmtDT = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR') : '—')

export default function PontoView({ lente }: { lente: Lente }) {
  const { companyIds, selInfo, sel } = useCompanyIds()
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
        .select('id, cpf, periodo_inicio, periodo_fim, total_horas, funcao, departamento, sincronizado_em')
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
                    <Th>CPF</Th><Th>Período</Th><Th>Total horas</Th><Th>Função</Th><Th>Departamento</Th><Th>Sync</Th>
                  </tr>
                </thead>
                <tbody>
                  {horas.map((h) => (
                    <tr key={h.id} style={{ borderTop: `0.5px solid ${LINE}` }}>
                      <Td style={{ fontFamily: 'monospace', fontSize: 12 }}>{h.cpf ?? '—'}</Td>
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
