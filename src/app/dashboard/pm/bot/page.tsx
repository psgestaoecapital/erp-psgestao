'use client'
// P&M · BOT NO SLACK (CEO 31/10) — Fatia 1: conectar canal + escolher eventos.
// V1 = NOTIFICAÇÕES. A agência conecta um canal do Slack (por um Incoming Webhook) e escolhe quais avisos receber.
// SEGURANÇA: o webhook é um SEGREDO — guardado no cofre (vault) pela RPC fn_pm_bot_conectar, nunca em tabela/log.
// Aqui a tela só lê o estado (fn_pm_bot_config_obter), conecta (fn_pm_bot_conectar), salva eventos
// (fn_pm_bot_eventos_salvar) e desconecta (fn_pm_bot_desconectar). Envio e histórico chegam na Fatia 2 (motor de envio).
// Tema Espresso (RD-99). "?" RD-95 em todo campo/indicador/ação. Mobile-first (390px). Code: dev7claudeps
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/pm/bot'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const CARD = '#FFFFFF'

type EvKey = 'novo_job' | 'aprovacao_pendente' | 'prazo_24h' | 'job_atrasado' | 'estouro_horas'
type Eventos = Record<EvKey, boolean>
type Config = { conectado: boolean; canal_nome: string | null; eventos: Eventos; conectado_em: string | null }
type EnvioStatus = 'enfileirado' | 'enviado' | 'falhou'
type Envio = { id: string; evento: string; titulo: string | null; texto: string | null; status: EnvioStatus; http_status: number | null; erro: string | null; criado_em: string; enviado_em: string | null }

const STATUS_UI: Record<EnvioStatus, { rotulo: string; bg: string; fg: string }> = {
  enviado: { rotulo: 'Enviada', bg: '#DCEFD7', fg: '#1F5A1F' },
  falhou: { rotulo: 'Falhou', bg: '#F6DADA', fg: '#9B2222' },
  enfileirado: { rotulo: 'Na fila', bg: '#EFE6D3', fg: '#8A6D1A' },
}

const EVENTOS_DEF: { key: EvKey; chave: string; titulo: string; descricao: string }[] = [
  { key: 'novo_job', chave: 'pm.bot.ev_novo_job', titulo: 'Novo job', descricao: 'Quando entra um trabalho novo na agência.' },
  { key: 'aprovacao_pendente', chave: 'pm.bot.ev_aprovacao_pendente', titulo: 'Aprovação pendente do cliente', descricao: 'Quando uma entrega está esperando o cliente aprovar.' },
  { key: 'prazo_24h', chave: 'pm.bot.ev_prazo_24h', titulo: 'Prazo vencendo em 24h', descricao: 'Um dia antes de um job vencer.' },
  { key: 'job_atrasado', chave: 'pm.bot.ev_job_atrasado', titulo: 'Job atrasado', descricao: 'Quando um job passa do prazo sem concluir.' },
  { key: 'estouro_horas', chave: 'pm.bot.ev_estouro_horas', titulo: 'Estouro de horas do contrato', descricao: 'Quando as horas apontadas passam (ou chegam perto) das contratadas.' },
]
const EVENTOS_VAZIO: Eventos = { novo_job: true, aprovacao_pendente: true, prazo_24h: true, job_atrasado: true, estouro_horas: true }

const sFmt = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
const dhFmt = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function BotSlackPage() {
  const { companyIds, selInfo, loading: loadingEmpresa } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [cfg, setCfg] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // formulário de conexão
  const [webhook, setWebhook] = useState('')
  const [canal, setCanal] = useState('')
  const [evForm, setEvForm] = useState<Eventos>(EVENTOS_VAZIO)

  // histórico de envios (fatia 2)
  const [historico, setHistorico] = useState<Envio[]>([])
  const [testando, setTestando] = useState(false)

  const carregarHistorico = useCallback(async () => {
    if (!empresa) { setHistorico([]); return }
    const r = await supabase.rpc('fn_pm_bot_envio_listar', { p_company_id: empresa, p_limite: 20 })
    if (r.error) return
    setHistorico((Array.isArray(r.data) ? r.data : []) as Envio[])
  }, [empresa])

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    const r = await supabase.rpc('fn_pm_bot_config_obter', { p_company_id: empresa })
    if (r.error) { setErro('Não foi possível carregar a configuração do bot.'); setLoading(false); return }
    const c = (r.data ?? null) as Config | null
    setCfg(c)
    if (c) setEvForm({ ...EVENTOS_VAZIO, ...(c.eventos || {}) })
    setLoading(false)
    void carregarHistorico()
  }, [empresa, carregarHistorico])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  const conectar = async () => {
    if (!empresa) return
    setErro(null)
    if (!/^https:\/\/hooks\.slack\.com\//i.test(webhook.trim())) {
      setErro('Cole o endereço do webhook do canal (começa com https://hooks.slack.com/...).'); return
    }
    setBusy(true)
    const r = await supabase.rpc('fn_pm_bot_conectar', {
      p_company_id: empresa, p_webhook: webhook.trim(), p_canal_nome: canal.trim() || null, p_eventos: evForm,
    })
    setBusy(false)
    if (r.error || !(r.data as { ok?: boolean })?.ok) {
      setErro((r.data as { erro?: string })?.erro || 'Não foi possível conectar o canal. Confira o webhook e tente de novo.'); return
    }
    setWebhook(''); setToast('Canal conectado. Os avisos marcados passam a ser enviados quando o motor de envio for publicado.')
    await carregar()
  }

  const salvarEventos = async (next: Eventos) => {
    if (!empresa) return
    setBusy(true)
    const r = await supabase.rpc('fn_pm_bot_eventos_salvar', { p_company_id: empresa, p_eventos: next })
    setBusy(false)
    if (r.error || !(r.data as { ok?: boolean })?.ok) { setToast('Não foi possível salvar os avisos.'); await carregar(); return }
    setToast('Avisos atualizados.')
  }

  const toggleConectado = (key: EvKey) => {
    if (!cfg) return
    const next = { ...cfg.eventos, [key]: !cfg.eventos[key] }
    setCfg({ ...cfg, eventos: next })
    void salvarEventos(next)
  }

  const testar = async () => {
    if (!empresa) return
    setTestando(true); setErro(null)
    const r = await supabase.rpc('fn_pm_bot_testar', { p_company_id: empresa })
    if (r.error || !(r.data as { ok?: boolean })?.ok) {
      setToast((r.data as { erro?: string })?.erro || 'Não foi possível enviar o teste.'); setTestando(false); return
    }
    setToast('Mensagem de teste enviada. Confira o canal no Slack (e o histórico abaixo).')
    // o resultado chega em segundos (motor assíncrono): recarrega agora e de novo em 2,5 s
    await carregarHistorico()
    setTimeout(() => { void carregarHistorico() }, 2500)
    setTestando(false)
  }

  const desconectar = async () => {
    if (!empresa) return
    if (!window.confirm('Desconectar o canal do Slack? O webhook será removido do cofre e os avisos param.')) return
    setBusy(true)
    const r = await supabase.rpc('fn_pm_bot_desconectar', { p_company_id: empresa })
    setBusy(false)
    if (r.error) { setToast('Não foi possível desconectar.'); return }
    setToast('Canal desconectado.'); await carregar()
  }

  // ---- estilos ----
  const page: CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '20px 16px 64px', color: ESPRESSO }
  const card: CSSProperties = { background: CARD, border: `1px solid ${BORDA}`, borderRadius: 16, padding: 18, marginTop: 16, boxShadow: '0 1px 2px rgba(61,35,20,0.04)' }
  const h1: CSSProperties = { fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }
  const sub: CSSProperties = { color: TEXTM, marginTop: 6, fontSize: 14, lineHeight: 1.5 }
  const label: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14, marginBottom: 6 }
  const input: CSSProperties = { width: '100%', padding: '11px 12px', border: `1px solid ${BORDA}`, borderRadius: 10, fontSize: 15, background: OFFWHITE, color: ESPRESSO, boxSizing: 'border-box' }
  const btn: CSSProperties = { padding: '12px 18px', borderRadius: 12, border: 'none', background: ESPRESSO, color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%' }
  const btnGhost: CSSProperties = { padding: '10px 16px', borderRadius: 12, border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO, fontWeight: 700, fontSize: 14, cursor: 'pointer' }

  if (loadingEmpresa || loading) return <div style={page}><p style={{ color: TEXTM }}>Carregando…</p></div>
  if (!empresa) return (
    <div style={page}>
      <h1 style={h1}>Bot no Slack</h1>
      <div style={card}><p style={{ color: TEXTM, margin: 0 }}>Selecione uma empresa no topo para configurar o bot do Slack dela.</p></div>
    </div>
  )

  const conectado = !!cfg?.conectado

  return (
    <div style={page}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span aria-hidden style={{ fontSize: 26 }}>💬</span>
        <div>
          <h1 style={h1}>Bot no Slack <AjudaCampo chave="pm.bot.tela" rota={ROTA} /></h1>
          <p style={sub}>Receba os avisos da agência (novo job, aprovação, prazo) direto num canal do Slack — sem abrir o sistema. Grátis, pelo Slack.</p>
        </div>
      </div>

      {/* Situação */}
      <div style={card}>
        <div style={{ ...label }}>Situação do bot <AjudaCampo chave="pm.bot.status" rota={ROTA} /></div>
        {conectado ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <span style={{ background: '#DCEFD7', color: GREEN, padding: '4px 12px', borderRadius: 999, fontWeight: 700, fontSize: 13 }}>● Conectado</span>
            <span style={{ color: TEXTM, fontSize: 14 }}>
              Canal <strong style={{ color: ESPRESSO }}>{cfg?.canal_nome || '(sem apelido)'}</strong> · desde {sFmt(cfg?.conectado_em ?? null)}
            </span>
            <button style={{ ...btnGhost, marginLeft: 'auto' }} onClick={desconectar} disabled={busy}>
              Desconectar
            </button>
            <AjudaCampo chave="pm.bot.desconectar" rota={ROTA} />
          </div>
        ) : (
          <p style={{ color: TEXTM, margin: 0, fontSize: 14 }}>Nenhum canal conectado ainda. Conecte um canal do Slack abaixo para começar a receber os avisos.</p>
        )}
      </div>

      {/* Conectar (só quando desconectado) */}
      {!conectado && (
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Conectar canal do Slack</div>
          <p style={{ color: TEXTM, fontSize: 13, marginTop: 0, lineHeight: 1.5 }}>
            No Slack, abra <strong>Apps → Incoming Webhooks</strong>, escolha o canal e copie o endereço gerado (começa com <code>https://hooks.slack.com/…</code>).
          </p>

          <div style={{ marginTop: 12 }}>
            <div style={label}>Nome do canal (apelido) <AjudaCampo chave="pm.bot.canal_nome" rota={ROTA} /></div>
            <input style={input} value={canal} onChange={(e) => setCanal(e.target.value)} placeholder="#jobs-agencia" inputMode="text" />
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={label}>Endereço do webhook <AjudaCampo chave="pm.bot.webhook" rota={ROTA} /></div>
            <input style={input} value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.slack.com/services/…" inputMode="url" autoComplete="off" />
            <p style={{ color: TEXTM, fontSize: 12, marginTop: 6 }}>🔒 Guardado em cofre criptografado. Não aparece de novo depois de salvo.</p>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={label}>Quais avisos receber <AjudaCampo chave="pm.bot.conectar" rota={ROTA} /></div>
            {EVENTOS_DEF.map((ev) => (
              <label key={ev.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderTop: `1px solid ${BORDA}`, cursor: 'pointer' }}>
                <input type="checkbox" checked={evForm[ev.key]} onChange={() => setEvForm((s) => ({ ...s, [ev.key]: !s[ev.key] }))} style={{ marginTop: 3, width: 18, height: 18, accentColor: DOURADO }} />
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14 }}>{ev.titulo} <AjudaCampo chave={ev.chave} rota={ROTA} /></span>
                  <span style={{ color: TEXTM, fontSize: 13 }}>{ev.descricao}</span>
                </span>
              </label>
            ))}
          </div>

          {erro && <p style={{ color: '#9B2222', fontSize: 14, marginTop: 12 }}>{erro}</p>}
          <button style={{ ...btn, marginTop: 16, opacity: busy ? 0.6 : 1 }} onClick={conectar} disabled={busy}>
            {busy ? 'Conectando…' : 'Conectar canal'}
          </button>
        </div>
      )}

      {/* Eventos (quando conectado) */}
      {conectado && cfg && (
        <div style={card}>
          <div style={{ ...label }}>Avisos que este canal recebe <AjudaCampo chave="pm.bot.conectar" rota={ROTA} /></div>
          <p style={{ color: TEXTM, fontSize: 13, marginTop: 0 }}>Ligue ou desligue cada aviso. A mudança é salva na hora.</p>
          {EVENTOS_DEF.map((ev) => (
            <div key={ev.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderTop: `1px solid ${BORDA}` }}>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14 }}>{ev.titulo} <AjudaCampo chave={ev.chave} rota={ROTA} /></span>
                <span style={{ color: TEXTM, fontSize: 13 }}>{ev.descricao}</span>
              </span>
              <button
                role="switch" aria-checked={cfg.eventos[ev.key]} aria-label={ev.titulo}
                onClick={() => toggleConectado(ev.key)} disabled={busy}
                style={{ width: 46, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, background: cfg.eventos[ev.key] ? DOURADO : '#D8CEC2', transition: 'background .15s' }}
              >
                <span style={{ position: 'absolute', top: 3, left: cfg.eventos[ev.key] ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Testar envio (quando conectado) */}
      {conectado && (
        <div style={card}>
          <div style={{ ...label }}>Testar envio <AjudaCampo chave="pm.bot.testar" rota={ROTA} /></div>
          <p style={{ color: TEXTM, fontSize: 13, marginTop: 0, lineHeight: 1.5 }}>
            Manda uma mensagem de teste para o canal conectado agora. Use para confirmar que o Slack está recebendo.
          </p>
          <button style={{ ...btn, opacity: testando ? 0.6 : 1 }} onClick={testar} disabled={testando || busy}>
            {testando ? 'Enviando teste…' : 'Enviar mensagem de teste'}
          </button>
        </div>
      )}

      {/* Histórico de envios (quando conectado) */}
      {conectado && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ ...label, marginBottom: 0 }}>Histórico de envios <AjudaCampo chave="pm.bot.historico" rota={ROTA} /></div>
            <button style={{ ...btnGhost, marginLeft: 'auto', padding: '6px 12px' }} onClick={() => void carregarHistorico()}>
              Atualizar
            </button>
          </div>
          {historico.length === 0 ? (
            <p style={{ color: TEXTM, fontSize: 14, margin: '12px 0 0' }}>
              Nenhuma mensagem enviada ainda. Toque em <strong>Enviar mensagem de teste</strong> acima para ver o histórico aparecer aqui.
            </p>
          ) : (
            <div style={{ marginTop: 10 }}>
              {historico.map((h) => {
                const ui = STATUS_UI[h.status] ?? STATUS_UI.enfileirado
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderTop: `1px solid ${BORDA}` }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {h.titulo || h.evento}
                      </span>
                      <span style={{ color: TEXTM, fontSize: 12 }}>{dhFmt(h.enviado_em || h.criado_em)}</span>
                      {h.status === 'falhou' && h.erro && (
                        <span style={{ color: '#9B2222', fontSize: 12, display: 'block', marginTop: 2 }}>{h.erro}</span>
                      )}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ background: ui.bg, color: ui.fg, padding: '3px 10px', borderRadius: 999, fontWeight: 700, fontSize: 12 }}>{ui.rotulo}</span>
                      {historico.indexOf(h) === 0 && <AjudaCampo chave="pm.bot.envio_status" rota={ROTA} />}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* O que vem a seguir (honesto, RD-98) */}
      <div style={{ ...card, background: OFFWHITE }}>
        <div style={{ ...label }}>O que vem a seguir <AjudaCampo chave="pm.bot.proximo" rota={ROTA} /></div>
        <p style={{ color: TEXTM, fontSize: 14, margin: 0, lineHeight: 1.6 }}>
          Já funciona: conectar o canal, escolher os avisos, <strong>testar o envio</strong> e ver o
          <strong> histórico</strong> das mensagens. A próxima fatia liga o <strong>disparo automático por evento</strong>
          (novo job, prazo em 24h, job atrasado…), para os avisos marcados saírem sozinhos quando o fato acontecer.
        </p>
      </div>

      {toast && (
        <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '12px 18px', borderRadius: 12, fontSize: 14, boxShadow: '0 6px 20px rgba(0,0,0,.2)', maxWidth: 'calc(100vw - 32px)', zIndex: 50 }}>
          {toast}
        </div>
      )}
    </div>
  )
}
