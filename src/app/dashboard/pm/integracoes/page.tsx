'use client'
// INTEGRAÇÕES PRODUTIVIDADE (P&M). Sobre agency_integracao. Escopo por company_id (RD-45).
// Central de conexões própria: a empresa registra quais ferramentas de produtividade estão conectadas
// (arquivos, redes, avisos, agenda, quadros), com estado real por empresa — o sistema vira o hub central.
// RD-98: CRUD completo (conectar/reconfigurar/desconectar) + desconexão rastreável (soft-delete + audit_log_global via RPC).
// O handshake OAuth/segredos do provedor é etapa posterior; aqui gerencia-se o cadastro da conexão (não guarda segredo).
// Tema Espresso (RD-99). "?" RD-95 em todo campo/filtro/indicador/ação. Code: code-desenvolvedor-3
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/integracoes'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const AMBER = '#8A5A00'

// Catálogo de ferramentas de produtividade que a empresa pode conectar.
// Nomes de PROVEDORES de integração (não sistemas concorrentes) — RD-100 não se aplica.
type ProvCat = { slug: string; nome: string; descricao: string; icone: string; exemplo: string }
const CATALOGO: ProvCat[] = [
  { slug: 'drive', nome: 'Arquivos na nuvem', icone: '📁', descricao: 'Os arquivos de cada job acessíveis dentro do sistema.', exemplo: 'arquivos@suaempresa.com' },
  { slug: 'redes', nome: 'Redes sociais', icone: '📣', descricao: 'Publicar a arte aprovada e puxar as métricas de volta ao Health Score.', exemplo: '@seuperfil' },
  { slug: 'avisos', nome: 'Avisos da equipe', icone: '🔔', descricao: 'Notificações no canal onde a equipe já conversa.', exemplo: 'canal #producao' },
  { slug: 'agenda', nome: 'Agenda', icone: '📅', descricao: 'Prazos e gravações sincronizados com a agenda.', exemplo: 'equipe@suaempresa.com' },
  { slug: 'quadros', nome: 'Quadros de tarefas', icone: '🗂️', descricao: 'Migrar quem já organiza o trabalho em quadros de tarefas.', exemplo: 'espaço da agência' },
]
const provCat = (slug: string): ProvCat => CATALOGO.find((p) => p.slug === slug) ?? { slug, nome: slug, descricao: '', icone: '🔌', exemplo: '' }

const STATUS_CFG: Record<string, { l: string; cor: string; txt: string }> = {
  conectado: { l: 'Conectado', cor: '#DCEFD7', txt: GREEN },
  pausado: { l: 'Pausado', cor: '#FCE9C2', txt: AMBER },
  disponivel: { l: 'Disponível', cor: OFFWHITE, txt: TEXTM },
}

type Conexao = {
  id: string; provedor: string; conta_ref: string | null; status: string;
  observacoes: string | null; conectado_em: string; atualizado_em: string
}
type FormState = { id: string | null; provedor: string; conta_ref: string; status: string; observacoes: string }
const FORM_VAZIO: FormState = { id: null, provedor: '', conta_ref: '', status: 'conectado', observacoes: '' }

type LinhaCat = ProvCat & { conexao: Conexao | null; estado: 'conectado' | 'pausado' | 'disponivel' }

