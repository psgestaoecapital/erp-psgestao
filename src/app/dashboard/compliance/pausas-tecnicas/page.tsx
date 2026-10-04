'use client'
// Compliance · Pausas Térmicas frigorífico (NR-36 psicofisiológica + Art.253 CLT térmica).
// Resolve #52 (upload da planilha de pausas) e reorganiza as abas (SPEC NR-36 Frontend):
//   PAINEL        = KPIs + apuração (devido vs realizado, semáforo) + dias sem dado + prova por colaborador
//   IMPORTAR      = upload do relatório de ponto (CSV/XLSX) → hash SHA-256 → storage → registrar → processar
//   HISTÓRICO     = uploads (quem/quando/hash) + baixar original + substituir (nunca apaga — RD-30)
//   CONFIGURAÇÃO  = regras editáveis (base legal) + elegíveis (por função/manual)
// Realizado agora VEM do upload (ind_ponto_pausa). Dia sem planilha importada NÃO é dia sem pausa (RD-51).
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { CSS_IMPRESSAO } from '@/lib/ponto/impressaoDocumento'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { frasesPausasCurtas, frasesExcesso, fraseSinal, type PausaDia, type Trecho } from '@/lib/ponto/supervisaoFrases'
import { reguaDe, textoRegua, mmss, motivoRegua, type Regua } from '@/lib/ponto/reguaPausa'
import { rpc } from '@/lib/authFetch'
import { supabase } from '@/lib/supabase'
import { marcasDasPausas, parearMarcas, validarMarcas, normalizarHora, sugerirPapeis, diaSuspeito, type Marca, type PapelMarca, type LinhaPausaDia, type PausaRelida } from '@/lib/ponto/pausasMarcas'
import { ORIGENS_AJUSTE, ajusteDe, rotuloAjuste, rotuloOrigemAjuste, pendenciasDaPrevia, textoPendencia, linhaPausaDoc, notaDiaDoc, type AjusteDia, type OrigemAjuste, type PausaDoc } from '@/lib/ponto/ajusteBatida'
import { Timer, Snowflake, ClipboardList, FileText, AlertTriangle, Save, Upload, History, Download, RefreshCw, ShieldAlert, CheckCircle2, Users, Copy, Printer, BarChart3, FileSignature } from 'lucide-react'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8', borderLt: '#ece3d2',
  ink: '#1a1a1a', green: '#2d6a3e', greenBg: '#e8f3ec', amber: '#8a6a10', amberBg: '#fdf4e0',
  red: '#a02020', redBg: '#fce8e8', gray: '#6b6b6b', blue: '#1f4e79', blueBg: '#e8f0f8',
}
type Regra = { id: string; tipo: string; nome: string; parametros: Record<string, unknown>; base_legal: string | null; ativo: boolean }
type Colab = { colaborador_id: string; nome: string; cpf: string; funcao: string | null; departamento: string | null; psico: boolean; termica: boolean }
type Resumo = { colaborador_id: string; cpf: string; nome: string; funcao: string | null; tipo: string; dias: number; devido_min: number; realizado_min: number | null; dias_desvio: number; dias_conforme: number; dias_aguardando: number; dias_pendente: number; dias_sem_dado: number; status: string }
type ProvaLinha = { data: string; tipo: string; jornada_seg: number; devido_min: number; realizado_min: number | null; status: string }
type UploadRow = { id: string; arquivo_nome: string; arquivo_hash: string; periodo_inicio: string | null; periodo_fim: string | null; linhas_lidas: number | null; linhas_aceitas: number | null; linhas_rejeitadas: number | null; status: string; enviado_por_email: string | null; enviado_em: string; arquivo_path: string | null; substituido_por: string | null; observacao?: string | null }
type PausaHistorico = { data: string; cpf: string; nome: string | null; inicio: string | null; fim_arquivo: string | null; fim_confirmado: string | null; fim_origem: string | null; arquivado_em: string; motivo: string; referencia: string | null }
type Rejeitada = { linha: number; cpf: string | null; motivo: string }
type LinhaImport = { cpf: string; data: string; inicio: string; fim: string | null; duracao_seg: number | null; tipo: string | null; _nome?: string }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const fmtData = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '—'
const fmtDT = (s: string | null) => s ? new Date(s).toLocaleString('pt-BR') : '—'
const hhmm = (seg: number) => `${Math.floor(seg / 3600)}h${String(Math.round((seg % 3600) / 60)).padStart(2, '0')}`
const tipoLabel = (t: string | null) => t === 'termica_253' ? 'Térmica (Art.253)' : t === 'psicofisiologica' ? 'Psicofisiológica (NR-36)' : (t || '—')
const semColor: Record<string, { c: string; bg: string; l: string }> = {
  // Motor sequencial (Art.253/NR-36): apura o limite de exposição CONTÍNUA evento a evento
  // (gatilho_min/pausa_min), não por soma. Vocabulário: conforme · desvio · aguardando · sem_dado.
  // 'sem_dado' NUNCA vira verde (RD-51) — dia sem evento importado não é dia conforme.
  conforme: { c: C.green, bg: C.greenBg, l: 'Conforme' },
  desvio: { c: C.red, bg: C.redBg, l: 'Desvio' },
  aguardando_realizado: { c: C.blue, bg: C.blueBg, l: 'Aguardando realizado' },
  // pausa aberta / não-fechada (fim não confiável) → aguarda a responsável confirmar na aba
  // Conferência. NUNCA é desvio nem conforme (RD-38: não sabemos o fim, não supomos).
  pendente_confirmacao: { c: C.amber, bg: C.amberBg, l: 'Aguardando confirmação' },
  // 'sem_dado' aqui = dia DENTRO do período importado em que o colaborador não registrou evento
  // (colaborador_sem_evento). O vazio de PERÍODO (planilha não importada) é sinalizado à parte,
  // pelo banner de "dias sem planilha importada" (fn_nr36_dias_sem_dado). São coisas diferentes (0e580f96).
  sem_dado: { c: C.gray, bg: C.beigeLt, l: 'Sem evento no dia' },
  // legado (some após reapurar): mostra âmbar até a reapuração substituir por conforme/desvio
  cumprida: { c: C.amber, bg: C.amberBg, l: 'Em revisão' },
  parcial: { c: C.amber, bg: C.amberBg, l: 'Em revisão' },
  nao_cumprida: { c: C.red, bg: C.redBg, l: 'Desvio' },
}
const motivoLabel = (m: string) => m === 'cpf_nao_cadastrado' ? 'CPF não está no cadastro de colaboradores' : m === 'data_hora_invalida' ? 'Data/hora inválida' : m

// #92 · rótulo do roll-up por colaborador. A pendência tem rótulo PRÓPRIO ("Aguardando
// conferência") — nunca "desvio" (RD-38: não sabemos o fim, não supomos) e nunca "conforme"
// (RD-51: dia em aberto não é conforme). Aponta a responsável para a aba Conferência.
const painelStatusLabel: Record<string, string> = { pendente_confirmacao: 'Aguardando conferência' }

// #92 · composição dos dias do colaborador — o painel mostra o QUE COMPÕE o mês, não só o pior
// status. Ex.: "18 conforme · 13 aguardando · 1 desvio". Só os grupos não-zero, em ordem de
// severidade, para a supervisão enxergar a mistura de uma vez.
function ComposicaoDias({ r }: { r: Resumo }) {
  const partes = [
    { n: r.dias_desvio, c: C.red, l: 'desvio' },
    { n: r.dias_pendente, c: C.amber, l: 'aguardando' },
    { n: r.dias_sem_dado, c: C.gray, l: 'sem evento' },
    { n: r.dias_aguardando, c: C.blue, l: 'aguard. realizado' },
    { n: r.dias_conforme, c: C.green, l: 'conforme' },
  ].filter(p => (p.n ?? 0) > 0)
  if (partes.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
      {partes.map((p, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: p.c, background: p.c + '18', borderRadius: 6, padding: '1px 6px' }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: p.c }} />{p.n} {p.l}
        </span>
      ))}
    </div>
  )
}

// normaliza cabeçalho: minúsculo, sem acento, sem espaços/pontuação
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export default function PausasTecnicasPage() {
  const { sel, selInfo, loading } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' ? sel : null
  const [aba, setAba] = useState<'painel' | 'conferencia' | 'ciencia' | 'gestao' | 'supervisao' | 'auditoria' | 'importar' | 'historico' | 'config'>('painel')

  if (loading) return <Wrap><div style={{ color: C.gray, padding: 40 }}>Carregando…</div></Wrap>
  if (!companyId) return <Wrap><Header /><Vazio titulo="Selecione uma empresa" texto="As pausas térmicas são por empresa. Escolha uma empresa específica no topo (não Consolidado/Grupo)." /></Wrap>

  return (
    <Wrap>
      <Header />
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.borderLt}`, flexWrap: 'wrap' }}>
        {([['painel', 'Painel', ClipboardList], ['conferencia', 'Conferência', CheckCircle2], ['ciencia', 'Ciência', FileSignature], ['gestao', 'Gestão', BarChart3], ['supervisao', 'Supervisão', Users], ['auditoria', 'Auditoria', FileText], ['importar', 'Importar', Upload], ['historico', 'Histórico', History], ['config', 'Configuração', Timer]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setAba(k)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: aba === k ? 700 : 500, color: aba === k ? C.espresso : C.gray, borderBottom: `2px solid ${aba === k ? C.gold : 'transparent'}`, marginBottom: -1 }}><Icon size={16} /> {label}</button>
        ))}
      </div>
      {/* Banner "Em revisão" (SST ①) REMOVIDO: a reclassificação em 5 classes (②) e a reapuração
          com amarração pausa×ponto (③+④) já rodaram em produção. Os números do veredito agora
          contam só o desvio provado (pausa insuficiente); a não-realizada é estimativa sinalizada
          à parte, mostrada no quadro de reconciliação do Painel. */}
      {aba === 'painel' && <AbaPainel companyId={companyId} />}
      {aba === 'conferencia' && <AbaConferencia companyId={companyId} />}
      {aba === 'ciencia' && <AbaCiencia companyId={companyId} />}
      {aba === 'gestao' && <AbaGestao companyId={companyId} />}
      {aba === 'supervisao' && <AbaSupervisao companyId={companyId} />}
      {aba === 'auditoria' && <AbaAuditoria companyId={companyId} />}
      {aba === 'importar' && <AbaImportar companyId={companyId} />}
      {aba === 'historico' && <AbaHistorico companyId={companyId} />}
      {aba === 'config' && <AbaConfig companyId={companyId} />}
    </Wrap>
  )
}

// ─────────────────────────────────── PAINEL ───────────────────────────────────
function AbaPainel({ companyId }: { companyId: string }) {
  const hoje = new Date()
  const [ini, setIni] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)))
  const [fim, setFim] = useState(iso(hoje))
  const [resumo, setResumo] = useState<Resumo[]>([])
  const [temReal, setTemReal] = useState(false)
  const [diasSemDado, setDiasSemDado] = useState<string[]>([])
  const [rodando, setRodando] = useState(false)
  const [carregado, setCarregado] = useState(false)
  const [erro, setErro] = useState('')
  const [prova, setProva] = useState<{ cpf: string; nome: string } | null>(null)

  const carregar = useCallback(async () => {
    setErro('')
    try {
      const r = await rpc<{ resumo: Resumo[]; tem_realizado: boolean }>('fn_nr36_apuracao_listar', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
      setResumo(r.resumo || []); setTemReal(!!r.tem_realizado)
      const dias = await rpc<string[]>('fn_nr36_dias_sem_dado', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
      setDiasSemDado(Array.isArray(dias) ? dias : [])
      setCarregado(true)
    } catch (e) { setErro((e as Error).message) }
  }, [companyId, ini, fim])
  useEffect(() => { void carregar() }, [carregar])

  const reapurar = async () => {
    setRodando(true); setErro('')
    try {
      await rpc('fn_nr36_apurar', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
      await rpc('fn_nr36_alertas', { p_company_id: companyId }) // gera alertas proativos p/ não cumpridas
      await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setRodando(false) }
  }

  const kpi = useMemo(() => {
    const k = { conforme: 0, desvio: 0, pendente_confirmacao: 0, aguardando_realizado: 0, sem_dado: 0 }
    for (const r of resumo) if (r.status in k) (k as Record<string, number>)[r.status]++
    return k
  }, [resumo])

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <Campo label="De"><input type="date" style={inp()} value={ini} onChange={e => setIni(e.target.value)} /></Campo>
        <Campo label="Até"><input type="date" style={inp()} value={fim} onChange={e => setFim(e.target.value)} /></Campo>
        <Btn onClick={reapurar} disabled={rodando}><RefreshCw size={14} /> {rodando ? 'Reapurando…' : 'Reapurar período'}</Btn>
      </div>

      {/* Motor sequencial ativo: apura o limite de exposição CONTÍNUA (Art.253), não por soma.
          A janela de exposição lê os eventos reais do relógio (classificados por duração). */}
      <div style={{ display: 'flex', gap: 10, background: C.blueBg, border: `1px solid ${C.blue}33`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <AlertTriangle size={18} style={{ color: C.blue, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: C.espresso, lineHeight: 1.5 }}>
          <b>Motor sequencial (Art.253/NR-36).</b> A apuração checa o limite de <b>exposição contínua</b> evento a evento — quando a pausa ocorreu, sua duração e as pausas que faltaram — não a soma do dia. Os eventos do relógio são classificados por duração (pausa × exposição), com o limite ajustável em Configuração (regra <code>0e580f96</code>). <b>&ldquo;Sem dado&rdquo;</b> = dia sem evento importado (não é dia conforme). O cruzamento com a marcação de entrada/saída depende da correção de fuso do ponto (pendente) — até lá, a exposição vem do registro próprio.
        </div>
      </div>

      {/* SST ⑦ (#67): reconciliação por período — o caminho dos 189 e os 54 sinalizados à parte */}
      <ReconciliacaoPanel companyId={companyId} ini={ini} fim={fim} chave={carregado ? `${ini}|${fim}|${resumo.length}` : ''} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi label="Conformes" n={kpi.conforme} cor={C.green} bg={C.greenBg} />
        <Kpi label="Desvios" n={kpi.desvio} cor={C.red} bg={C.redBg} />
        <Kpi label="Aguardando confirmação" n={kpi.pendente_confirmacao} cor={C.amber} bg={C.amberBg} />
        <Kpi label="Aguardando realizado" n={kpi.aguardando_realizado} cor={C.blue} bg={C.blueBg} />
        <Kpi label="Sem evento no dia" n={kpi.sem_dado} cor={C.gray} bg={C.beigeLt} />
      </div>

      {kpi.sem_dado > 0 && (
        <div style={{ fontSize: 12, color: C.gray, marginBottom: 12, lineHeight: 1.5 }}>
          <b>&ldquo;Sem evento no dia&rdquo;</b> = o colaborador trabalhou (há ponto), mas <b>não registrou entrada no ambiente</b> naquele dia — dentro do período que foi importado. É diferente de <b>&ldquo;dia sem planilha importada&rdquo;</b> (avisado acima), que é dado que ainda falta subir. Nenhum dos dois é &ldquo;conforme&rdquo;.
        </div>
      )}

      {diasSemDado.length > 0 && (
        <div style={{ display: 'flex', gap: 10, background: C.amberBg, border: `1px solid ${C.amber}33`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <AlertTriangle size={18} style={{ color: C.amber, flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: C.espresso }}>
            <b>{diasSemDado.length} dia(s) sem planilha importada</b> no período — <b>NÃO é dia sem pausa</b>, é dado que falta importar. Suba o relatório na aba Importar. Dias: {diasSemDado.map(fmtData).join(' · ')}
          </div>
        </div>
      )}

      {erro && <div style={erroBox()}>{erro}</div>}
      {!carregado ? <Load /> :
        resumo.length === 0 ? <Vazio titulo="Sem apuração no período" texto="Marque elegíveis na Configuração, importe o relatório de ponto na aba Importar, e clique em Reapurar. O sistema cruza a jornada com as regras e o realizado importado." /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={th()}>Funcionário</th><th style={th()}>Pausa</th><th style={th()}>Dias</th><th style={th()}>Devido</th><th style={th()}>Realizado</th><th style={th()}>Situação</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {resumo.map((r, i) => { const s = semColor[r.status] || semColor.aguardando_realizado; return (
                <tr key={r.colaborador_id + r.tipo + i} style={{ borderBottom: `1px solid ${C.beigeLt}` }}>
                  <td style={td()}><div style={{ fontWeight: 600, color: C.espresso }}>{r.nome}</div><div style={{ fontSize: 11, color: C.gray }}>{r.funcao || ''}</div></td>
                  <td style={td()}>{tipoLabel(r.tipo)}</td>
                  <td style={td()}>{r.dias}</td>
                  <td style={td()}>{r.devido_min} min</td>
                  <td style={td()}>{r.realizado_min == null ? <span style={{ color: C.blue }}>aguardando</span> : `${r.realizado_min} min`}</td>
                  <td style={td()}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: s.bg, color: s.c, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 700 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: s.c }} /> {painelStatusLabel[r.status] ?? s.l}</span>
                    <ComposicaoDias r={r} />
                  </td>
                  <td style={td()}><BtnGhost onClick={() => setProva({ cpf: r.cpf, nome: r.nome })}><FileText size={13} /> Prova</BtnGhost></td>
                </tr>
              ) })}
            </tbody>
          </table>
        </div>
      )}
      {!temReal && carregado && resumo.length > 0 && (
        <div style={{ fontSize: 12, color: C.gray, marginTop: 10 }}>Sem &ldquo;realizado&rdquo; para parte do período — importe o relatório de ponto para provar a concessão (a apuração só mostra o devido até lá).</div>
      )}
      {prova && <ModalProva companyId={companyId} cpf={prova.cpf} nome={prova.nome} ini={ini} fim={fim} onClose={() => setProva(null)} />}
    </div>
  )
}

function Kpi({ label, n, cor, bg }: { label: string; n: number; cor: string; bg: string }) {
  return <div style={{ background: bg, border: `1px solid ${cor}22`, borderRadius: 12, padding: '12px 14px' }}><div style={{ fontSize: 26, fontWeight: 800, color: cor, lineHeight: 1 }}>{n}</div><div style={{ fontSize: 12, color: C.espresso, marginTop: 4 }}>{label}</div></div>
}

// ─────────────────────── CIÊNCIA MENSAL (#74) ───────────────────────
// Gera o relatório mensal por colaborador, coleta a assinatura via link público (mesmo fluxo do
// EPI) e acompanha quem falta. O documento declara a origem de cada horário (RD-38).
// #74 (CEO 02/10): a lista é de TODOS os elegíveis à pausa térmica do mês (fn_nr36_ciencia_painel), não só de quem já
// tem documento: sem_documento → botão Gerar; sem_apuracao → não há pausa importada no mês para ele (motivo explícito)
type CienciaLinha = { id: string | null; cpf: string; situacao?: 'com_documento' | 'sem_documento' | 'sem_apuracao'; elegivel?: boolean; dias_apurados?: number; nome: string; funcao: string | null; setor: string | null; status: string; assinado_em: string | null; recusa_assinar: boolean; recusa_motivo: string | null; resumo: { conforme?: number; desvio?: number; pendente_confirmacao?: number; dias_total?: number } | null; documento_hash: string | null
  // #587: documento assinado/recusado nunca é regerado — ajuste depois disso o marca como desatualizado e a nova versão guarda a anterior
  versao?: number; versao_motivo?: string | null; desatualizado_em?: string | null; desatualizado_motivo?: string | null; versoes_guardadas?: number }
const cienciaSelo: Record<string, { c: string; bg: string; l: string }> = {
  assinado: { c: C.green, bg: C.greenBg, l: 'Assinado' },
  pendente: { c: C.amber, bg: C.amberBg, l: 'Aguardando assinatura' },
  recusado: { c: C.red, bg: C.redBg, l: 'Recusou assinar' },
}
function mesAtual(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

function AbaCiencia({ companyId }: { companyId: string }) {
  const [comp, setComp] = useState(mesAtual())
  const [dados, setDados] = useState<{ total: number; elegiveis: number; com_documento: number; sem_documento: number; sem_apuracao: number; assinados: number; pendentes: number; recusados: number; linhas: CienciaLinha[] } | null>(null)
  const [gerandoCpf, setGerandoCpf] = useState<string | null>(null)
  const [erro, setErro] = useState(''); const [busy, setBusy] = useState(false); const [carregado, setCarregado] = useState(false)
  const [link, setLink] = useState<{ nome: string; url: string; wa: string | null } | null>(null)
  const [verDoc, setVerDoc] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro('')
    try { const r = await rpc<{ ok: boolean; total: number; elegiveis: number; com_documento: number; sem_documento: number; sem_apuracao: number; assinados: number; pendentes: number; recusados: number; linhas: CienciaLinha[] }>('fn_nr36_ciencia_painel', { p_company_id: companyId, p_competencia: `${comp}-01` }); setDados(r); setCarregado(true) }
    catch (e) {
      // banco ainda sem o painel (preview antes da migration): mostra ao menos quem já tem documento, como antes
      const msg = (e as Error).message
      if (!/fn_nr36_ciencia_painel|could not find the function|schema cache|perhaps you meant|PGRST202/i.test(msg)) { setErro(msg); return }
      try {
        const r = await rpc<{ total: number; assinados: number; pendentes: number; recusados: number; linhas: CienciaLinha[] }>('fn_nr36_ciencia_listar', { p_company_id: companyId, p_competencia: `${comp}-01` })
        const linhas = (r.linhas || []).map(l => ({ ...l, situacao: 'com_documento' as const, elegivel: true }))
        setDados({ ...r, linhas, elegiveis: linhas.length, com_documento: linhas.length, sem_documento: 0, sem_apuracao: 0 }); setCarregado(true)
      } catch (e2) { setErro((e2 as Error).message) }
    }
  }, [companyId, comp])
  useEffect(() => { void carregar() }, [carregar])

  const gerar = async () => {
    setBusy(true); setErro('')
    try { await rpc('fn_nr36_ciencia_gerar', { p_company_id: companyId, p_competencia: `${comp}-01` }); await carregar() }
    catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }
  const gerarUm = async (l: CienciaLinha) => {
    setGerandoCpf(l.cpf); setErro('')
    try { await rpc('fn_nr36_ciencia_gerar', { p_company_id: companyId, p_competencia: `${comp}-01`, p_cpf: l.cpf }); await carregar() }
    catch (e) { setErro((e as Error).message) } finally { setGerandoCpf(null) }
  }
  const gerarLink = async (l: CienciaLinha) => {
    if (!l.id) return
    setErro('')
    try {
      const r = await rpc<Array<{ token: string; url_assinatura: string; whatsapp_link: string | null; colaborador_nome: string }>>('fn_nr36_ciencia_gerar_link', { p_ciencia_id: l.id, p_whatsapp_telefone: null })
      const row = Array.isArray(r) ? r[0] : r
      if (row) setLink({ nome: l.nome, url: row.url_assinatura, wa: row.whatsapp_link })
    } catch (e) { setErro((e as Error).message) }
  }
  const novaVersao = async (l: CienciaLinha) => {
    const motivo = window.prompt(`Nova versão do documento de ${l.nome}. A versão ${l.versao ?? 1} (${l.status === 'assinado' ? 'assinada' : 'com a recusa registrada'}) fica guardada, sem mudança. Motivo:`, l.desatualizado_motivo || '')
    if (motivo === null) return
    setErro('')
    try {
      if (!l.id) return
      const r = await rpc<{ ok: boolean; versao?: number; erro?: string; mensagem?: string }>('fn_nr36_ciencia_nova_versao', { p_id: l.id, p_motivo: motivo })
      if (!r.ok) throw new Error(r.mensagem || (r.erro === 'sem_motivo' ? 'Escreva o motivo (pelo menos 10 caracteres).' : r.erro) || 'falha ao gerar a nova versão')
      await carregar()
    } catch (e) { setErro((e as Error).message) }
  }
  const recusar = async (l: CienciaLinha) => {
    const motivo = window.prompt(`Registrar recusa de ${l.nome}. Motivo (opcional):`, '')
    if (motivo === null || !l.id) return
    try { await rpc('fn_nr36_ciencia_recusar', { p_id: l.id, p_motivo: motivo }); await carregar() }
    catch (e) { setErro((e as Error).message) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <Campo label="Competência"><input type="month" style={inp()} value={comp} onChange={e => setComp(e.target.value)} /></Campo>
        <Btn onClick={gerar} disabled={busy}><RefreshCw size={14} /> {busy ? 'Gerando…' : 'Gerar / atualizar documentos'}</Btn>
      </div>
      <div style={{ display: 'flex', gap: 10, background: C.blueBg, border: `1px solid ${C.blue}33`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <FileSignature size={18} style={{ color: C.blue, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: C.espresso, lineHeight: 1.5 }}>
          Gera um relatório mensal por colaborador com os horários de pausa e sua origem (registrado · confirmado pelo ponto · estimado), coleta a <b>assinatura por link</b> (Lei 14.063/2020, mesmo fluxo do EPI) e mostra <b>quem já assinou e quem falta</b>. A abertura do link é registrada mesmo sem assinatura. Só gera para quem tem apuração no mês; documento já assinado não é sobrescrito. Quando um dia é ajustado na Conferência, o documento ainda não assinado é atualizado sozinho e mostra o horário original e o ajustado (origem, quem e quando); o já assinado fica como está e pede uma <b>nova versão</b>, que guarda a assinada.
        </div>
      </div>

      {dados && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 12 }}>
          <Kpi label="Elegíveis no mês" n={dados.elegiveis} cor={C.espresso} bg={C.beigeLt} />
          <Kpi label="Sem documento" n={dados.sem_documento} cor={C.amber} bg={C.amberBg} />
          <Kpi label="Assinados" n={dados.assinados} cor={C.green} bg={C.greenBg} />
          <Kpi label="Aguardando" n={dados.pendentes} cor={C.amber} bg={C.amberBg} />
          <Kpi label="Recusaram" n={dados.recusados} cor={C.red} bg={C.redBg} />
        </div>
      )}

      {erro && <div style={erroBox()}>{erro}</div>}
      {!carregado ? <Load /> : !dados || dados.linhas.length === 0 ? (
        <Vazio titulo="Nenhum elegível à pausa térmica" texto="Cadastre quem é elegível em Configuração. A lista mostra todos os elegíveis do mês, com e sem documento." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={th()}>Colaborador</th><th style={th()}>Resumo do mês</th><th style={th()}>Situação</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {dados.linhas.map((l) => { const s = cienciaSelo[l.status] || cienciaSelo.pendente; const semDoc = !l.id; return (
                <tr key={l.cpf} style={{ borderBottom: `1px solid ${C.beigeLt}` }} data-testid={`ciencia-linha-${l.cpf}`}>
                  <td style={td()}><div style={{ fontWeight: 600, color: C.espresso }}>{l.nome}</div><div style={{ fontSize: 11, color: C.gray }}>{l.funcao || ''}{l.setor ? ` · ${l.setor}` : ''}</div></td>
                  <td style={td()}>{semDoc ? <span style={{ color: C.gray }}>{l.dias_apurados ? `${l.dias_apurados} dia(s) apurado(s)` : 'nenhuma pausa importada no mês'}</span> : <><span style={{ color: C.green }}>{l.resumo?.conforme ?? 0} conf.</span> · <span style={{ color: C.red }}>{l.resumo?.desvio ?? 0} desv.</span> · <span style={{ color: C.amber }}>{l.resumo?.pendente_confirmacao ?? 0} p/ confirmar</span></>}</td>
                  <td style={td()}>{semDoc ? (l.situacao === 'sem_apuracao'
                    ? <span style={{ fontSize: 11.5, fontWeight: 700, color: C.gray, background: C.beigeLt, borderRadius: 999, padding: '3px 10px' }} data-testid={`ciencia-sem-apuracao-${l.cpf}`}>Sem relatório de pausa no mês</span>
                    : <span style={{ fontSize: 11.5, fontWeight: 700, color: C.amber, background: C.amberBg, borderRadius: 999, padding: '3px 10px' }} data-testid={`ciencia-sem-documento-${l.cpf}`}>Sem documento</span>)
                    : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: s.bg, color: s.c, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 700 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: s.c }} /> {s.l}</span>}
                    {l.elegivel === false && <div style={{ fontSize: 10, color: C.gray, marginTop: 3 }}>não está mais elegível</div>}{l.recusa_motivo && <div style={{ fontSize: 10, color: C.gray, marginTop: 3 }}>{l.recusa_motivo}</div>}
                    {(l.versao ?? 1) > 1 && <div style={{ fontSize: 10.5, color: C.gray, marginTop: 3 }} data-testid={`ciencia-versao-${l.cpf}`}>versão {l.versao}{l.versao_motivo ? ` · ${l.versao_motivo}` : ''} · {l.versoes_guardadas ?? 0} anterior(es) guardada(s)</div>}
                    {l.desatualizado_em && <div style={{ fontSize: 10.5, color: C.amber, fontWeight: 700, marginTop: 3 }} data-testid={`ciencia-desatualizado-${l.cpf}`}>ajuste depois da {l.status === 'assinado' ? 'assinatura' : 'recusa'}: {l.desatualizado_motivo}</div>}</td>
                  <td style={{ ...td(), whiteSpace: 'nowrap' }}>
                    {semDoc ? (l.situacao === 'sem_documento' && <span data-testid={`ciencia-gerar-${l.cpf}`}><BtnGhost onClick={() => gerarUm(l)}><RefreshCw size={13} /> {gerandoCpf === l.cpf ? 'Gerando…' : 'Gerar documento'}</BtnGhost></span>) : <>
                    <BtnGhost onClick={() => setVerDoc(l.id)}><FileText size={13} /> Ver/PDF</BtnGhost>{' '}
                    {l.status !== 'assinado' && <><BtnGhost onClick={() => gerarLink(l)}><Copy size={13} /> Link p/ assinar</BtnGhost>{' '}
                    <BtnGhost onClick={() => recusar(l)}>Recusa</BtnGhost></>}
                    {(l.status === 'assinado' || l.status === 'recusado') && l.desatualizado_em && <>{' '}<BtnGhost onClick={() => novaVersao(l)}><RefreshCw size={13} /> Nova versão</BtnGhost></>}
                    </>}
                  </td>
                </tr>
              ) })}
            </tbody>
          </table>
        </div>
      )}

      {link && (
        <div onClick={() => setLink(null)} style={modalBg()}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalCard(), maxWidth: 520 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.espresso, marginBottom: 8 }}>Link de assinatura — {link.nome}</div>
            <p style={{ fontSize: 12.5, color: C.gray, marginBottom: 10 }}>Envie ao colaborador. A abertura fica registrada; ele confirma com o próprio CPF (Lei 14.063/2020).</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input readOnly value={link.url} style={{ ...inp(), flex: 1 }} onFocus={e => e.currentTarget.select()} />
              <Btn onClick={() => navigator.clipboard?.writeText(link.url)}><Copy size={14} /> Copiar</Btn>
            </div>
            {link.wa && <a href={link.wa} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.green, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>Abrir no WhatsApp →</a>}
            <div style={{ marginTop: 14, textAlign: 'right' }}><BtnGhost onClick={() => setLink(null)}>Fechar</BtnGhost></div>
          </div>
        </div>
      )}
      {verDoc && <ModalCienciaDoc id={verDoc} onClose={() => setVerDoc(null)} />}
    </div>
  )
}

function ModalCienciaDoc({ id, onClose }: { id: string; onClose: () => void }) {
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [subindo, setSubindo] = useState(false)
  const carregarDoc = useCallback(async () => {
    try { const { data } = await supabase.from('nr36_ciencia_mensal').select('*').eq('id', id).single(); setDoc(data as Record<string, unknown>) }
    catch { /* */ } finally { setLoading(false) }
  }, [id])
  useEffect(() => { void carregarDoc() }, [carregarDoc])
  const anexarAssinado = async (f: File | null) => {
    if (!f || !doc) return
    setSubindo(true)
    try {
      const path = `ciencia/${doc.company_id}/${doc.cpf}_${String(doc.competencia).slice(0, 7)}_${Date.now()}.${(f.name.split('.').pop() || 'pdf')}`
      const up = await supabase.storage.from('compliance-pausas').upload(path, f, { contentType: f.type || 'application/pdf', upsert: false })
      if (up.error) throw up.error
      const { data: pub } = supabase.storage.from('compliance-pausas').getPublicUrl(path)
      await rpc('fn_nr36_ciencia_anexar_assinado', { p_id: id, p_arquivo_url: pub?.publicUrl || path })
      await carregarDoc()
    } catch (e) { alert('Falha ao anexar: ' + (e as Error).message) } finally { setSubindo(false) }
  }
  const snap = (doc?.colaborador_snapshot || {}) as Record<string, string>
  const detalhe = (doc?.detalhe || []) as Array<{ data: string; status: string; jornada?: { inicio?: string; fim?: string }; pausas?: PausaDoc[]; ajuste?: AjusteDia | null }>
  const nEst = detalhe.reduce((a, d) => a + (d.pausas || []).filter(p => p.fim_origem === 'estimado').length, 0)
  // #587: mesma leitura da página de assinatura (lib/ponto/ajusteBatida) — retorno sem saída não sai invertido e o
  // horário ajustado aparece junto do original, com origem, quem e quando
  const corTom = { normal: C.espresso, alerta: C.red, estimado: C.amber, ponto: C.blue, confirmado: C.espresso } as const
  const fim = (p: PausaDoc, aj?: AjusteDia | null) => {
    const l = linhaPausaDoc(p, aj)
    return <span><span style={{ fontFamily: 'monospace', color: l.tom === 'alerta' ? C.red : undefined }}>{l.texto}</span>{l.sufixo && <b style={{ color: corTom[l.tom] }}>{l.sufixo}</b>}
      {l.notas.map((n, k) => <span key={k} style={{ display: 'block', fontSize: 11, color: C.gray, paddingLeft: 12 }} data-testid="ciencia-ajuste-nota">{n}</span>)}</span>
  }
  return createPortal(
    <div onClick={onClose} style={modalBg()} className="ps-print-portal" data-testid="ciencia-doc-modal">
      <style>{CSS_IMPRESSAO}</style>
      <div onClick={e => e.stopPropagation()} id="ciencia-doc-print" className="ps-print-doc" style={{ ...modalCard(), maxWidth: 720, maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: C.gray, textTransform: 'uppercase', letterSpacing: 1 }}>Relatório de ciência mensal</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <BtnGhost onClick={() => window.print()}><Printer size={13} /> Imprimir/PDF</BtnGhost>
            {doc && doc.status !== 'assinado' && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.borderLt}`, background: '#fff', color: C.espresso, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: subindo ? 'wait' : 'pointer' }}>
                <Upload size={13} /> {subindo ? 'Enviando…' : 'Anexar assinado'}
                <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} disabled={subindo} onChange={e => anexarAssinado(e.target.files?.[0] || null)} />
              </label>
            )}
            <BtnGhost onClick={onClose}>Fechar</BtnGhost>
          </div>
        </div>
        {loading ? <Load /> : !doc ? <Vazio titulo="Documento não encontrado" texto="" /> : (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 700, color: C.espresso }}>Relatório Mensal de Pausas Térmicas — NR-36 / Art. 253 CLT</div>
              <div style={{ fontSize: 12, color: C.gray }}>Competência {String(doc.competencia).slice(0, 7)}{Number(doc.versao ?? 1) > 1 ? ` · versão ${String(doc.versao)}${doc.versao_motivo ? ` (${String(doc.versao_motivo)})` : ''}` : ''}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 6, fontSize: 12.5, marginBottom: 12 }}>
              <div><b>Nome:</b> {snap.nome || '—'}</div><div><b>CPF:</b> {snap.cpf || '—'}</div>
              <div><b>Matrícula:</b> {snap.matricula || '—'}</div><div><b>PIS:</b> {snap.pis || '—'}</div>
              <div><b>Função:</b> {snap.funcao || '—'}</div><div><b>Setor:</b> {snap.setor || '—'}</div>
            </div>
            {detalhe.map((d, i) => (
              <div key={i} style={{ borderBottom: `1px solid ${C.beigeLt}`, padding: '6px 0' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: C.espresso }}>{fmtData(d.data)} <span style={{ fontSize: 11, color: C.gray, fontWeight: 400 }}>{d.jornada?.inicio && d.jornada?.fim ? `· jornada ${d.jornada.inicio}–${d.jornada.fim}` : ''}</span></div>
                {notaDiaDoc(d.ajuste) && <div style={{ fontSize: 11, color: C.gray }} data-testid="ciencia-originais">{notaDiaDoc(d.ajuste)}</div>}
                {(d.pausas || []).length === 0 ? <div style={{ fontSize: 11.5, color: C.gray, fontStyle: 'italic' }}>Sem pausa registrada.</div> :
                  (d.pausas || []).map((p, j) => <div key={j} style={{ fontSize: 12.5, lineHeight: 1.7 }}>{fim(p, d.ajuste)}{p.min != null && <span style={{ color: C.gray, fontSize: 11 }}> · {p.min} min</span>}</div>)}
              </div>
            ))}
            {nEst > 0 && (
              <div style={{ marginTop: 12, padding: 10, background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 8, fontSize: 11.5, color: '#92400E' }}>
                {nEst} pausa(s) deste período tiveram o horário de término estimado por falta de registro de saída. A estimativa considera a duração padrão de 20 minutos e não substitui o registro.
              </div>
            )}
            <div className="ps-print-assinatura" data-testid="ciencia-assinatura" style={{ marginTop: 24, borderTop: `1px solid ${C.borderLt}`, paddingTop: 16, fontSize: 12 }}>
              {doc.status === 'assinado' ? (
                <div style={{ color: C.green }}><b>✓ Assinado em {doc.assinado_em ? fmtDT(String(doc.assinado_em)) : ''}</b> · método {String(doc.metodo || '')} · hash {String(doc.hash_integridade || '').slice(0, 24)}…</div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                  <div style={{ flex: 1, borderTop: `1px solid ${C.espresso}`, paddingTop: 4, textAlign: 'center', color: C.gray }}>Assinatura do colaborador</div>
                  <div style={{ flex: 1, borderTop: `1px solid ${C.espresso}`, paddingTop: 4, textAlign: 'center', color: C.gray }}>Data</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ── SST ⑦ (#67): reconciliação do período ──────────────────────────────────────
// Veredito legal (só pausa insuficiente = desvio) SEPARADO do sinalizado (dias com jornada e
// ZERO pausa registrada + estimativa de não-realizada). Nunca somados — "estimado ≠ registrado".
type Reconc = {
  ok: boolean
  dias?: { desvio: number; pendente_confirmacao: number; conforme: number; sem_dado: number }
  leitura?: { insuficiente_legal: number; excesso_gestao_nao_infracao: number; esquecimento_tratado: number }
  sinalizado?: { dias_jornada_zero_pausa: number; dias_com_estimativa: number; pausas_nao_realizadas_estimadas: number; rotulo: string }
}
function ReconItem({ n, cor, label }: { n: number; cor: string; label: string }) {
  return <div style={{ flex: '1 1 120px' }}><div style={{ fontSize: 22, fontWeight: 800, color: cor, lineHeight: 1 }}>{n}</div><div style={{ fontSize: 11.5, color: C.espresso, marginTop: 3 }}>{label}</div></div>
}
function ReconciliacaoPanel({ companyId, ini, fim, chave }: { companyId: string; ini: string; fim: string; chave: string }) {
  const [r, setR] = useState<Reconc | null>(null)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try { const d = await rpc<Reconc>('fn_nr36_reconciliacao', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim }); if (vivo) setR(d) }
      catch { if (vivo) setR(null) }
    })()
    return () => { vivo = false }
  }, [companyId, ini, fim, chave])
  if (!r || !r.ok || !r.dias) return null
  const d = r.dias, sig = r.sinalizado, lei = r.leitura
  const total = d.desvio + d.pendente_confirmacao + d.conforme + d.sem_dado
  return (
    <div style={{ border: `1px solid ${C.borderLt}`, borderRadius: 14, padding: 16, marginBottom: 12, background: C.offwhite }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.espresso, marginBottom: 2 }}>Reconciliação do período</div>
      <div style={{ fontSize: 11.5, color: C.gray, marginBottom: 12 }}>{total} dia(s) apurado(s). O veredito legal conta só pausa insuficiente (feita e curta demais). Pausa sem hora de saída aguarda confirmação — nunca vira desvio no escuro.</div>

      {/* Veredito legal */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '12px 14px', background: C.beigeLt, borderRadius: 12, marginBottom: 10 }}>
        <ReconItem n={d.desvio} cor={C.red} label="Desvios provados (pausa insuficiente)" />
        <ReconItem n={d.pendente_confirmacao} cor={C.amber} label="Aguardando confirmação (aba Conferência)" />
        <ReconItem n={d.conforme} cor={C.green} label="Conformes" />
        {d.sem_dado > 0 && <ReconItem n={d.sem_dado} cor={C.gray} label="Sem jornada no ponto" />}
      </div>

      {/* por que confirmar pode AUMENTAR o desvio — a responsável precisa entender antes de estranhar */}
      <div style={{ fontSize: 11.5, color: C.gray, lineHeight: 1.55, marginBottom: 10 }}>
        Confirmar o fim de uma pausa aberta pode <b>aumentar</b> o número de desvios: ao amarrar o fim pela batida do ponto, um dia que estava “aguardando confirmação” pode revelar uma pausa abaixo do mínimo que antes não dava para avaliar. O número subir depois de confirmar é o dado ficando exato — não é piora.
      </div>

      {/* Sinalizado — à parte, nunca somado ao veredito */}
      {sig && (sig.dias_jornada_zero_pausa > 0 || sig.pausas_nao_realizadas_estimadas > 0) && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
          <AlertTriangle size={18} style={{ color: C.amber, flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: C.espresso, lineHeight: 1.55 }}>
            <b>Sinalizado — fora do veredito legal, a verificar.</b>
            <div style={{ marginTop: 4 }}>⚠️ {sig.rotulo}</div>
            {sig.pausas_nao_realizadas_estimadas > 0 && (
              <div style={{ marginTop: 4, color: C.amber }}>
                Estimativa: {sig.pausas_nao_realizadas_estimadas} pausa(s) devida(s) não realizada(s) em {sig.dias_com_estimativa} dia(s), pela exposição. É <b>estimativa</b> (o gatilho é por trabalho contínuo) — <b>nunca somada ao desvio</b>. Estimado ≠ registrado.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Como os eventos se classificam (as 5 classes → 3 leituras) */}
      {lei && (
        <div style={{ fontSize: 12, color: C.gray, lineHeight: 1.6 }}>
          Eventos de pausa por leitura: <b style={{ color: C.red }}>{lei.insuficiente_legal}</b> insuficiente (legal) · <b style={{ color: C.espresso }}>{lei.excesso_gestao_nao_infracao}</b> excesso (gestão, não é infração) · <b style={{ color: C.amber }}>{lei.esquecimento_tratado}</b> sem hora de saída (esquecimento → confirmação).
        </div>
      )}
    </div>
  )
}

function ModalProva({ companyId, cpf, nome, ini, fim, onClose }: { companyId: string; cpf: string; nome: string; ini: string; fim: string; onClose: () => void }) {
  const [linhas, setLinhas] = useState<ProvaLinha[]>([])
  const [colab, setColab] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => {
    try { const r = await rpc<{ linhas: ProvaLinha[]; colaborador: Record<string, unknown> }>('fn_nr36_relatorio_prova', { p_company_id: companyId, p_cpf: cpf, p_dt_ini: ini, p_dt_fim: fim }); setLinhas(r.linhas || []); setColab(r.colaborador) }
    catch { /* */ } finally { setLoading(false) }
  })() }, [companyId, cpf, ini, fim])
  return createPortal(
    <div onClick={onClose} className="ps-print-portal" style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
      <style>{CSS_IMPRESSAO}</style>
      <div onClick={e => e.stopPropagation()} className="ps-print-doc" style={{ background: C.offwhite, borderRadius: 14, maxWidth: 720, width: '100%', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.borderLt}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 11, color: C.gray, textTransform: 'uppercase', letterSpacing: 1 }}>Relatório de prova</div><div style={{ fontSize: 16, fontWeight: 700, color: C.espresso }}>{nome}</div></div>
          <span className="no-print"><BtnGhost onClick={() => window.print()}>Imprimir/PDF</BtnGhost></span>
        </div>
        <div style={{ padding: 16 }}>
          {colab && <div style={{ fontSize: 12, color: C.gray, marginBottom: 10 }}>{String(colab.funcao || '')} · matrícula {String(colab.matricula || '—')} · CPF {String(colab.cpf || cpf)}</div>}
          {loading ? <Load /> : linhas.length === 0 ? <Vazio titulo="Sem apuração" texto="Rode a Apuração do período antes." /> : (
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
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─────────────────────────────────── IMPORTAR (#52) ───────────────────────────────────
function AbaImportar({ companyId }: { companyId: string }) {
  const [podeSubir, setPodeSubir] = useState<boolean | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [linhas, setLinhas] = useState<LinhaImport[]>([])
  const [naoCasados, setNaoCasados] = useState<string[]>([])
  const [alertaEleg, setAlertaEleg] = useState<{ matched: number; naoEleg: number } | null>(null)
  const [parseErro, setParseErro] = useState('')
  const [busy, setBusy] = useState(false)
  const [resultado, setResultado] = useState<{ lidas: number; aceitas: number; rejeitadas: number; rejeitadas_detalhe: Rejeitada[] } | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => { (async () => {
    try { const ok = await rpc<boolean>('fn_nr36_pode_subir', { p_company_id: companyId }); setPodeSubir(!!ok) }
    catch { setPodeSubir(false) }
  })() }, [companyId])

  const escolher = async (f: File | null) => {
    setFile(f); setLinhas([]); setNaoCasados([]); setAlertaEleg(null); setParseErro(''); setResultado(null); setErro('')
    if (!f) return
    setBusy(true)
    try {
      const { linhas: rows, amostra } = await parseArquivo(f)
      if (rows.length === 0) {
        setParseErro('Não reconheci o layout do arquivo. Esperava um cabeçalho com Data/Entrada/Saída, ou blocos por pessoa (nome + coluna "Data"). Primeiras linhas lidas: ' + (amostra.join('  •  ') || '(arquivo vazio)'))
        return
      }
      // resolver nome→CPF quando não houver CPF na linha
      const semCpf = Array.from(new Set(rows.filter(r => !r.cpf && r._nome).map(r => r._nome as string)))
      let mapa: Record<string, { cpf: string | null; casado: boolean }> = {}
      if (semCpf.length > 0) {
        const res = await rpc<Array<{ nome: string; cpf: string | null; casado: boolean }>>('fn_nr36_resolver_nomes', { p_company_id: companyId, p_nomes: semCpf })
        mapa = Object.fromEntries((res || []).map(x => [norm(x.nome), { cpf: x.cpf, casado: x.casado }]))
      }
      const naoC: string[] = []
      const final = rows.map(r => {
        if (!r.cpf && r._nome) {
          const m = mapa[norm(r._nome)]
          if (m?.casado && m.cpf) r.cpf = m.cpf
          else if (!naoC.includes(r._nome)) naoC.push(r._nome)
        }
        return r
      })
      // aviso RD-51: fn_nr36_apurar IGNORA quem não é elegível → sem elegível a apuração fica vazia
      // (0 de N monitorados). Nunca deixar isso silencioso — vazio não é conformidade.
      const cpfs = Array.from(new Set(final.filter(l => l.cpf).map(l => l.cpf.replace(/\D/g, ''))))
      let naoEleg = cpfs.length
      try {
        const el = await rpc<{ colaboradores: Colab[] }>('fn_nr36_elegiveis_listar', { p_company_id: companyId })
        const termica = new Set((el.colaboradores || []).filter(c => c.termica).map(c => (c.cpf || '').replace(/\D/g, '')))
        naoEleg = cpfs.filter(cpf => !termica.has(cpf)).length
      } catch { /* na dúvida, mantém o aviso conservador (todos) */ }
      setAlertaEleg({ matched: cpfs.length, naoEleg })
      setLinhas(final); setNaoCasados(naoC)
    } catch (e) { setParseErro((e as Error).message) } finally { setBusy(false) }
  }

  const enviar = async () => {
    if (!file || linhas.length === 0) return
    // envia só as linhas com CPF resolvido; nomes sem cadastro ficam na prévia (não vão pro banco)
    const payload = linhas.filter(l => l.cpf).map(l => ({ cpf: l.cpf, data: l.data, inicio: l.inicio, fim: l.fim, duracao_seg: l.duracao_seg, tipo: l.tipo }))
    if (payload.length === 0) { setErro('Nenhum nome do arquivo casou com o cadastro de colaboradores — nada a importar. Cadastre-os em Compliance › Funcionários e tente de novo.'); return }
    setBusy(true); setErro(''); setResultado(null)
    try {
      const buf = await file.arrayBuffer()
      const hash = await sha256(buf)
      const ano = new Date().getFullYear()
      const path = `${companyId}/nr36/${ano}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`
      const up = await supabase.storage.from('compliance-pausas').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
      if (up.error) throw new Error('Falha no upload do arquivo: ' + up.error.message)
      const datas = linhas.map(l => l.data).filter(Boolean).sort()
      const reg = await rpc<{ ok: boolean; upload_id?: string; erro?: string; mensagem?: string }>('fn_nr36_upload_registrar', {
        p_company_id: companyId, p_arquivo_nome: file.name, p_arquivo_path: path, p_arquivo_hash: hash,
        p_bytes: file.size, p_mime: file.type || null, p_periodo_ini: datas[0] || null, p_periodo_fim: datas[datas.length - 1] || null,
      })
      if (!reg.ok || !reg.upload_id) throw new Error(reg.mensagem || reg.erro || 'Falha ao registrar o upload.')
      const proc = await rpc<{ ok: boolean; lidas: number; aceitas: number; rejeitadas: number; rejeitadas_detalhe: Rejeitada[]; erro?: string; mensagem?: string }>('fn_nr36_upload_processar', { p_upload_id: reg.upload_id, p_linhas: payload })
      // #107: zero linha aceita = importação FALHOU (nunca "processado" calado) — mensagem clara para quem enviou
      if (!proc.ok) throw new Error(proc.mensagem || proc.erro || 'Falha ao processar as linhas.')
      setResultado({ lidas: proc.lidas, aceitas: proc.aceitas, rejeitadas: proc.rejeitadas, rejeitadas_detalhe: proc.rejeitadas_detalhe || [] })
      setFile(null); setLinhas([])
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }

  if (podeSubir === null) return <Load />
  if (podeSubir === false) return (
    <div style={{ background: '#fff', border: `1px dashed ${C.borderLt}`, borderRadius: 14, padding: '32px 20px', textAlign: 'center' }}>
      <ShieldAlert size={34} style={{ color: C.amber, margin: '0 auto' }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: C.espresso, marginTop: 10 }}>Você não tem permissão para importar</div>
      <div style={{ fontSize: 13, color: C.gray, marginTop: 5 }}>A importação de relatórios de pausa é restrita ao Técnico de Segurança do Trabalho ou ao responsável pelo Compliance. Fale com o responsável pelo compliance.</div>
    </div>
  )

  return (
    <div>
      <p style={{ fontSize: 12.5, color: C.gray, marginBottom: 12 }}>Suba o relatório de ponto (CSV ou XLSX do relógio) com as pausas. O arquivo é guardado com hash SHA-256; nada é apagado (substituição fica no Histórico).</p>

      {!resultado && (
        <div style={{ ...card(), flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...btnStyle(false), cursor: 'pointer' }}>
              <Upload size={14} /> Escolher arquivo
              <input type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={e => void escolher(e.target.files?.[0] || null)} />
            </label>
            {file && <span style={{ fontSize: 13, color: C.espresso }}>{file.name} <span style={{ color: C.gray }}>({(file.size / 1024).toFixed(0)} KB)</span></span>}
          </div>

          {busy && !resultado && <div style={{ fontSize: 12.5, color: C.gray }}>Lendo o arquivo…</div>}
          {parseErro && <div style={erroBox()}>{parseErro}</div>}

          {linhas.length > 0 && (
            <div>
              <div style={{ fontSize: 12.5, color: C.espresso, marginBottom: 6 }}><b>{linhas.length}</b> linha(s) lidas. Confira o mapeamento antes de importar (as colunas são detectadas pelo cabeçalho do arquivo; se o relatório da IOPoint tiver nomes diferentes, me avise para ajustar).</div>
              {naoCasados.length > 0 && (
                <div style={{ background: C.amberBg, border: `1px solid ${C.amber}33`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: C.espresso, marginBottom: 8 }}>
                  <b>{naoCasados.length} nome(s) sem CPF no cadastro</b> (serão rejeitados; cadastre em Compliance › Funcionários): {naoCasados.slice(0, 8).join(' · ')}{naoCasados.length > 8 ? '…' : ''}
                </div>
              )}
              {alertaEleg && alertaEleg.naoEleg > 0 && (
                <div style={{ background: C.redBg, border: `1px solid ${C.red}33`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: C.espresso, marginBottom: 8 }}>
                  <b>{alertaEleg.naoEleg} de {alertaEleg.matched} colaborador(es) do arquivo NÃO estão marcados como elegíveis à pausa térmica.</b> As pausas entram no histórico, mas a apuração <b>ignora quem não é elegível</b> — eles não serão apurados e o Painel ficará vazio para eles. <b>Vazio não é conformidade.</b> Marque-os em <b>Configuração › Elegíveis</b> (dá para marcar por função) antes de contar com o painel.
                </div>
              )}
              <div style={{ overflowX: 'auto', maxHeight: 260, border: `1px solid ${C.borderLt}`, borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ textAlign: 'left', color: C.gray, background: C.beigeLt }}>
                    <th style={th()}>CPF/Nome</th><th style={th()}>Data</th><th style={th()}>Início</th><th style={th()}>Fim</th><th style={th()}>Tipo</th>
                  </tr></thead>
                  <tbody>
                    {linhas.slice(0, 50).map((l, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.beigeLt}` }}>
                        <td style={td()}>{l.cpf || <span style={{ color: C.amber }}>{l._nome || '—'} (sem CPF)</span>}</td>
                        <td style={td()}>{l.data || '—'}</td><td style={td()}>{l.inicio || '—'}</td>
                        <td style={td()}>{l.fim || <span style={{ color: C.gray }}>em aberto</span>}</td><td style={td()}>{l.tipo || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {linhas.length > 50 && <div style={{ fontSize: 11, color: C.gray, marginTop: 4 }}>Mostrando 50 de {linhas.length}.</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <Btn onClick={enviar} disabled={busy}><Upload size={14} /> {busy ? 'Importando…' : `Importar ${linhas.length} pausas`}</Btn>
              </div>
            </div>
          )}
          {erro && <div style={erroBox()}>{erro}</div>}
        </div>
      )}

      {resultado && (
        <div style={{ ...card(), flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle2 size={18} style={{ color: C.green }} /><b style={{ color: C.espresso }}>Importação concluída</b></div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>Lidas: <b>{resultado.lidas}</b></span>
            <span style={{ fontSize: 13, color: C.green }}>Aceitas: <b>{resultado.aceitas}</b></span>
            <span style={{ fontSize: 13, color: resultado.rejeitadas > 0 ? C.red : C.gray }}>Rejeitadas: <b>{resultado.rejeitadas}</b></span>
          </div>
          {resultado.rejeitadas_detalhe.length > 0 && (
            <div style={{ overflowX: 'auto', border: `1px solid ${C.borderLt}`, borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left', color: C.gray, background: C.beigeLt }}><th style={th()}>Linha</th><th style={th()}>CPF</th><th style={th()}>Motivo</th></tr></thead>
                <tbody>
                  {resultado.rejeitadas_detalhe.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${C.beigeLt}` }}><td style={td()}>{r.linha}</td><td style={td()}>{r.cpf || '—'}</td><td style={{ ...td(), color: C.red }}>{motivoLabel(r.motivo)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div><Btn onClick={() => setResultado(null)}>Importar outro arquivo</Btn></div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────── HISTÓRICO ───────────────────────────────────
function AbaHistorico({ companyId }: { companyId: string }) {
  const hoje = new Date()
  const [ini, setIni] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1)))
  const [fim, setFim] = useState(iso(hoje))
  const [rows, setRows] = useState<UploadRow[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  const [arquivadas, setArquivadas] = useState<PausaHistorico[]>([])
  const carregar = useCallback(async () => {
    setLoading(true); setErro('')
    try {
      const r = await rpc<UploadRow[]>('fn_nr36_upload_listar', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim }); setRows(Array.isArray(r) ? r : [])
      // histórico de confirmações é complementar: se falhar, a lista de uploads continua valendo
      try {
        const h = await rpc<PausaHistorico[]>('fn_nr36_pausas_historico_listar', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim }); setArquivadas(Array.isArray(h) ? h : [])
      } catch { setArquivadas([]) }
    }
    catch (e) { setErro((e as Error).message) } finally { setLoading(false) }
  }, [companyId, ini, fim])
  useEffect(() => { void carregar() }, [carregar])

  const baixar = async (u: UploadRow) => {
    if (!u.arquivo_path) { alert('Sem arquivo original registrado.'); return }
    const { data, error } = await supabase.storage.from('compliance-pausas').createSignedUrl(u.arquivo_path, 60)
    if (error || !data?.signedUrl) { alert('Não consegui gerar o link: ' + (error?.message || 'desconhecido')); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <Campo label="De"><input type="date" style={inp()} value={ini} onChange={e => setIni(e.target.value)} /></Campo>
        <Campo label="Até"><input type="date" style={inp()} value={fim} onChange={e => setFim(e.target.value)} /></Campo>
      </div>
      {erro && <div style={erroBox()}>{erro}</div>}
      {loading ? <Load /> : rows.length === 0 ? <Vazio titulo="Nenhum upload no período" texto="Os relatórios importados aparecem aqui com hash e autoria, para auditoria." /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={th()}>Arquivo</th><th style={th()}>Período</th><th style={th()}>Linhas</th><th style={th()}>Enviado por</th><th style={th()}>Quando</th><th style={th()}>Status</th><th style={th()}>Hash</th><th style={th()}></th>
            </tr></thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id} style={{ borderBottom: `1px solid ${C.beigeLt}`, opacity: u.status === 'substituido' ? 0.6 : 1 }}>
                  <td style={td()}><div style={{ fontWeight: 600, color: C.espresso }}>{u.arquivo_nome}</div></td>
                  <td style={td()}>{fmtData(u.periodo_inicio)} – {fmtData(u.periodo_fim)}</td>
                  <td style={td()}>{u.linhas_lidas ?? 0} lidas · <span style={{ color: C.green }}>{u.linhas_aceitas ?? 0} ok</span> · <span style={{ color: (u.linhas_rejeitadas ?? 0) > 0 ? C.red : C.gray }}>{u.linhas_rejeitadas ?? 0} rej.</span></td>
                  <td style={td()}>{u.enviado_por_email || '—'}</td>
                  <td style={td()}>{fmtDT(u.enviado_em)}</td>
                  <td style={td()}>{u.status === 'substituido' ? <span style={{ color: C.gray }}>substituído</span>
                    : u.status === 'falhou' ? <span style={{ color: C.red, fontWeight: 600 }} title={u.observacao || ''}>falhou — nada importado, reenvie</span>
                    : u.status === 'pendente' ? <span style={{ color: C.amber }}>não processado — reenvie</span>
                    : <span style={{ color: C.green }}>{u.status}</span>}</td>
                  <td style={{ ...td(), fontFamily: 'monospace', fontSize: 10.5, color: C.gray }} title={u.arquivo_hash}>{u.arquivo_hash?.slice(0, 10)}…</td>
                  <td style={td()}>{u.arquivo_path && <BtnGhost onClick={() => void baixar(u)}><Download size={13} /> Baixar</BtnGhost>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: C.gray, marginTop: 8 }}>🔒 Uploads nunca são apagados. Para corrigir, importe o novo e use &ldquo;Substituir&rdquo; — o antigo fica marcado, preservando a trilha (RD-30).</div>
        </div>
      )}
      {!loading && arquivadas.length > 0 && (
        <div data-testid="nr36-historico-confirmacoes" style={{ marginTop: 22 }}>
          <h3 style={secTitle()}>Confirmações guardadas como histórico</h3>
          <p style={{ fontSize: 12.5, color: C.gray, margin: '0 0 10px' }}>Registros corrigidos por leitura errada do arquivo. As confirmações feitas nesses registros continuam guardadas aqui, mas não entram mais no cálculo.</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
                <th style={th()}>Colaborador</th><th style={th()}>Dia</th><th style={th()}>Registro lido</th><th style={th()}>Fim confirmado</th><th style={th()}>Guardado em</th><th style={th()}>Motivo</th>
              </tr></thead>
              <tbody>
                {arquivadas.map((a, i) => (
                  <tr key={`${a.cpf}-${a.data}-${a.inicio}-${i}`} style={{ borderBottom: `1px solid ${C.beigeLt}` }}>
                    <td style={td()}>{a.nome || a.cpf}</td>
                    <td style={td()}>{fmtData(a.data)}</td>
                    <td style={td()}>{a.inicio ?? '—'}–{a.fim_arquivo ?? 'aberta'}</td>
                    <td style={td()}>{a.fim_confirmado ?? '—'}</td>
                    <td style={td()}>{fmtDT(a.arquivado_em)}</td>
                    <td style={{ ...td(), color: C.gray, maxWidth: 360 }}>{a.motivo}{a.referencia ? ` (${a.referencia})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────── CONFIGURAÇÃO (regras + elegíveis) ───────────────────────────────────
function AbaConfig({ companyId }: { companyId: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SecaoRegras companyId={companyId} />
      <SecaoElegiveis companyId={companyId} />
    </div>
  )
}

function SecaoRegras({ companyId }: { companyId: string }) {
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

  const seed = async () => { try { await rpc('fn_nr36_regra_seed_padrao', { p_company_id: companyId }); await carregar() } catch (e) { setErro((e as Error).message) } }
  const salvar = async (r: Regra) => {
    setErro(''); setMsg('')
    try { await rpc('fn_nr36_regra_salvar', { p_company_id: companyId, p_tipo: r.tipo, p_nome: r.nome, p_parametros: r.parametros, p_ativo: r.ativo }); setMsg('Regra salva.'); await carregar() }
    catch (e) { setErro((e as Error).message) }
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
      <h2 style={secTitle()}>Regras</h2>
      <p style={{ fontSize: 12.5, color: C.gray, marginBottom: 12 }}>As duas pausas têm fatos geradores distintos (ergonomia × térmico) e <b>coexistem</b>. Parâmetros editáveis; a <b>base legal</b> de cada regra fica visível — é o que sustenta a defesa em fiscalização. Confira com o jurídico/SST.</p>
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
              {/* #76 (CEO 03/10): a régua de mínimo e máximo é da empresa e aparece no motivo de cada desvio */}
              <Campo label="Excesso a partir de (min)"><input type="number" style={inp()} data-testid="regua-excesso" value={Number(r.parametros.tolerancia_excesso_min ?? 23)} onChange={e => setParam(r.tipo, { tolerancia_excesso_min: Number(e.target.value) })} /></Campo>
              <Campo label="Limite inferior (min)"><input type="number" step="0.01" style={inp()} data-testid="regua-limite-inferior" placeholder={`vazio = ${Number(r.parametros.pausa_min ?? 20)} (sem tolerância)`}
                value={r.parametros.limite_inferior_min == null ? '' : Number(r.parametros.limite_inferior_min)}
                onChange={e => setParam(r.tipo, { limite_inferior_min: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
              <div style={{ flex: 2, fontSize: 11.5, color: C.gray, alignSelf: 'center' }}>Art.253: 20 min de repouso a cada 1h40 (100 min) de trabalho contínuo, computado como trabalho efetivo. {textoRegua(reguaDe(r.parametros))}.</div>
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

function SecaoElegiveis({ companyId }: { companyId: string }) {
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
  const algumMarcado = colabs.some(c => c.psico || c.termica)

  if (loading) return <Load />
  return (
    <div>
      <h2 style={secTitle()}>Elegíveis</h2>
      {!algumMarcado && (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amber}33`, borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: C.espresso, marginBottom: 10 }}>
          Nenhum colaborador marcado como elegível. <b>Sem elegíveis, a apuração não tem quem apurar.</b> Selecione por função abaixo para começar.
        </div>
      )}
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

// ─────────────────────────────────── parse de arquivo ───────────────────────────────────
async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const txt = (v: unknown) => (v == null ? '' : String(v).trim())

// lê CSV ou XLSX → linhas POSICIONAIS (array de células). Não assume cabeçalho — o layout
// (tabular × hierárquico) é decidido depois. includeEmpty preserva a estrutura por blocos.
async function lerRowsRaw(file: File): Promise<string[][]> {
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await file.arrayBuffer())
    const ws = wb.worksheets[0]
    if (!ws) return []
    const out: string[][] = []
    ws.eachRow({ includeEmpty: true }, (row) => {
      out.push((row.values as unknown[]).slice(1).map(v => txt(typeof v === 'object' && v && 'text' in v ? (v as { text: string }).text : v)))
    })
    return out
  }
  const text = await file.text()
  const linhas = text.split(/\r?\n/)
  while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop()
  if (linhas.length === 0) return []
  const delim = (linhas[0].match(/;/g)?.length || 0) > (linhas[0].match(/,/g)?.length || 0) ? ';' : ','
  return linhas.map(l => l.split(delim).map(c => c.replace(/^"|"$/g, '').trim()))
}

// ── layout HIERÁRQUICO (relatório IOPoint): blocos por pessoa (nome + col "Data") ──
const IGNORAR_H = ['subtotal de eventos', 'total de eventos', 'emitido em', 'relatório', 'relatorio', '(visitante)', 'período', 'periodo']
const ABERTO_H = new Set(['', '-', '- ', ' -'])
const parseDataH = (s: string): string | null => { const b = txt(s).split(' - ')[0]; const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(b); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
const parseDataHoraH = (s: string): string | null => { const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(txt(s)); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? '00'}-03:00` : null }
const parseDurH = (s: string): number | null => { const m = /^(\d+):(\d{2}):(\d{2})$/.exec(txt(s)); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null }

function parseHierarquico(rows: string[][]): { linhas: LinhaImport[]; descartadas: number } {
  let pessoa: string | null = null
  const linhas: LinhaImport[] = []
  let descartadas = 0
  for (const raw of rows) {
    const r = [...raw, '', '', '', '', '', ''].slice(0, 6)
    const c0 = txt(r[0]), c1 = txt(r[1])
    if (c0 && c1.toLowerCase() === 'data') { pessoa = c0; continue }          // cabeçalho de bloco
    if (IGNORAR_H.some(p => c0.toLowerCase().startsWith(p))) continue          // ruído
    const data = parseDataH(c1)
    if (!c0 && data) {                                                        // evento
      const inicio = parseDataHoraH(r[3])
      const fim = ABERTO_H.has(txt(r[4])) ? null : parseDataHoraH(r[4])       // pausa em aberto → null (nunca zerar)
      if (!pessoa || !inicio) { descartadas++; continue }
      linhas.push({ cpf: '', data, inicio, fim, duracao_seg: parseDurH(r[5]), tipo: 'termica_253', _nome: pessoa })
      continue
    }
    if (c0 || c1) descartadas++
  }
  return { linhas, descartadas }
}

// ── layout TABULAR (cabeçalho na 1ª linha: CPF/Nome/Data/Entrada/Saída) — fallback ──
const pick = (o: Record<string, string>, keys: string[]) => { for (const k of keys) if (o[k]) return o[k]; return '' }
function toISODate(v: string): string {
  if (!v) return ''
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const isoM = v.match(/^(\d{4}-\d{2}-\d{2})/); if (isoM) return isoM[1]
  return v.slice(0, 10)
}
function toTS(data: string, hora: string): string {
  if (!hora) return ''
  if (/\d{4}-\d{2}-\d{2}T/.test(hora) || /\d{4}-\d{2}-\d{2}\s\d{2}:/.test(hora)) return hora
  const d = toISODate(data)
  const hm = hora.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!d || !hm) return ''
  return `${d}T${hm[1].padStart(2, '0')}:${hm[2]}:${hm[3] || '00'}-03:00`
}
function parseTabular(rows: string[][]): LinhaImport[] {
  if (rows.length < 2) return []
  const headers = rows[0].map(norm)
  const objs = rows.slice(1).map(vals => { const o: Record<string, string> = {}; headers.forEach((h, i) => { if (h) o[h] = vals[i] ?? '' }); return o }).filter(o => Object.values(o).some(v => v))
  return objs.map(o => {
    const cpf = pick(o, ['cpf']).replace(/\D/g, '')
    const nome = pick(o, ['nome', 'colaborador', 'funcionario', 'func', 'nome_colaborador'])
    const data = toISODate(pick(o, ['data', 'dia', 'data_pausa', 'data_movto', 'competencia']))
    const inicio = toTS(data, pick(o, ['inicio', 'entrada', 'hora_inicio', 'inicio_pausa', 'ini', 'hora_entrada']))
    const fimRaw = pick(o, ['fim', 'saida', 'hora_fim', 'fim_pausa', 'hora_saida'])
    const fim = fimRaw && !ABERTO_H.has(fimRaw) ? toTS(data, fimRaw) : null
    const tipoRaw = pick(o, ['tipo', 'pausa', 'tipo_pausa', 'categoria']).toLowerCase()
    const tipo = tipoRaw.includes('term') || tipoRaw.includes('253') ? 'termica_253'
      : tipoRaw.includes('psico') || tipoRaw.includes('36') ? 'psicofisiologica'
      : (tipoRaw || 'termica_253')
    const dur = pick(o, ['duracao_seg']) ? Number(pick(o, ['duracao_seg']))
      : pick(o, ['duracao', 'minutos', 'tempo']) ? Math.round(Number(String(pick(o, ['duracao', 'minutos', 'tempo'])).replace(',', '.')) * 60) : null
    return { cpf, data, inicio, fim, duracao_seg: Number.isFinite(dur as number) ? (dur as number) : null, tipo, _nome: nome || undefined } as LinhaImport
  }).filter(l => l.data && (l.inicio || l.fim))
}

// detecta o layout e parseia. `amostra` = primeiras linhas lidas (p/ erro honesto, RD-51).
async function parseArquivo(file: File): Promise<{ linhas: LinhaImport[]; descartadas: number; amostra: string[] }> {
  const rows = await lerRowsRaw(file)
  const amostra = rows.filter(r => r.some(c => txt(c))).slice(0, 3).map(r => r.map(txt).filter(Boolean).join(' | ').slice(0, 90))
  const ehHier = rows.slice(0, 30).some(r => txt(r?.[1]).toLowerCase() === 'data' && txt(r?.[0]) !== '')
  if (ehHier) { const h = parseHierarquico(rows); return { linhas: h.linhas, descartadas: h.descartadas, amostra } }
  return { linhas: parseTabular(rows), descartadas: 0, amostra }
}

// ─────────────────────────────────── UI helpers ───────────────────────────────────
// SST ③b · Conferência das pausas sem hora de saída (546). O sistema SUGERE, a responsável
// confirma. Dois níveis VISUALMENTE distintos: batida do ponto (forte) × estimativa (fraca).
// Lote com prévia + dupla confirmação acima de N; desfazer por período (caminho de volta).
type PendenteRow = { pausa_id: string; cpf: string; colaborador: string; data: string; classe_evento: string; inicio_local: string; fim_sugerido_local: string; fim_sugerido_tipo: string; batida_local: string | null; sem_saida?: boolean }
function AbaConferencia({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<PendenteRow[]>([])
  const [carregando, setCarregando] = useState(false)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState(''); const [okMsg, setOkMsg] = useState('')
  // #256 · editor das marcações do dia (Saída / Retorno / Ignorar)
  const [editor, setEditor] = useState<{ cpf: string; data: string; colaborador: string; marcasIniciais?: Marca[] } | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(''); setOkMsg('')
    try {
      const { data, error } = await supabase.rpc('fn_nr36_pausas_pendentes_listar', { p_company_id: companyId, p_limite: 2000 })
      if (error) throw error
      setRows((data as PendenteRow[] | null) ?? [])
    } catch (e) { setErro((e as Error).message) } finally { setCarregando(false) }
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  const fortes = useMemo(() => rows.filter(r => r.fim_sugerido_tipo === 'batida_forte'), [rows])
  const fracas = useMemo(() => rows.filter(r => r.fim_sugerido_tipo === 'inferencia_fraca'), [rows])

  async function confirmarUm(id: string, acao: string, fimManual?: string) {
    setBusy(true); setErro(''); setOkMsg('')
    try {
      const { data, error } = await supabase.rpc('fn_nr36_confirmar_fim_pausa', { p_pausa_id: id, p_acao: acao, p_fim_manual: fimManual ?? null })
      if (error) throw error
      const r = data as { ok?: boolean; erro?: string } | null
      if (!r?.ok) throw new Error(r?.erro ?? 'falha ao confirmar')
      await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }
  async function confirmarLote(ids: string[], acao: string, rotulo: string) {
    if (ids.length === 0) return
    if (!window.confirm(`Confirmar ${ids.length} pausa(s) — ${rotulo}. Isso grava o fim de cada uma; você pode desfazer depois por período. Continuar?`)) return
    if (ids.length > 50 && !window.confirm(`São ${ids.length} de uma vez. Confirme novamente para prosseguir.`)) return
    setBusy(true); setErro(''); setOkMsg('')
    try {
      const { data, error } = await supabase.rpc('fn_nr36_confirmar_fim_lote', { p_pausa_ids: ids, p_acao: acao })
      if (error) throw error
      const r = data as { ok?: boolean; confirmados?: number; erro?: string } | null
      if (!r?.ok) throw new Error(r?.erro ?? 'falha no lote')
      setOkMsg(`${r.confirmados} confirmada(s).`); await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }
  async function corrigir(id: string, dataDia: string) {
    const hhmm = window.prompt('Horário real do fim da pausa (HH:MM):')
    if (!hhmm) return
    if (!/^\d{1,2}:\d{2}$/.test(hhmm.trim())) { setErro('Horário inválido — use HH:MM.'); return }
    await confirmarUm(id, 'corrigir', `${dataDia}T${hhmm.trim().padStart(5, '0')}:00-03:00`)
  }
  async function desfazerPeriodo() {
    const ini = window.prompt('Desfazer confirmações a partir de (AAAA-MM-DD):'); if (!ini) return
    const fim = window.prompt('até (AAAA-MM-DD):', ini); if (!fim) return
    if (!window.confirm(`Desfazer as confirmações entre ${ini} e ${fim}? Elas voltam a pendentes.`)) return
    setBusy(true); setErro(''); setOkMsg('')
    try {
      const { data, error } = await supabase.rpc('fn_nr36_desfazer_amarracao_periodo', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
      if (error) throw error
      const r = data as { ok?: boolean; desfeitas?: number; erro?: string } | null
      if (!r?.ok) throw new Error(r?.erro ?? 'falha ao desfazer')
      setOkMsg(`${r.desfeitas} confirmação(ões) desfeita(s).`); await carregar()
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }

  const btn = (bg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', background: bg, color: '#fff', opacity: busy ? 0.6 : 1 })
  const btnGhost: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${C.borderLt}`, borderRadius: 7, padding: '4px 8px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: '#fff', color: C.espresso }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={secTitle()}>Conferência — pausas sem hora de saída</div>
        <div style={{ fontSize: 13, color: C.gray }}>O sistema <b>sugere</b> o fim pela batida do ponto; <b>você confirma</b>. Cada horário guarda a origem — o relatório declara o que foi confirmado pelo ponto e o que é estimativa.</div>
        {/* #256 · quando falta uma batida, os pares do relatório deslizam (retorno lido como saída) */}
        <div style={{ fontSize: 12.5, color: C.espresso, marginTop: 6 }}>Pausa de 1h ou mais, com intervalos de ~20 min entre elas? Provavelmente faltou uma batida e os horários ficaram trocados. Use <b>Saída/retorno</b> na linha para dizer o que cada horário do dia é.</div>
      </div>

      {erro && <div style={{ background: C.redBg, color: C.red, borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 10 }}>{erro}</div>}
      {okMsg && <div style={{ background: C.greenBg, color: C.green, borderRadius: 8, padding: '9px 12px', fontSize: 12.5, marginBottom: 10 }}><CheckCircle2 size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />{okMsg}</div>}

      {/* #587 · auditoria de batidas: o sistema sugere, a responsável confirma com justificativa */}
      <AuditoriaBatidas companyId={companyId} onRevisar={(d) => setEditor(d)} />

      {/* Prévia + lote separado por confiabilidade */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: C.blueBg, border: `1px solid ${C.blue}22`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: C.espresso, flex: '1 1 260px' }}>
          <b>{rows.length}</b> pendente(s) · <b style={{ color: C.green }}>{fortes.length}</b> pela batida do ponto (forte) · <b style={{ color: C.amber }}>{fracas.length}</b> pela estimativa de 20&nbsp;min (fraca). Os dois grupos têm confiabilidade diferente — confirme os fortes e olhe os fracos com calma.
        </div>
        <button disabled={busy || fortes.length === 0} style={btn(C.green)} onClick={() => confirmarLote(fortes.map(r => r.pausa_id), 'confirmar_ponto', `${fortes.length} pela batida do ponto`)}><CheckCircle2 size={14} /> Confirmar os {fortes.length} pela batida</button>
        <button disabled={busy || fracas.length === 0} style={btn(C.amber)} onClick={() => confirmarLote(fracas.map(r => r.pausa_id), 'confirmar_estimativa', `${fracas.length} pela estimativa`)}><AlertTriangle size={14} /> Confirmar os {fracas.length} pela estimativa</button>
        <button disabled={busy} style={{ ...btnGhost, padding: '7px 12px' }} onClick={desfazerPeriodo}><History size={13} /> Desfazer por período</button>
        <button disabled={carregando} style={{ ...btnGhost, padding: '7px 12px' }} onClick={carregar}><RefreshCw size={13} /> Atualizar</button>
      </div>

      {carregando ? <div style={{ color: C.gray, padding: 24 }}>Carregando…</div>
        : rows.length === 0 ? <Vazio titulo="Nenhuma pausa pendente" texto="Todas as pausas têm hora de saída registrada ou confirmada. Nada a conferir." />
        : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={{ padding: '7px 8px' }}>Colaborador</th><th style={{ padding: '7px 8px' }}>Dia</th><th style={{ padding: '7px 8px' }}>Início</th><th style={{ padding: '7px 8px' }}>Fim provável</th><th style={{ padding: '7px 8px' }}>Ações</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const forte = r.fim_sugerido_tipo === 'batida_forte'
                return (
                  <tr key={r.pausa_id} style={{ borderBottom: `1px solid ${C.beigeLt}` }}>
                    <td style={{ padding: '8px', fontWeight: 600, color: C.espresso }}>{r.colaborador}</td>
                    <td style={{ padding: '8px', color: C.gray }}>{r.data.split('-').reverse().join('/')}</td>
                    {/* #93 · horário do início estava sem cor e herdava um tom claro do ambiente,
                        ficando ilegível. Fixa no Espresso, igual aos demais dados da linha. */}
                    <td style={{ padding: '8px', color: C.espresso, fontWeight: 600 }}>
                      {r.sem_saida
                        ? <span data-testid={`conf-sem-saida-${r.pausa_id}`}>retorno {r.inicio_local} <span style={{ fontSize: 10.5, fontWeight: 700, color: C.amber, background: C.amberBg, padding: '2px 7px', borderRadius: 20 }}>saída não registrada</span></span>
                        : r.inicio_local}
                    </td>
                    <td style={{ padding: '8px' }}>
                      {r.sem_saida ? <span style={{ fontSize: 12, color: C.gray }}>informe a saída em Saída/retorno</span> : <>
                      <span style={{ fontWeight: 700, color: C.espresso }}>{r.fim_sugerido_local}</span>{' '}
                      {forte
                        ? <span style={{ fontSize: 10.5, fontWeight: 700, color: C.green, background: C.greenBg, padding: '2px 7px', borderRadius: 20 }}>batida do ponto {r.batida_local}</span>
                        : <span style={{ fontSize: 10.5, fontWeight: 700, color: C.amber, background: C.amberBg, padding: '2px 7px', borderRadius: 20 }}>estimativa · o ponto não ajuda</span>}
                      </>}
                    </td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                      {!r.sem_saida && <>
                      <button style={{ ...btnGhost, color: forte ? C.green : C.amber, borderColor: (forte ? C.green : C.amber) + '55', marginRight: 4 }} onClick={() => confirmarUm(r.pausa_id, forte ? 'confirmar_ponto' : 'confirmar_estimativa')}>Confirmar</button>
                      <button style={{ ...btnGhost, marginRight: 4 }} onClick={() => corrigir(r.pausa_id, r.data)}>Corrigir</button>
                      </>}
                      <button style={{ ...btnGhost, marginRight: 4 }} data-testid={`conf-marcas-${r.pausa_id}`} title="Dizer se cada horário do dia é saída ou retorno da pausa"
                        onClick={() => setEditor({ cpf: r.cpf, data: r.data, colaborador: r.colaborador })}>Saída/retorno</button>
                      <button style={btnGhost} onClick={() => confirmarUm(r.pausa_id, 'indeterminado')}>Não sei</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editor && <EditorMarcasDia companyId={companyId} {...editor} onFechar={() => setEditor(null)}
        onSalvo={async (msg) => { setEditor(null); await carregar(); setOkMsg(msg) }} />}
    </div>
  )
}

// #256 · Editor das marcações de um colaborador num dia. O relatório traz a pausa em pares (início, fim); quando falta
// uma batida o par desliza. A responsável diz o que cada horário é — Saída, Retorno ou Ignorar (entrada do turno,
// almoço) — e pode acrescentar o horário que faltou. A prévia mostra as pausas que vão ficar; salvar relê o dia
// (fn_nr36_reler_dia: a leitura anterior vai para o histórico) e dá para desfazer.
// #587 (CEO 02/10): a batida ORIGINAL não muda; o horário digitado diz de onde veio (catraca | conferido com o
// colaborador) e fica numa camada à parte. Se sobrar retorno sem saída (ou saída sem retorno), só grava marcando,
// de propósito, que não se sabe o horário — foi assim que os horários da catraca deixaram de ser gravados.
function EditorMarcasDia({ companyId, cpf, data, colaborador, marcasIniciais, onFechar, onSalvo }: { companyId: string; cpf: string; data: string; colaborador: string; marcasIniciais?: Marca[]; onFechar: () => void; onSalvo: (msg: string) => void }) {
  const [marcas, setMarcas] = useState<Marca[]>(marcasIniciais ?? [])
  // #587 · ANTES (como o dia está hoje) × DEPOIS (prévia) e justificativa obrigatória para gravar
  const [antes, setAntes] = useState<PausaRelida[]>([])
  const [justificativa, setJustificativa] = useState('')
  const origem: 'sugestao' | 'manual' = marcasIniciais ? 'sugestao' : 'manual'
  const [podeDesfazer, setPodeDesfazer] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [novaHora, setNovaHora] = useState(''); const [novoPapel, setNovoPapel] = useState<PapelMarca>('saida')
  const [novaOrigem, setNovaOrigem] = useState<OrigemAjuste | ''>('')
  const [ajusteDia, setAjusteDia] = useState<AjusteDia | null>(null)
  const [pendCiente, setPendCiente] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const r = await rpc<{ ok: boolean; linhas: LinhaPausaDia[]; pode_desfazer: boolean; ajuste?: AjusteDia | null }>('fn_nr36_marcas_dia', { p_company_id: companyId, p_cpf: cpf, p_data: data })
        if (vivo) {
          const aj = r.ajuste ?? null
          // horário digitado antes segue com a origem que já tem na camada de ajuste
          const atuais = marcasDasPausas(r.linhas || []).map(m => {
            if (m.origem !== 'manual' || m.papel === 'ignorar') return m
            const a = ajusteDe(aj, m.hora, m.papel)
            return a ? { ...m, origem_ajuste: a.origem } : m
          })
          setAjusteDia(aj); setAntes(parearMarcas(atuais)); setPodeDesfazer(!!r.pode_desfazer)
          if (!marcasIniciais) setMarcas(atuais)
        }
      } catch (e) { if (vivo) setErro((e as Error).message) } finally { if (vivo) setCarregando(false) }
    })()
    return () => { vivo = false }
  }, [companyId, cpf, data, marcasIniciais])

  const previa = useMemo(() => parearMarcas(marcas), [marcas])
  const invalido = useMemo(() => (marcas.length ? validarMarcas(marcas) : 'Nenhuma marcação neste dia.'), [marcas])
  const pendencias = useMemo(() => pendenciasDaPrevia(previa), [previa])
  const bloqueadoPend = pendencias.length > 0 && !pendCiente
  const setPapel = (hora: string, papel: PapelMarca) => setMarcas(ms => ms.map(m => (m.hora === hora ? { ...m, papel } : m)))
  const tid = (h: string) => h.replace(':', '')

  function acrescentar() {
    const h = normalizarHora(novaHora)
    if (!h) { setErro('Horário inválido — use HH:MM.'); return }
    if (marcas.some(m => m.hora === h)) { setErro(`O horário ${h} já está no dia.`); return }
    if (!novaOrigem) { setErro('Diga de onde veio o horário: catraca ou conferido com o colaborador.'); return }
    setErro(''); setMarcas(ms => [...ms, { hora: h, papel: novoPapel, origem: 'manual' as const, origem_ajuste: novaOrigem }].sort((a, b) => a.hora.localeCompare(b.hora))); setNovaHora('')
  }
  async function salvar() {
    if (invalido) { setErro(invalido); return }
    if (justificativa.trim().length < 10) { setErro('Escreva a justificativa (pelo menos 10 caracteres): por que este dia está sendo corrigido.'); return }
    if (bloqueadoPend) { setErro(`Falta horário: ${pendencias.map(textoPendencia).join('; ')}. Digite o horário em "Horário que faltou" ou marque que não sabe.`); return }
    if (!window.confirm(`Reler as pausas de ${colaborador} em ${data.split('-').reverse().join('/')} com estas marcações? A leitura anterior fica guardada no histórico e dá para desfazer.`)) return
    setBusy(true); setErro('')
    try {
      const r = await rpc<{ ok: boolean; pausas?: number; mensagem?: string; erro?: string }>('fn_nr36_reler_dia_justificado', { p_company_id: companyId, p_cpf: cpf, p_data: data, p_marcas: marcas, p_justificativa: justificativa.trim(), p_origem: origem, p_pendencia_ciente: pendencias.length > 0 && pendCiente })
      if (!r.ok) throw new Error(r.mensagem || r.erro || 'falha ao reler o dia')
      const ci = (r as { ciencia?: { acao?: string } }).ciencia?.acao
      onSalvo(`Dia relido: ${r.pausas} pausa(s) de ${colaborador}. A leitura anterior está no histórico.`
        + (ci === 'regerado' ? ' O documento de Ciência do mês foi atualizado com o ajuste.' : ci === 'desatualizado' ? ' A Ciência deste mês já estava assinada: ela não muda; gere uma nova versão na aba Ciência.' : ''))
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }
  async function desfazer() {
    if (!window.confirm('Voltar este dia para a leitura anterior?')) return
    setBusy(true); setErro('')
    try {
      const r = await rpc<{ ok: boolean; mensagem?: string; erro?: string }>('fn_nr36_reler_dia_desfazer', { p_company_id: companyId, p_cpf: cpf, p_data: data })
      if (!r.ok) throw new Error(r.mensagem || r.erro || 'falha ao desfazer')
      onSalvo(`Releitura desfeita: ${colaborador} voltou à leitura anterior.`)
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }

  const papelBtn = (ativo: boolean, cor: string): React.CSSProperties => ({ border: `1px solid ${ativo ? cor : C.borderLt}`, background: ativo ? cor : '#fff', color: ativo ? '#fff' : C.espresso, borderRadius: 7, padding: '4px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' })
  const corPapel: Record<PapelMarca, string> = { saida: C.blue, retorno: C.green, ignorar: C.gray }

  return (
    <div style={modalBg()} onClick={onFechar}>
      <div style={{ ...modalCard(), maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()} data-testid="marcas-dia-modal">
        <div style={secTitle()}>Saída e retorno · {colaborador} · {data.split('-').reverse().join('/')}</div>
        <div style={{ fontSize: 12.5, color: C.gray, marginBottom: 10 }}>Diga o que cada horário é. <b>Saída</b> começa a pausa, o <b>Retorno</b> seguinte fecha. <b>Ignorar</b> tira o horário da conta (ex.: entrada do turno). Se faltou a saída, <b>digite o horário abaixo</b> (ex.: o da catraca) e diga de onde veio. A batida original do relógio nunca muda: o horário digitado fica registrado à parte, com quem digitou e quando.</div>
        {ajusteDia && ajusteDia.originais.length > 0 && <div style={{ fontSize: 11.5, color: C.gray, marginBottom: 8 }} data-testid="marcas-originais">Batidas originais do relógio: <b style={{ color: C.espresso }}>{ajusteDia.originais.join(', ')}</b></div>}
        {erro && <div style={{ ...erroBox(), marginTop: 0, marginBottom: 10 }} data-testid="marcas-erro">{erro}</div>}
        {carregando ? <Load /> : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {marcas.map(m => (
                <div key={m.hora} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderBottom: `1px solid ${C.beigeLt}`, paddingBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: C.espresso, width: 50 }}>{m.hora}</span>
                  <span style={{ fontSize: 10.5, color: m.origem === 'manual' ? C.amber : C.gray, minWidth: 70 }} data-testid={`marca-${tid(m.hora)}-origem`}>{m.origem !== 'manual' ? 'original do relógio'
                    : (() => { const a = m.papel !== 'ignorar' ? ajusteDe(ajusteDia, m.hora, m.papel) : null; return a ? rotuloAjuste(a) : `digitado${m.origem_ajuste ? ` · ${rotuloOrigemAjuste(m.origem_ajuste)}` : ' · origem?'}` })()}</span>
                  {(['saida', 'retorno', 'ignorar'] as PapelMarca[]).map(p => (
                    <button key={p} type="button" style={papelBtn(m.papel === p, corPapel[p])} data-testid={`marca-${tid(m.hora)}-${p}`} onClick={() => setPapel(m.hora, p)}>
                      {p === 'saida' ? 'Saída' : p === 'retorno' ? 'Retorno' : 'Ignorar'}
                    </button>
                  ))}
                  {m.origem === 'manual' && <button type="button" style={{ ...papelBtn(false, C.red), color: C.red }} onClick={() => setMarcas(ms => ms.filter(x => x.hora !== m.hora))}>remover</button>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
              <span style={{ fontSize: 12, color: C.gray }}>Horário que faltou:</span>
              <input value={novaHora} onChange={e => setNovaHora(e.target.value)} placeholder="HH:MM" data-testid="marca-nova-hora" style={{ ...inp(), width: 80, padding: '6px 8px' }} />
              <select value={novoPapel} onChange={e => setNovoPapel(e.target.value as PapelMarca)} data-testid="marca-nova-papel" style={{ ...inp(), padding: '6px 8px' }}>
                <option value="saida">Saída</option><option value="retorno">Retorno</option>
              </select>
              <select value={novaOrigem} onChange={e => setNovaOrigem(e.target.value as OrigemAjuste | '')} data-testid="marca-nova-origem" style={{ ...inp(), padding: '6px 8px' }}>
                <option value="">De onde veio?</option>
                {ORIGENS_AJUSTE.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </select>
              <button type="button" style={papelBtn(false, C.gold)} data-testid="marca-nova-add" onClick={acrescentar}>Acrescentar</button>
            </div>
            <div style={{ marginTop: 14, background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 10, padding: 10 }} data-testid="marcas-antes">
              <div style={{ fontSize: 12, fontWeight: 700, color: C.gray, marginBottom: 6 }}>Antes — como o dia está hoje</div>
              {antes.length === 0 ? <div style={{ fontSize: 12, color: C.gray }}>Nenhuma.</div> : antes.map((p, i) => (
                <div key={i} style={{ fontSize: 12.5, color: C.gray }}>
                  {p.situacao === 'fechada' ? <>{p.inicio} → {p.fim} · {p.minutos} min</> : p.situacao === 'sem_saida' ? <>retorno {p.fim} · saída não registrada</> : <>saída {p.inicio} · sem retorno</>}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, background: C.beigeLt, borderRadius: 10, padding: 10 }} data-testid="marcas-previa">
              <div style={{ fontSize: 12, fontWeight: 700, color: C.espresso, marginBottom: 6 }}>Depois — pausas que vão ficar</div>
              {previa.length === 0 ? <div style={{ fontSize: 12, color: C.gray }}>Nenhuma.</div> : previa.map((p, i) => (
                <div key={i} style={{ fontSize: 12.5, color: C.espresso }} data-testid={`marcas-previa-${i}`}>
                  {p.situacao === 'fechada' ? <>{p.inicio} → {p.fim} · <b>{p.minutos} min</b></>
                    : p.situacao === 'sem_saida' ? <>retorno {p.fim} · <span style={{ color: C.amber }}>saída não registrada (fica pendente)</span></>
                    : <>saída {p.inicio} · <span style={{ color: C.amber }}>sem retorno (fica pendente)</span></>}
                </div>
              ))}
            </div>
            {pendencias.length > 0 && (
              <div style={{ marginTop: 10, background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 10, padding: 10, fontSize: 12.5, color: '#92400E' }} data-testid="marcas-pendencias">
                <b>Falta horário:</b> {pendencias.map(textoPendencia).join('; ')}. Se você tem o horário (ex.: da catraca), digite em <b>Horário que faltou</b>.
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, cursor: 'pointer', color: C.espresso }}>
                  <input type="checkbox" checked={pendCiente} onChange={e => setPendCiente(e.target.checked)} data-testid="marcas-pendencia-ciente" />
                  Não sei o horário — o dia continua pendente
                </label>
              </div>
            )}
          </>
        )}
        {!carregando && (
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, color: C.gray }}>Justificativa (obrigatória) — por que este dia está sendo corrigido</label>
            <textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} data-testid="marcas-justificativa" rows={2}
              placeholder="Ex.: conferido com o colaborador — esqueceu de bater a saída da 1ª pausa"
              style={{ ...inp(), width: '100%', marginTop: 4, resize: 'vertical' }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 14 }}>
          {podeDesfazer && <BtnGhost onClick={desfazer}><span data-testid="marcas-desfazer">Desfazer a última releitura</span></BtnGhost>}
          <BtnGhost onClick={onFechar}>Fechar</BtnGhost>
          <button onClick={salvar} disabled={busy || carregando || !!invalido || bloqueadoPend || justificativa.trim().length < 10} style={btnStyle(busy || carregando || !!invalido || bloqueadoPend || justificativa.trim().length < 10)} data-testid="marcas-salvar">Confirmar e reler o dia</button>
        </div>
      </div>
    </div>
  )
}

// #587 (Frioeste · CEO 01/10) · Auditoria de batidas: lê as batidas ORIGINAIS do relatório no período e aponta os dias
// em que os pares deslizaram (faltou uma batida). O sistema só SUGERE — cada dia abre no editor com antes/depois e a
// responsável confirma com justificativa. Nada grava sozinho.
type DiaAuditoria = { cpf: string; colaborador: string; data: string; linhas: LinhaPausaDia[] }
// #587 (CEO 02/10): dia já relido continua na auditoria, como "ajustado" — e com o que ainda falta (ex.: retorno sem saída)
type DiaAjustado = { cpf: string; colaborador: string; data: string; pendencias: Array<{ tipo: 'sem_saida' | 'sem_retorno'; hora: string }>; ajuste: AjusteDia }
function mesAnterior(): string { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
function AuditoriaBatidas({ companyId, onRevisar }: { companyId: string; onRevisar: (d: { cpf: string; data: string; colaborador: string; marcasIniciais?: Marca[] }) => void }) {
  const [mes, setMes] = useState(mesAnterior())
  const [dias, setDias] = useState<DiaAuditoria[] | null>(null)
  const [ajustados, setAjustados] = useState<DiaAjustado[]>([])
  const [busy, setBusy] = useState(false); const [erro, setErro] = useState('')
  async function auditar() {
    setBusy(true); setErro('')
    try {
      const [a, m] = mes.split('-').map(Number)
      const ini = `${mes}-01`, fim = `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`
      const r = await rpc<{ ok: boolean; dias?: DiaAuditoria[]; ajustados?: DiaAjustado[]; mensagem?: string }>('fn_nr36_auditoria_batidas_dias', { p_company_id: companyId, p_ini: ini, p_fim: fim })
      if (!r.ok) throw new Error(r.mensagem || 'falha na auditoria')
      setDias((r.dias || []).filter(d => diaSuspeito(d.linhas)))
      setAjustados(r.ajustados || [])
    } catch (e) { setErro((e as Error).message) } finally { setBusy(false) }
  }
  const txt = (ps: PausaRelida[]) => ps.map(p => p.situacao === 'fechada' ? `${p.inicio}–${p.fim} (${p.minutos} min)` : p.situacao === 'sem_retorno' ? `${p.inicio}–?` : `?–${p.fim}`).join(' · ')
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 12, padding: 12, marginBottom: 14 }} data-testid="auditoria-batidas">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.espresso }}>Auditoria de batidas</div>
          <div style={{ fontSize: 12.5, color: C.gray }}>Aponta os dias em que faltou uma batida e os horários do relatório ficaram trocados. O sistema <b>sugere</b>; você confere o antes/depois e <b>confirma com justificativa</b>. Nada é gravado sem você.</div>
        </div>
        <input type="month" value={mes} onChange={e => setMes(e.target.value)} data-testid="auditoria-mes" style={{ ...inp(), padding: '6px 8px' }} />
        <button onClick={auditar} disabled={busy} style={btnStyle(busy)} data-testid="auditoria-rodar">{busy ? 'Auditando…' : 'Auditar o mês'}</button>
      </div>
      {erro && <div style={erroBox()}>{erro}</div>}
      {dias && ajustados.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 10 }} data-testid="auditoria-ajustados">
          <div style={{ fontSize: 12.5, color: C.espresso, marginBottom: 6 }}>
            <b>{ajustados.length}</b> dia(s) já ajustado(s) · <b style={{ color: C.amber }}>{ajustados.filter(a => a.pendencias.length > 0).length}</b> ainda com horário faltando
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={{ padding: '6px 8px' }}>Colaborador</th><th style={{ padding: '6px 8px' }}>Dia</th><th style={{ padding: '6px 8px' }}>Situação</th><th style={{ padding: '6px 8px' }}>Ajuste (original × digitado)</th><th />
            </tr></thead>
            <tbody>
              {ajustados.map(a => {
                const ult = a.ajuste.justificativas?.[a.ajuste.justificativas.length - 1]
                return (
                  <tr key={a.cpf + a.data} style={{ borderBottom: `1px solid ${C.beigeLt}` }} data-testid={`auditoria-ajustado-${a.data}`}>
                    <td style={{ padding: '7px 8px', fontWeight: 600, color: C.espresso }}>{a.colaborador}</td>
                    <td style={{ padding: '7px 8px', color: C.gray }}>{a.data.split('-').reverse().join('/')}</td>
                    <td style={{ padding: '7px 8px' }}>
                      {a.pendencias.length === 0
                        ? <span style={{ fontSize: 10.5, fontWeight: 700, color: C.green, background: C.greenBg, padding: '2px 8px', borderRadius: 20 }}>ajustado</span>
                        : <span style={{ fontSize: 10.5, fontWeight: 700, color: C.amber, background: C.amberBg, padding: '2px 8px', borderRadius: 20 }} data-testid={`auditoria-falta-${a.data}`}>ajustado · {a.pendencias.map(textoPendencia).join('; ')}</span>}
                    </td>
                    <td style={{ padding: '7px 8px', color: C.espresso }}>
                      <div style={{ color: C.gray }}>original: {a.ajuste.originais.join(', ') || '—'}</div>
                      {a.ajuste.ajustes.map(x => <div key={x.hora + x.papel}>{x.papel === 'saida' ? 'saída' : 'retorno'} {x.hora} · {rotuloAjuste(x)}</div>)}
                      {ult && <div style={{ color: C.gray, fontSize: 11 }}>“{ult.justificativa}” — {ult.por || 'responsável'}</div>}
                    </td>
                    <td style={{ padding: '7px 8px' }}><button type="button" onClick={() => onRevisar({ cpf: a.cpf, data: a.data, colaborador: a.colaborador })} data-testid={`auditoria-abrir-${a.data}`}
                      style={{ border: `1px solid ${C.borderLt}`, background: '#fff', color: C.espresso, borderRadius: 7, padding: '4px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{a.pendencias.length ? 'Digitar horário' : 'Abrir o dia'}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {dias && (dias.length === 0
        ? <div style={{ fontSize: 12.5, color: C.green, marginTop: 10 }} data-testid="auditoria-vazia">Nenhum dia novo (ainda não conferido) com batida faltando neste mês.</div>
        : (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <div style={{ fontSize: 12.5, color: C.espresso, marginBottom: 6 }} data-testid="auditoria-resumo"><b>{dias.length}</b> dia(s) para conferir · <b>{dias.reduce((n, d) => n + sugerirPapeis(marcasDasPausas(d.linhas)).faltando.length, 0)}</b> batida(s) faltando apontada(s)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={{ padding: '6px 8px' }}>Colaborador</th><th style={{ padding: '6px 8px' }}>Dia</th><th style={{ padding: '6px 8px' }}>Como veio do relatório</th><th style={{ padding: '6px 8px' }}>Sugestão</th><th style={{ padding: '6px 8px' }}>Batida faltando</th><th />
            </tr></thead>
            <tbody>
              {dias.map(d => {
                const marcas = marcasDasPausas(d.linhas)
                const s = sugerirPapeis(marcas)
                return (
                  <tr key={d.cpf + d.data} style={{ borderBottom: `1px solid ${C.beigeLt}` }} data-testid={`auditoria-dia-${d.data}`}>
                    <td style={{ padding: '7px 8px', fontWeight: 600, color: C.espresso }}>{d.colaborador}</td>
                    <td style={{ padding: '7px 8px', color: C.gray }}>{d.data.split('-').reverse().join('/')}</td>
                    <td style={{ padding: '7px 8px', color: C.gray }}>{txt(parearMarcas(marcas))}</td>
                    <td style={{ padding: '7px 8px', color: C.espresso }}>{txt(s.pausas)}</td>
                    <td style={{ padding: '7px 8px', color: C.amber, fontWeight: 700 }}>{s.faltando.join(', ') || '—'}</td>
                    <td style={{ padding: '7px 8px' }}><button type="button" onClick={() => onRevisar({ cpf: d.cpf, data: d.data, colaborador: d.colaborador, marcasIniciais: s.marcas })} data-testid={`auditoria-revisar-${d.data}`}
                      style={{ border: `1px solid ${C.borderLt}`, background: '#fff', color: C.espresso, borderRadius: 7, padding: '4px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Revisar</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

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
function secTitle(): React.CSSProperties { return { fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, color: C.espresso, margin: '0 0 8px' } }
function card(): React.CSSProperties { return { display: 'flex', gap: 12, alignItems: 'center', background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 12, padding: '12px 14px', marginBottom: 10 } }
function th(): React.CSSProperties { return { padding: '8px 10px', fontWeight: 600, fontSize: 12 } }
// corpo da tabela SEMPRE com cor de texto explícita (Espresso #3D2314) — sem cor, herdava um
// tom claro do ambiente e a prévia ficava ilegível sobre o branco (Pilar 3 / WCAG AA). Spans
// internos (C.gray/C.blue/C.amber) continuam sobrescrevendo onde o secundário é intencional.
function td(): React.CSSProperties { return { padding: '9px 10px', verticalAlign: 'top', color: C.espresso } }
function inp(): React.CSSProperties { return { border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: '8px 10px', fontSize: 13.5, color: C.ink, background: '#fff' } }
function erroBox(): React.CSSProperties { return { background: C.redBg, color: C.red, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, marginTop: 10 } }
function modalBg(): React.CSSProperties { return { position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 } }
function modalCard(): React.CSSProperties { return { background: '#fff', borderRadius: 14, width: '100%', padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' } }
function btnStyle(disabled: boolean): React.CSSProperties { return { display: 'inline-flex', alignItems: 'center', gap: 6, background: disabled ? '#d9c9a6' : C.gold, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer' } }
function Campo({ label, children }: { label: string; children: React.ReactNode }) { return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><label style={{ fontSize: 12, color: C.gray }}>{label}</label>{children}</div> }
function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) { return <button onClick={onClick} disabled={disabled} style={btnStyle(!!disabled)}>{children}</button> }
function BtnGhost({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) { return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.borderLt}`, background: '#fff', color: C.espresso, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{children}</button> }

// ─────────────────────────────────── AUDITORIA (SST ②) ───────────────────────────────────
// Relatório de auditoria trabalhista com valor probatório: jornada real (marcação normalizada
// ao fuso — decisão a4a440da), escala, exposição x pausa, desvios em minutos, base legal,
// parâmetros vigentes, e hash + registro de emissão. 'sem_dado' NUNCA é linha em branco: diz o
// motivo (0e580f96). Emitir grava a emissão (auditável) e abre a impressão (PDF via navegador).
type RelJornada = { entrada: string | null; saida: string | null; ajustada: boolean; origem: string | null; pontos: number }
type RelEvento = { classe: string | null; dur_min: number | null; inicio: string | null; fim: string | null }
type RelDesvio = { tipo: string; de?: string; ate?: string; minutos?: number; excedeu?: number; inicio?: string; duracao_min?: number; minimo?: number; faltantes?: number; marcacao_interna?: string[] }
type RelDia = { data: string; tipo: string; status: string; shift: string | null; jornada: RelJornada | null; eventos: RelEvento[] | null; desvios: RelDesvio[]; sem_dado_motivo: string | null }
type RelColab = { cpf: string; nome: string; matricula: string | null; funcao: string | null; setor: string | null; dias: RelDia[] | null }
type RelRegra = { tipo: string; nome: string; base_legal: string | null; parametros: Record<string, unknown> }
type Relatorio = { empresa: Record<string, string | null>; periodo: { ini: string; fim: string; emitido_em: string }; regras: RelRegra[]; colaboradores: RelColab[]; hash: string; emitido_por: { email: string | null }; emissao_id?: string }
type Emissao = { id: string; dt_ini: string; dt_fim: string; emitido_por_email: string | null; emitido_em: string; hash: string; resumo: { colaboradores?: number } | null }

const desvioLabel = (d: RelDesvio): string => {
  if (d.tipo === 'excedeu_limite') {
    const base = `Exposição contínua ${d.de}–${d.ate}: ${d.minutos} min (${d.excedeu} min acima do limite)`
    // Sinal (não decisão): batida de ponto dentro do período pode indicar interrupção — o SST confirma.
    return (d.marcacao_interna && d.marcacao_interna.length > 0)
      ? `${base} · ⚠ há marcação de ponto dentro deste período (${d.marcacao_interna.join(', ')}) — confirmar se houve interrupção`
      : base
  }
  if (d.tipo === 'pausa_insuficiente') return `Pausa às ${d.inicio} durou ${d.duracao_min} min (mínimo ${d.minimo} min)`
  if (d.tipo === 'pausa_nao_realizada') return `${d.faltantes} pausa(s) devida(s) e não realizada(s)`
  return d.tipo
}

function AbaAuditoria({ companyId }: { companyId: string }) {
  const hoje = new Date()
  const [ini, setIni] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)))
  const [fim, setFim] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)))
  const [rel, setRel] = useState<Relatorio | null>(null)
  const [emissoes, setEmissoes] = useState<Emissao[]>([])
  const [carregando, setCarregando] = useState(false)
  const [emitindo, setEmitindo] = useState(false)
  const [erro, setErro] = useState('')

  const listarEmissoes = useCallback(async () => {
    try {
      const r = await rpc<{ emissoes: Emissao[] }>('fn_nr36_relatorio_emissoes_listar', { p_company_id: companyId })
      setEmissoes(r.emissoes || [])
    } catch { /* silencioso */ }
  }, [companyId])
  useEffect(() => { void listarEmissoes() }, [listarEmissoes])

  const [reguaRel, setReguaRel] = useState<Regua | undefined>(undefined)
  const [segRel, setSegRel] = useState<Map<string, number> | undefined>(undefined)
  // pausa curta com o motivo pela régua (segundos); sem a régua, o texto de antes
  const rotuloDesvio = (dv: RelDesvio, cpf: string, data: string) => {
    if (dv.tipo !== 'pausa_insuficiente' || !reguaRel) return desvioLabel(dv)
    const seg = segRel?.get(chaveSeg(cpf, data, dv.inicio))
    const m = motivoRegua({ seg: seg ?? null, min: dv.duracao_min ?? null, classe: 'pausa_insuficiente' }, reguaRel)
    return `Pausa às ${dv.inicio}${seg != null ? ` durou ${mmss(seg)}` : ''} — ${m}`
  }
  const gerar = async (registrar: boolean) => {
    if (registrar) setEmitindo(true); else setCarregando(true)
    setErro('')
    try {
      const r = await rpc<Relatorio>('fn_nr36_relatorio_auditoria', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim, p_registrar: registrar })
      setRel(r)
      // #76 · régua da empresa + duração em segundos para o motivo de cada pausa curta
      try {
        const rg = await rpc<{ ok: boolean; regua?: Record<string, unknown>; pausas?: PausaSeg[] }>('fn_nr36_pausas_regua', { p_company_id: companyId, p_ini: ini, p_fim: fim })
        if (rg.ok) { setReguaRel(reguaDe(rg.regua)); setSegRel(new Map((rg.pausas || []).map(p => [chaveSeg(p.cpf, p.data, p.de), p.seg]))) }
      } catch { setReguaRel(undefined); setSegRel(undefined) }
      if (registrar) { await listarEmissoes(); setTimeout(() => window.print(), 300) }
    } catch (e) { setErro((e as Error).message) } finally { setCarregando(false); setEmitindo(false) }
  }

  const totalDesvios = rel?.colaboradores.reduce((s, c) => s + (c.dias || []).filter(d => d.status === 'desvio').length, 0) ?? 0
  // Desvios com marcação de ponto dentro da exposição → dependem de confirmação do SST (interrupção?).
  // Declarado no TOPO (não rodapé): um relatório que afirma N desvios com M em dúvida se desmonta.
  const totalConflito = rel?.colaboradores.reduce((s, c) => s + (c.dias || []).filter(d => d.status === 'desvio' && (d.desvios || []).some(dv => (dv.marcacao_interna?.length ?? 0) > 0)).length, 0) ?? 0

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }} data-no-print="true">
        <Campo label="De"><input type="date" style={inp()} value={ini} onChange={e => setIni(e.target.value)} /></Campo>
        <Campo label="Até"><input type="date" style={inp()} value={fim} onChange={e => setFim(e.target.value)} /></Campo>
        <Btn onClick={() => gerar(false)} disabled={carregando}><FileText size={14} /> {carregando ? 'Gerando…' : 'Gerar prévia'}</Btn>
        {rel && <Btn onClick={() => gerar(true)} disabled={emitindo}><Download size={14} /> {emitindo ? 'Emitindo…' : 'Emitir e imprimir (PDF)'}</Btn>}
      </div>

      <div style={{ display: 'flex', gap: 10, background: C.blueBg, border: `1px solid ${C.blue}33`, borderRadius: 12, padding: 12, marginBottom: 12 }} data-no-print="true">
        <ShieldAlert size={18} style={{ color: C.blue, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: C.espresso, lineHeight: 1.5 }}>
          Documento com <b>valor probatório</b> para fiscalização (MTE). Cada número aponta o registro de origem; horários em hora local (marcação e exposição normalizadas para o mesmo fuso). <b>&ldquo;Emitir&rdquo;</b> grava a emissão com data, autor e um código de verificação (hash), e abre a impressão.
        </div>
      </div>

      {erro && <div style={erroBox()}>{erro}</div>}
      {!rel ? <Vazio titulo="Gere o relatório do período" texto="Escolha o período e clique em Gerar prévia. A apuração precisa ter sido feita no Painel (Reapurar) para o período." /> : (
        <div id="relatorio-auditoria">
          {/* cabeçalho institucional */}
          <div style={{ borderBottom: `2px solid ${C.gold}`, paddingBottom: 10, marginBottom: 14 }}>
            <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 600, color: C.espresso }}>Relatório de Auditoria — Pausas e Exposição (NR-36 / Art. 253 CLT)</div>
            <div style={{ fontSize: 13, color: C.espresso, marginTop: 4 }}>{rel.empresa.razao_social} — CNPJ {rel.empresa.cnpj}{rel.empresa.cnae ? ` — CNAE ${rel.empresa.cnae}` : ''}</div>
            {rel.empresa.endereco && <div style={{ fontSize: 12, color: C.gray }}>{rel.empresa.endereco}</div>}
            <div style={{ fontSize: 12, color: C.gray, marginTop: 4 }}>Período: {fmtData(rel.periodo.ini)} a {fmtData(rel.periodo.fim)} · Emitido em {fmtDT(rel.periodo.emitido_em)}{rel.emitido_por?.email ? ` por ${rel.emitido_por.email}` : ''}</div>
          </div>

          {/* base legal + parâmetros vigentes */}
          <div style={{ background: C.beigeLt, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.espresso }}>
            <b>Base legal e parâmetros vigentes na apuração:</b>
            {rel.regras.map((r, i) => (
              <div key={i} style={{ marginTop: 4 }}>· <b>{tipoLabel(r.tipo)}</b>: {r.base_legal} — {Object.entries(r.parametros).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}</div>
            ))}
            {reguaRel && <div style={{ marginTop: 6 }} data-testid="rel-regua"><b>{textoRegua(reguaRel)}</b>. Durações em minutos:segundos.</div>}
          </div>

          <div style={{ fontSize: 13, color: C.espresso, marginBottom: 10 }}><b>{rel.colaboradores.length}</b> colaborador(es) no período · <b style={{ color: totalDesvios > 0 ? C.red : C.green }}>{totalDesvios}</b> dia(s) com desvio.</div>

          {/* RESSALVA DECLARADA NO TOPO (não rodapé): desvios com marcação de ponto dentro da exposição
              dependem de confirmação do SST sobre ter havido interrupção. Sem isso, o número não é firme. */}
          {totalConflito > 0 && (
            <div style={{ display: 'flex', gap: 10, background: C.amberBg, border: `1px solid ${C.amber}77`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
              <AlertTriangle size={18} style={{ color: C.amber, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12.5, color: C.espresso, lineHeight: 1.55 }}>
                <b>Ressalva do total.</b> Deste total, <b>{totalConflito} ocorrência(s)</b> apresentam marcação de ponto dentro do período de exposição e <b>dependem de confirmação do responsável de SST</b> sobre ter havido interrupção. Enquanto não confirmadas, o número de desvios não deve ser tratado como definitivo.
              </div>
            </div>
          )}

          {rel.colaboradores.map((c) => (
            <div key={c.cpf} style={{ marginBottom: 18, breakInside: 'avoid' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.espresso, borderBottom: `1px solid ${C.borderLt}`, paddingBottom: 4 }}>
                {c.nome} <span style={{ fontWeight: 400, color: C.gray, fontSize: 12 }}>· CPF {c.cpf}{c.matricula ? ` · matrícula ${c.matricula}` : ''}{c.funcao ? ` · ${c.funcao}` : ''}{c.setor ? ` · ${c.setor}` : ''}</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6 }}>
                <thead><tr style={{ textAlign: 'left', color: C.gray }}>
                  <th style={th()}>Data</th><th style={th()}>Jornada</th><th style={th()}>Escala</th><th style={th()}>Exposição / pausas</th><th style={th()}>Situação</th>
                </tr></thead>
                <tbody>
                  {(c.dias || []).map((d, i) => { const s = semColor[d.status] || semColor.sem_dado; return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.beigeLt}`, breakInside: 'avoid' }}>
                      <td style={td()}>{fmtData(d.data)}</td>
                      <td style={td()}>{d.jornada?.entrada ? `${d.jornada.entrada}–${d.jornada.saida}` : '—'}{d.jornada?.ajustada ? <span style={{ color: C.amber, fontSize: 10, display: 'block' }}>marcação ajustada</span> : null}</td>
                      <td style={td()}>{d.shift || '—'}</td>
                      <td style={td()}>
                        {d.status === 'sem_dado'
                          ? <span style={{ color: C.gray, fontStyle: 'italic' }}>Sem registro de entrada no ambiente neste dia</span>
                          : (d.eventos || []).map((e, j) => (
                              <div key={j} style={{ color: e.classe === 'exposicao' ? C.espresso : C.gray }}>
                                {e.classe === 'exposicao' ? '🔵 exposição' : e.classe === 'aberto' ? '⏳ em aberto' : '⏸ pausa'} {e.inicio}{e.fim ? `–${e.fim}` : ''} {e.dur_min != null ? `(${e.dur_min} min)` : ''}
                              </div>
                            ))}
                        {d.desvios.length > 0 && <div style={{ marginTop: 4 }}>{d.desvios.map((dv, k) => <div key={k} style={{ color: C.red, fontSize: 11 }}>⚠ {rotuloDesvio(dv, c.cpf, d.data)}</div>)}</div>}
                      </td>
                      <td style={td()}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: s.bg, color: s.c, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{s.l}</span></td>
                    </tr>
                  ) })}
                </tbody>
              </table>
            </div>
          ))}

          {/* rodapé probatório: hash */}
          <div style={{ borderTop: `1px solid ${C.borderLt}`, marginTop: 10, paddingTop: 8, fontSize: 11, color: C.gray }}>
            Código de verificação (SHA-256): <span style={{ fontFamily: 'monospace', color: C.espresso }}>{rel.hash}</span>
            {rel.emissao_id && <span> · Emissão registrada #{rel.emissao_id.slice(0, 8)}</span>}
            <div style={{ marginTop: 3 }}>Horários em hora local. Marcação e exposição normalizadas para o mesmo fuso (America/Sao_Paulo).</div>
          </div>
        </div>
      )}

      {emissoes.length > 0 && (
        <div style={{ marginTop: 20 }} data-no-print="true">
          <div style={secTitle()}>Emissões registradas</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
              <th style={th()}>Período</th><th style={th()}>Emitido em</th><th style={th()}>Por</th><th style={th()}>Colab.</th><th style={th()}>Hash</th>
            </tr></thead>
            <tbody>
              {emissoes.map((e) => (
                <tr key={e.id} style={{ borderBottom: `1px solid ${C.beigeLt}` }}>
                  <td style={td()}>{fmtData(e.dt_ini)}–{fmtData(e.dt_fim)}</td>
                  <td style={td()}>{fmtDT(e.emitido_em)}</td>
                  <td style={td()}>{e.emitido_por_email || '—'}</td>
                  <td style={td()}>{e.resumo?.colaboradores ?? '—'}</td>
                  <td style={td()}><span style={{ fontFamily: 'monospace', fontSize: 10 }}>{e.hash.slice(0, 16)}…</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────── SUPERVISÃO (SST · #68) ───────────────────────────────────
// Terceira saída do MESMO motor: o caso curto para o SUPERVISOR levar ao colaborador. Linguagem
// de chão, descreve o FATO — nunca julga a pessoa (cuidado de RH: "ficou 4h13 sem pausa", jamais
// "não cumpriu"; a causa pode ser da operação). Horários em hora local (fuso normalizado na origem).
type SupDesvio = { tipo: string; de?: string; ate?: string; minutos?: number; excedeu?: number; inicio?: string; duracao_min?: number; minimo?: number; faltantes?: number; quantidade?: number; marcacao_interna?: string[] }
type SupSinal = { data: string; cpf: string; nome: string; funcao: string | null; setor: string | null; status_dia: string; limite_min: number; trechos: Trecho[] }
type SupCaso = { data: string; cpf: string; nome: string; funcao: string | null; setor: string | null; shift: string | null; gatilho_min: string | null; pausa_min: string | null; jornada: { entrada: string | null; saida: string | null } | null; desvios: SupDesvio[]; pausas?: PausaDia[] | null }
// #92 · dia aguardando confirmação (pausa sem hora de saída). Natureza DIFERENTE do desvio: não
// está provado — o supervisor pergunta ao colaborador o que houve; a responsável fecha na aba
// Conferência. NUNCA é desvio no escuro (RD-38).
type SupPendente = { data: string; cpf: string; nome: string; funcao: string | null; setor: string | null; tipo: string; shift: string | null; motivo?: string | null; sem_registro_pausa?: boolean; jornada: { entrada: string | null; saida: string | null } | null }

// #587: motivo do dia pendente em linguagem simples (pausas_faltantes = fez menos pausas do que a jornada exigia)
const rotuloPendente = (p: { sem_registro_pausa?: boolean; motivo?: string | null }) =>
  p.motivo === 'pausas_faltantes' ? 'Fez menos pausas do que a jornada pedia — confirmar com o colaborador'
    : p.sem_registro_pausa === true || p.motivo === 'sem_registro_pausa' ? 'Sem registro de pausa' : 'Pausa sem hora de saída'

const hmm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
// FATO, não julgamento (RH). Descreve o que aconteceu; a causa é a conversa.
// #76 (CEO 03/10): com a régua da empresa e a duração em segundos, cada pausa diz o motivo pelo número que decide
type PausaSeg = { cpf: string; data: string; de: string; ate: string; seg: number; classe: string }
const chaveSeg = (cpf: string, data: string, de?: string | null) => `${cpf}|${data}|${de ?? ''}`
function comSegundos(d: SupCaso, seg?: Map<string, number>): PausaDia[] | null | undefined {
  if (!seg || !d.pausas) return d.pausas
  return d.pausas.map(p => ({ ...p, seg: seg.get(chaveSeg(d.cpf, d.data, p.de)) ?? p.seg ?? null }))
}
function frasesChao(d: SupCaso, regua?: Regua, seg?: Map<string, number>): string[] {
  const pausaMin = Number(d.pausa_min) || 20
  const pausas = comSegundos(d, seg)
  // #273 · cada pausa curta com horário e minutos (antes: "pausa de undefined minutos às undefined"); e as pausas acima
  // do tempo previsto no mesmo dia, como gestão
  return [...(d.desvios || []).flatMap((dv) => {
    if (dv.tipo === 'pausa_insuficiente') return frasesPausasCurtas(dv, pausas, pausaMin, regua)
    return [fraseDesvio(dv)]
  }), ...frasesExcesso(pausas, regua)]
}
function fraseDesvio(dv: SupDesvio): string {
  return (() => {
    if (dv.tipo === 'excedeu_limite' && dv.minutos != null) {
      const lim = dv.minutos - (dv.excedeu ?? 0)
      const base = `ficou ${hmm(dv.minutos)} sem pausa, das ${dv.de} às ${dv.ate} — o limite é ${hmm(lim)}`
      // Sinal: batida de ponto dentro do período — pode ter sido interrupção. O supervisor confirma.
      return (dv.marcacao_interna && dv.marcacao_interna.length > 0)
        ? `${base} · ⚠ há batida de ponto dentro deste período (${dv.marcacao_interna.join(', ')}) — confirmar se houve interrupção`
        : base
    }
    if (dv.tipo === 'pausa_nao_realizada') return (dv.faltantes ?? 0) === 1 ? 'faltou uma pausa no dia' : `faltaram ${dv.faltantes} pausas no dia`
    return dv.tipo
  })()
}
function casoTexto(d: SupCaso, regua?: Regua, seg?: Map<string, number>): string {
  const cab = `${d.nome}${d.funcao ? ` — ${d.funcao}` : ''}${d.setor ? ` — ${d.setor}` : ''}\n${fmtData(d.data)} · jornada ${d.jornada?.entrada ?? '—'}–${d.jornada?.saida ?? '—'}\n`
  const linhas = frasesChao(d, regua, seg).map(f => `• ${f}`).join('\n')
  return `${cab}\n${linhas}\n\nO sistema registra o fato ocorrido; a causa (linha parada, falta de substituto, demanda da operação) é a conversa entre supervisão e colaborador.`
}

function AbaSupervisao({ companyId }: { companyId: string }) {
  const hoje = new Date()
  const [ini, setIni] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)))
  const [fim, setFim] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)))
  const [casos, setCasos] = useState<SupCaso[]>([])
  const [pendentes, setPendentes] = useState<SupPendente[]>([])
  const [carregado, setCarregado] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  // #273 · filtrar por colaborador
  const [colab, setColab] = useState('')
  const [sinais, setSinais] = useState<SupSinal[]>([])
  const [regua, setRegua] = useState<Regua | undefined>(undefined)
  const [segMap, setSegMap] = useState<Map<string, number> | undefined>(undefined)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const r = await rpc<{ casos: SupCaso[] }>('fn_nr36_supervisao_casos', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
      setCasos(r.casos || [])
      // #92 · dias aguardando confirmação — a segunda natureza, separada dos desvios provados
      const p = await rpc<{ pendentes: SupPendente[] }>('fn_nr36_supervisao_pendentes', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
      setPendentes(p.pendentes || [])
      // #273 · sinal de gestão do limite de 1h40 (art. 253 CLT) — fora do veredito
      try {
        const sg = await rpc<{ sinais: SupSinal[] }>('fn_nr36_supervisao_sinais', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
        setSinais(sg.sinais || [])
      } catch { setSinais([]) }
      // #76 · régua da empresa + duração em segundos (o motivo de cada desvio sai com o número que decide)
      try {
        const rg = await rpc<{ ok: boolean; regua?: Record<string, unknown>; pausas?: PausaSeg[] }>('fn_nr36_pausas_regua', { p_company_id: companyId, p_ini: ini, p_fim: fim })
        if (rg.ok) { setRegua(reguaDe(rg.regua)); setSegMap(new Map((rg.pausas || []).map(p => [chaveSeg(p.cpf, p.data, p.de), p.seg]))) }
      } catch { setRegua(undefined); setSegMap(undefined) }
      setCarregado(true)
    } catch (e) { setErro((e as Error).message) } finally { setCarregando(false) }
  }, [companyId, ini, fim])
  useEffect(() => { void carregar() }, [carregar])

  const nomes = useMemo(() => Array.from(new Set([...casos.map(c => c.nome), ...pendentes.map(p => p.nome), ...sinais.map(g => g.nome)])).sort(), [casos, pendentes, sinais])
  const sinaisF = useMemo(() => (colab ? sinais.filter(g => g.nome === colab) : sinais), [sinais, colab])
  const casosF = useMemo(() => (colab ? casos.filter(c => c.nome === colab) : casos), [casos, colab])
  const pendentesF = useMemo(() => (colab ? pendentes.filter(p => p.nome === colab) : pendentes), [pendentes, colab])

  const copiar = async (d: SupCaso) => {
    const k = d.cpf + d.data
    try { await navigator.clipboard.writeText(casoTexto(d, regua, segMap)); setCopiado(k); setTimeout(() => setCopiado(null), 1800) } catch { /* */ }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }} data-no-print="true">
        <Campo label="De"><input type="date" style={inp()} value={ini} onChange={e => setIni(e.target.value)} /></Campo>
        <Campo label="Até"><input type="date" style={inp()} value={fim} onChange={e => setFim(e.target.value)} /></Campo>
        <Btn onClick={() => carregar()} disabled={carregando}><RefreshCw size={14} /> {carregando ? 'Buscando…' : 'Atualizar'}</Btn>
        <Campo label="Colaborador">
          <select style={inp()} value={colab} onChange={e => setColab(e.target.value)} data-testid="sup-filtro-colaborador">
            <option value="">Todos</option>
            {nomes.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Campo>
      </div>

      <div style={{ display: 'flex', gap: 10, background: C.beigeLt, borderRadius: 12, padding: 12, marginBottom: 12 }} data-no-print="true">
        <Users size={18} style={{ color: C.espresso, flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: C.espresso, lineHeight: 1.5 }}>
          Casos para a <b>conversa da supervisão com o colaborador</b>. O texto descreve <b>o que aconteceu</b>, não julga — a causa (linha parada, falta de substituto, demanda da operação) é a conversa. Abra o dia, copie ou imprima o caso.
        </div>
      </div>
      {regua && <div style={{ fontSize: 12.5, color: C.espresso, background: '#fff', border: `1px solid ${C.borderLt}`, borderRadius: 10, padding: '8px 12px', marginBottom: 12 }} data-testid="sup-regua">{textoRegua(regua)}. A duração é em minutos:segundos — é ela que decide.</div>}

      {erro && <div style={erroBox()}>{erro}</div>}
      {!carregado ? <Load /> :
        (casosF.length === 0 && pendentesF.length === 0 && sinaisF.length === 0) ? <Vazio titulo="Nada para tratar no período" texto="Não há desvios provados nem dias aguardando confirmação neste período. Se faltam dados, importe o relatório de ponto e reapure no Painel." /> : (
        <>
          {/* SEÇÃO 1 · Desvios provados — pausa insuficiente/não realizada, fato registrado */}
          <div style={secTitle()}>Desvios provados</div>
          {casosF.length === 0 ? (
            <div style={{ fontSize: 13, color: C.gray, marginBottom: 18 }}>Nenhum desvio provado no período.</div>
          ) : (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: C.espresso, marginBottom: 10 }} data-no-print="true"><b>{casosF.length}</b> caso(s) de desvio no período.</div>
            {casosF.map((d) => { const k = d.cpf + d.data; const open = aberto === k; return (
              <div key={k} style={{ border: `1px solid ${C.borderLt}`, borderRadius: 10, marginBottom: 8, background: '#fff', breakInside: 'avoid' }}>
                <button onClick={() => setAberto(open ? null : k)} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                  <span>
                    <span style={{ fontWeight: 700, color: C.espresso, fontSize: 13.5 }}>{d.nome}</span>
                    <span style={{ color: C.gray, fontSize: 12 }}> · {fmtData(d.data)}{d.setor ? ` · ${d.setor}` : ''}</span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: C.redBg, color: C.red, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{d.desvios.reduce((a, dv) => a + (dv.quantidade ?? 1), 0)} desvio(s)</span>
                </button>
                {open && (
                  <div style={{ padding: '0 14px 14px' }}>
                    <div style={{ fontSize: 12, color: C.gray, marginBottom: 6 }}>Jornada {d.jornada?.entrada ?? '—'}–{d.jornada?.saida ?? '—'}{d.shift ? ` · escala ${d.shift}` : ''}</div>
                    <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                      {frasesChao(d, regua, segMap).map((f, i) => <li key={i} data-testid="sup-frase" style={{ fontSize: 13, color: C.espresso, marginBottom: 3 }}>{f}</li>)}
                    </ul>
                    <div style={{ display: 'flex', gap: 8 }} data-no-print="true">
                      <BtnGhost onClick={() => copiar(d)}><Copy size={13} /> {copiado === k ? 'Copiado!' : 'Copiar caso'}</BtnGhost>
                      <BtnGhost onClick={() => window.print()}><Printer size={13} /> Imprimir</BtnGhost>
                    </div>
                  </div>
                )}
              </div>
            ) })}
          </div>
          )}

          {/* SEÇÃO 1b · #273 · SINAL DE GESTÃO — art. 253 CLT: 20 min de repouso a cada 1h40 em ambiente frio. Trecho
              contínuo sem pausa acima do limite, pelas batidas do ponto menos as pausas. NÃO é veredito (decisão do CEO). */}
          <div style={secTitle()}>Sinal de gestão — mais de 1h40 sem pausa</div>
          <div style={{ fontSize: 12.5, color: C.gray, marginBottom: 8 }}>Art. 253 da CLT: 20 min de repouso a cada 1h40 de trabalho em ambiente frio. Trechos contínuos sem pausa acima do limite, medidos pelas batidas do ponto menos as pausas registradas. <b>É sinal para a gestão, não entra no veredito do dia.</b></div>
          {sinaisF.length === 0 ? (
            <div style={{ fontSize: 13, color: C.gray, marginBottom: 18 }} data-testid="sup-sinais-vazio">Nenhum trecho acima de 1h40 sem pausa no período.</div>
          ) : (
            <div style={{ marginBottom: 20 }} data-testid="sup-sinais">
              {sinaisF.map((g) => (
                <div key={g.cpf + g.data} style={{ border: `1px solid ${C.borderLt}`, borderRadius: 10, marginBottom: 6, background: '#fff', padding: '8px 14px', breakInside: 'avoid' }}>
                  <div style={{ fontSize: 13 }}><b style={{ color: C.espresso }}>{g.nome}</b><span style={{ color: C.gray, fontSize: 12 }}> · {fmtData(g.data)}{g.setor ? ` · ${g.setor}` : ''} · dia {g.status_dia === 'desvio' ? 'com desvio' : 'conforme'}</span></div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {g.trechos.map((t, i) => <li key={i} data-testid="sup-sinal" style={{ fontSize: 12.5, color: C.amber }}>{fraseSinal(t, g.limite_min)}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* SEÇÃO 2 · Dias aguardando confirmação — #92. Natureza DIFERENTE do desvio: pausa sem
              hora de saída, ainda não provada. O supervisor pergunta ao colaborador o que houve;
              a responsável fecha na aba Conferência. NUNCA é desvio no escuro (RD-38). */}
          <div style={secTitle()}>Dias aguardando confirmação</div>
          {pendentesF.length === 0 ? (
            <div style={{ fontSize: 13, color: C.gray }}>Nenhum dia aguardando confirmação no período.</div>
          ) : (
          <div>
            <div style={{ display: 'flex', gap: 10, background: C.amberBg, border: `1px solid ${C.amber}33`, borderRadius: 12, padding: 12, marginBottom: 12 }} data-no-print="true">
              <AlertTriangle size={18} style={{ color: C.amber, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12.5, color: C.espresso, lineHeight: 1.5 }}>
                <b>{pendentesF.length} dia(s) aguardando confirmação.</b> Ainda <b>não são desvio</b> — o sistema não julga no escuro. Duas naturezas: <b>pausa sem hora de saída</b> (fim não confirmado) e <b>sem registro de pausa</b> (a jornada exigia pausa e nenhuma foi marcada — o horário correu até o próximo registro). Nenhuma delas é &ldquo;conforme&rdquo;. São a <b>conversa do supervisor com o colaborador</b> (&ldquo;o que houve neste dia?&rdquo;) e se fecham na aba <b>Conferência</b>.
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ textAlign: 'left', color: C.gray, borderBottom: `1px solid ${C.borderLt}` }}>
                  <th style={th()}>Colaborador</th><th style={th()}>Dia</th><th style={th()}>Motivo</th><th style={th()}>Setor</th><th style={th()}>Jornada</th>
                </tr></thead>
                <tbody>
                  {pendentesF.map((p, i) => {
                    return (
                    <tr key={p.cpf + p.data + i} style={{ borderBottom: `1px solid ${C.beigeLt}` }}>
                      <td style={td()}><div style={{ fontWeight: 600, color: C.espresso }}>{p.nome}</div>{p.funcao && <div style={{ fontSize: 11, color: C.gray }}>{p.funcao}</div>}</td>
                      <td style={td()}>{fmtData(p.data)}</td>
                      <td style={td()}>
                        <span style={{ display: 'inline-block', background: C.amberBg, color: C.amber, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                          {rotuloPendente(p)}
                        </span>
                      </td>
                      <td style={td()}>{p.setor || '—'}</td>
                      <td style={td()}>{p.jornada?.entrada ?? '—'}–{p.jornada?.saida ?? '—'}{p.shift ? ` · ${p.shift}` : ''}</td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────── GESTÃO (SST · #67) ───────────────────────────────────
// A visão gerencial: responde "está tudo em ordem este mês?" e "quem precisa de atenção agora?".
// SEM cifrão (655bb74b) — contagem e nome de setor, nunca valor. O conflito ponto×exposição
// (87 de 120 na validadora) aparece em destaque: pode mudar muito o número quando o SST confirmar.
type PainelGestao = {
  por_status: Record<string, number> | null
  tendencia_semana: { semana: string; desvios: number }[] | null
  por_setor: { setor: string; desvios: number }[] | null
  repetentes: { nome: string; cpf: string; dias_desvio: number }[] | null
  tipo_predominante: Record<string, number> | null
  sem_dado: { total: number; colaborador_sem_evento: number } | null
  com_conflito_ponto: number | null
}
const tipoDesvioLabel: Record<string, string> = { excedeu_limite: 'Exposição acima do limite', pausa_insuficiente: 'Pausa curta demais', pausa_nao_realizada: 'Pausa não realizada' }

function AbaGestao({ companyId }: { companyId: string }) {
  const hoje = new Date()
  const [ini, setIni] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)))
  const [fim, setFim] = useState(iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)))
  const [p, setP] = useState<PainelGestao | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('')
    try {
      const r = await rpc<{ painel: PainelGestao }>('fn_nr36_painel_gestao', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim })
      setP(r.painel)
    } catch (e) { setErro((e as Error).message) } finally { setCarregando(false) }
  }, [companyId, ini, fim])
  useEffect(() => { void carregar() }, [carregar])

  const st = p?.por_status || {}
  const maxSem = Math.max(1, ...(p?.tendencia_semana || []).map(w => w.desvios))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <Campo label="De"><input type="date" style={inp()} value={ini} onChange={e => setIni(e.target.value)} /></Campo>
        <Campo label="Até"><input type="date" style={inp()} value={fim} onChange={e => setFim(e.target.value)} /></Campo>
        <Btn onClick={() => carregar()} disabled={carregando}><RefreshCw size={14} /> {carregando ? 'Carregando…' : 'Atualizar'}</Btn>
      </div>
      {erro && <div style={erroBox()}>{erro}</div>}
      {!p ? <Load /> : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 14 }}>
            <Kpi label="Desvios" n={st.desvio || 0} cor={C.red} bg={C.redBg} />
            <Kpi label="Conformes" n={st.conforme || 0} cor={C.green} bg={C.greenBg} />
            <Kpi label="Aguardando" n={st.aguardando_realizado || 0} cor={C.blue} bg={C.blueBg} />
            <Kpi label="Sem evento" n={p.sem_dado?.total || 0} cor={C.gray} bg={C.beigeLt} />
          </div>

          {/* conflito ponto × exposição — em destaque, porque muda o número quando confirmado */}
          {(p.com_conflito_ponto ?? 0) > 0 && (
            <div style={{ display: 'flex', gap: 10, background: C.amberBg, border: `1px solid ${C.amber}55`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <AlertTriangle size={18} style={{ color: C.amber, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12.5, color: C.espresso, lineHeight: 1.5 }}>
                <b>{p.com_conflito_ponto} de {st.desvio || 0} desvios têm marcação de ponto dentro do período de exposição.</b> Pode ter havido interrupção não registrada como pausa — <b>o número de desvios pode mudar</b> quando a supervisão confirmar caso a caso. Cada caso mostra as batidas na aba Supervisão e no relatório.
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
            {/* tendência */}
            <div>
              <div style={secTitle()}>Tendência (desvios por semana)</div>
              {(p.tendencia_semana || []).length === 0 ? <div style={{ fontSize: 12, color: C.gray }}>Sem desvios no período.</div> :
                (p.tendencia_semana || []).map((w) => (
                  <div key={w.semana} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: C.gray, width: 82 }}>{fmtData(w.semana)}</span>
                    <span style={{ height: 14, background: C.red, borderRadius: 3, width: `${Math.round(100 * w.desvios / maxSem)}%`, minWidth: 6 }} />
                    <span style={{ fontSize: 12, color: C.espresso }}>{w.desvios}</span>
                  </div>
                ))}
            </div>
            {/* por setor */}
            <div>
              <div style={secTitle()}>Desvios por setor</div>
              {(p.por_setor || []).map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.espresso, padding: '4px 0', borderBottom: `1px solid ${C.beigeLt}` }}>
                  <span>{s.setor}</span><b>{s.desvios}</b>
                </div>
              ))}
            </div>
            {/* colaboradores que repetem */}
            <div>
              <div style={secTitle()}>Quem repete (2+ dias com desvio)</div>
              {(p.repetentes || []).length === 0 ? <div style={{ fontSize: 12, color: C.gray }}>Ninguém repete no período.</div> :
                (p.repetentes || []).map((r) => (
                  <div key={r.cpf} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.espresso, padding: '4px 0', borderBottom: `1px solid ${C.beigeLt}` }}>
                    <span>{r.nome}</span><b>{r.dias_desvio} dia(s)</b>
                  </div>
                ))}
            </div>
            {/* tipo predominante */}
            <div>
              <div style={secTitle()}>Tipo de desvio</div>
              {Object.entries(p.tipo_predominante || {}).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                <div key={t} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.espresso, padding: '4px 0', borderBottom: `1px solid ${C.beigeLt}` }}>
                  <span>{tipoDesvioLabel[t] || t}</span><b>{n}</b>
                </div>
              ))}
            </div>
          </div>

          {(p.sem_dado?.total ?? 0) > 0 && (
            <div style={{ fontSize: 12, color: C.gray, marginTop: 14, lineHeight: 1.5 }}>
              <b>{p.sem_dado?.total} dia(s) sem evento</b>: colaborador com ponto no período importado, mas sem registro de entrada no ambiente naquele dia. Não é desvio nem conformidade — é dado a confirmar. (Dias sem <b>planilha</b> importada são sinalizados na aba Painel.)
            </div>
          )}
        </div>
      )}
    </div>
  )
}