export default function IntegracoesPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [lista, setLista] = useState<Conexao[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [fEstado, setFEstado] = useState('')

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const r = await supabase.rpc('fn_agency_integracao_listar', { p_company_id: empresa })
    setLista((r.data ?? []) as Conexao[])
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  // Cada ferramenta do catálogo cruzada com a conexão ativa da empresa (se houver)
  const linhas: LinhaCat[] = useMemo(() => CATALOGO.map((p) => {
    const conexao = lista.find((c) => c.provedor === p.slug) ?? null
    const estado = conexao ? (conexao.status === 'pausado' ? 'pausado' : 'conectado') : 'disponivel'
    return { ...p, conexao, estado }
  }), [lista])

  const filtradas = useMemo(() => linhas.filter((l) => !fEstado || l.estado === fEstado), [linhas, fEstado])

  const kpis = useMemo(() => ({
    conectadas: linhas.filter((l) => l.estado === 'conectado').length,
    pausadas: linhas.filter((l) => l.estado === 'pausado').length,
    disponiveis: linhas.filter((l) => l.estado === 'disponivel').length,
  }), [linhas])

  function abrirConectar(l: LinhaCat) { setForm({ ...FORM_VAZIO, provedor: l.slug }) }
  function abrirReconfigurar(l: LinhaCat) {
    if (!l.conexao) return
    setForm({ id: l.conexao.id, provedor: l.slug, conta_ref: l.conexao.conta_ref ?? '', status: l.conexao.status, observacoes: l.conexao.observacoes ?? '' })
  }
  async function salvar() {
    if (!empresa || !form) return
    setBusy(true)
    const payload = { provedor: form.provedor, conta_ref: form.conta_ref, status: form.status, observacoes: form.observacoes }
    const { data, error } = await supabase.rpc('fn_agency_integracao_conectar', { p_company_id: empresa, p_payload: payload })
    setBusy(false)
    const j = data as { id?: string } | null
    if (error || !j?.id) { setToast(`Erro: ${error?.message ?? 'não foi possível salvar'}`); return }
    setForm(null); setToast(form.id ? 'Conexão atualizada.' : 'Ferramenta conectada.'); void carregar()
  }
  async function desconectar(l: LinhaCat) {
    if (!l.conexao) return
    const motivo = prompt(`Desconectar "${l.nome}"? Informe o motivo (fica registrado na auditoria):`)
    if (motivo === null) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_integracao_desconectar', { p_id: l.conexao.id, p_motivo: motivo || null })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Ferramenta desconectada (registrado na auditoria).'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  const provForm = form ? provCat(form.provedor) : null

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🔌 P&amp;M · Hub de conexões</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Integrações Produtividade<AjudaCampo chave="pm.integracoes.tela" rota={ROTA} /></h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Você não troca suas ferramentas — conecta. O sistema vira o maestro do que a equipe já usa, num lugar só.</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Conexões ativas" v={String(kpis.conectadas)} cor={GREEN} chave="pm.integracoes.kpi_conectadas" />
          <Kpi l="Pausadas" v={String(kpis.pausadas)} cor={AMBER} chave="pm.integracoes.kpi_pausadas" />
          <Kpi l="Disponíveis" v={String(kpis.disponiveis)} chave="pm.integracoes.kpi_disponiveis" />
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ ...lbl, flex: '1 1 200px', maxWidth: 260 }}>
            <span style={lblSpan}>Estado<AjudaCampo chave="pm.integracoes.filtro_estado" rota={ROTA} /></span>
            <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={inp} data-testid="integ-filtro-estado">
              <option value="">Todas as ferramentas</option>
              <option value="conectado">Conectadas</option>
              <option value="pausado">Pausadas</option>
              <option value="disponivel">Disponíveis para conectar</option>
            </select>
          </label>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : filtradas.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nenhuma ferramenta com esse filtro.</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: 12 }}>
              {filtradas.map((l) => {
                const cfg = STATUS_CFG[l.estado]
                return (
                  <div key={l.slug} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid={`integ-card-${l.slug}`}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 24 }}>{l.icone}</span>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{l.nome}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, background: cfg.cor, color: cfg.txt, padding: '2px 8px', borderRadius: 999 }}>{cfg.l}</span>
                    </div>
                    <p style={{ fontSize: 12.5, color: TEXTM, margin: 0, minHeight: 34 }}>{l.descricao}</p>
                    {l.conexao?.conta_ref && <div style={{ fontSize: 12, color: ESPRESSO }}>Conta: <strong>{l.conexao.conta_ref}</strong></div>}
                    {l.conexao?.observacoes && <div style={{ fontSize: 11.5, color: TEXTM, fontStyle: 'italic' }}>{l.conexao.observacoes}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 6 }}>
                      {l.estado === 'disponivel' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => abrirConectar(l)} style={btnPri} data-testid={`integ-conectar-${l.slug}`}>Conectar</button><AjudaCampo chave="pm.integracoes.conectar" rota={ROTA} /></span>
                      ) : (
                        <>
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => abrirReconfigurar(l)} style={btnGhost} data-testid={`integ-reconfigurar-${l.slug}`}>Reconfigurar</button><AjudaCampo chave="pm.integracoes.reconfigurar" rota={ROTA} /></span>
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}><button disabled={busy} onClick={() => desconectar(l)} style={btnDel} data-testid={`integ-desconectar-${l.slug}`}>Desconectar</button><AjudaCampo chave="pm.integracoes.desconectar" rota={ROTA} /></span>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        <p style={{ fontSize: 11, color: TEXTM, marginTop: 14, fontStyle: 'italic' }}>
          Marque quais ferramentas estão conectadas à sua empresa e acompanhe o estado de cada uma. Desconectar é
          rastreável — fica registrado quem desconectou e quando. O acesso a cada ferramenta é configurado com a conta
          de referência que você informar.
        </p>
      </div>

      {form && provForm && (
        <div role="dialog" aria-modal="true" style={modalWrap} onClick={() => !busy && setForm(null)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()} data-testid="integ-form">
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{form.id ? 'Reconfigurar' : 'Conectar'} · {provForm.icone} {provForm.nome}</h2>
            <p style={{ fontSize: 12.5, color: TEXTM, margin: '0 0 12px' }}>{provForm.descricao}</p>
            <label style={lbl}>
              <span style={lblSpan}>Ferramenta<AjudaCampo chave="pm.integracoes.provedor" rota={ROTA} /></span>
              <input value={provForm.nome} disabled style={{ ...inp, background: OFFWHITE }} data-testid="integ-f-provedor" />
            </label>
            <label style={lbl}>
              <span style={lblSpan}>Conta de referência<AjudaCampo chave="pm.integracoes.conta_ref" rota={ROTA} /></span>
              <input value={form.conta_ref} onChange={(e) => setForm({ ...form, conta_ref: e.target.value })} style={inp} data-testid="integ-f-conta" placeholder={`Ex.: ${provForm.exemplo}`} />
            </label>
            <label style={lbl}>
              <span style={lblSpan}>Estado<AjudaCampo chave="pm.integracoes.status" rota={ROTA} /></span>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inp} data-testid="integ-f-status">
                <option value="conectado">Conectado (em uso)</option>
                <option value="pausado">Pausado (configurado, parado)</option>
              </select>
            </label>
            <label style={lbl}>
              <span style={lblSpan}>Observações<AjudaCampo chave="pm.integracoes.observacoes" rota={ROTA} /></span>
              <textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} style={{ ...inp, minHeight: 60 }} data-testid="integ-f-obs" placeholder="Ex.: Responsável: Marketing. Alimenta o calendário de posts." />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button disabled={busy} onClick={() => setForm(null)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={salvar} style={btnPri} data-testid="integ-f-salvar">{form.id ? 'Salvar' : 'Conectar'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Kpi({ l, v, cor, chave }: { l: string; v: string; cor?: string; chave?: string }) {
  return <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}{chave && <AjudaCampo chave={chave} rota={ROTA} />}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
const lbl: CSSProperties = { display: 'block', marginBottom: 10 }
const lblSpan: CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXTM, display: 'inline-flex', alignItems: 'center' }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '9px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 40 }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const btnDel: CSSProperties = { border: `1px solid #7A1F1F`, color: '#7A1F1F', background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 36 }
const inp: CSSProperties = { width: '100%', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '9px 10px', fontSize: 14, marginTop: 4, boxSizing: 'border-box', minHeight: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
const modalWrap: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 70 }
const modalBox: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }
