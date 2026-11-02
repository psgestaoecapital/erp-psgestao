'use client'
// Central de Desenvolvimento · aba "Codes" em TEMPO REAL (CEO 07/10 14:30). Por Code: TRABALHANDO AGORA, Entregue · 24 h,
// Em teste e Fila; faixa verde/vermelha no topo; linha do tempo das publicações do dia com filtro por data.
// Dados: erp_dev_entrega (workflow registrar-entrega.yml), erp_agente_mensagem, erp_agente_sessao_lease e erp_agente_rotina —
// leitura só da equipe PS (RLS fn_dev_painel_pode_ver, vale também no Realtime). Qualquer mudança nas 3 primeiras chega pelo
// Realtime e a aba recarrega sozinha, sem recarregar a página. Regras puras em src/lib/dev/painelCodes.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { supabase } from '@/lib/supabase'
import GraficosCodes, { ProducaoCompacta } from './GraficosCodes'
import AvancoVertical from './AvancoVertical'
import SaudeEsteira from './SaudeEsteira'
import DiagnosticoEsteira from './DiagnosticoEsteira'
import BarrasQualidadeVertical from './BarrasQualidadeVertical'
import ProximasPublicacoes from './ProximasPublicacoes'
import CronogramaHub from './CronogramaHub'
import SaudeCodes from './SaudeCodes'
import { BlocoSeguro } from '@/components/dev/BlocoSeguro'
import MeuCode from '@/components/dev/MeuCode'
import { ConectarClaude, EsperandoOkCeo } from '@/components/dev/CanalPs'
import {
  AUDITOR_CODE, AUDITOR_LEGENDA, AUDITOR_NOME, estadoAuditor, lerAuditor, type AuditorResumo,
  CODES_LINHA_FINAL, CODES_PRINCIPAIS, CODES_PAINEL, diaMes, diaSP, duracao, emAndamento, emTeste, entregues, estadoSessao, faixa,
  esteira, fila, hora, intervaloDia, quando, resumoCode, ultimaResposta, type StatusCode,
  type Entrega, type Lease, type Mensagem, type Rotina,
} from '@/lib/dev/painelCodes'

// Identidade PS: Espresso (estrutura/texto) · Off-white (fundo) · Dourado (destaque). Verde/vermelho SÓ no semáforo.
const ESP = '#3D2314', OFF = '#FAF7F2', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const VERDE = '#166534', VERDE_BG = '#DCFCE7', VERM = '#B91C1C', VERM_BG = '#FEE2E2'

const COLS_ENTREGA = 'id,pr_numero,titulo,code,evento,via,sha,url,ocorrido_em'
const COLS_MSG = 'id,para,assunto,status,pr_numero,resposta,arquivada,criado_em,atualizado_em'
const FILA_VISIVEL = 6

type MainTeste = { verde: boolean | null; desde: string | null; spec_falha: string | null; run_url: string | null }
type Dados = { auditor: AuditorResumo | null; entregas: Entrega[]; msgs: Mensagem[]; leases: Lease[]; rotinas: Rotina[]; linhaTempo: Entrega[]; mainTeste: MainTeste | null; filaTestes: number | null }

export default function PainelCodes() {
  const [pode, setPode] = useState<boolean | null>(null)
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizado, setAtualizado] = useState<Date | null>(null)
  const [aoVivo, setAoVivo] = useState(false)
  const [agora, setAgora] = useState(() => new Date())
  const [dia, setDia] = useState(() => diaSP(new Date()))
  const diaRef = useRef(dia)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const { data, error } = await supabase.rpc('fn_dev_painel_pode_ver')
      if (vivo) setPode(!error && data === true)
    })()
    return () => { vivo = false }
  }, [])

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - 14 * 864e5).toISOString()
    const { de, ate } = intervaloDia(diaRef.current)
    const [ent, abertas, resp, leases, rotinas, linha, mt, estat, aud] = await Promise.all([
      supabase.from('erp_dev_entrega').select(COLS_ENTREGA).gte('ocorrido_em', desde).order('ocorrido_em', { ascending: false }).limit(3000),
      supabase.from('erp_agente_mensagem').select(COLS_MSG).in('para', CODES_PAINEL as string[]).not('arquivada', 'is', true)
        .in('status', ['nova', 'recebida', 'em_andamento']).order('criado_em', { ascending: true }).limit(5000),
      supabase.from('erp_agente_mensagem').select(COLS_MSG).in('para', CODES_PAINEL as string[]).in('status', ['concluida', 'recusada'])
        .not('resposta', 'is', null).order('atualizado_em', { ascending: false }).limit(300),
      supabase.from('erp_agente_sessao_lease').select('agente,sessao_ref,iniciada_em,renovada_em'),
      supabase.from('erp_agente_rotina').select('agente,aciona'),
      supabase.from('erp_dev_entrega').select(COLS_ENTREGA).eq('evento', 'publicada').gte('ocorrido_em', de).lt('ocorrido_em', ate)
        .order('ocorrido_em', { ascending: false }).limit(500),
      supabase.from('erp_dev_main_teste').select('verde,desde,spec_falha,run_url').eq('id', 1).maybeSingle(),
      supabase.from('erp_dev_esteira_status').select('chave,verde,quantidade'),
      supabase.rpc('fn_dev_auditor_resumo'),
    ])
    // erp_dev_main_teste pode não existir em ambientes sem a migration: o erro dela não derruba a aba.
    const falha = [ent, abertas, resp, leases, rotinas, linha].find((r) => r.error)?.error
    if (falha) { setErro(falha.message); return }
    setErro(null)
    setDados({
      auditor: aud.error ? null : lerAuditor(aud.data),
      entregas: (ent.data ?? []) as Entrega[],
      msgs: [...((abertas.data ?? []) as Mensagem[]), ...((resp.data ?? []) as Mensagem[])],
      leases: (leases.data ?? []) as Lease[],
      rotinas: (rotinas.data ?? []) as Rotina[],
      linhaTempo: (linha.data ?? []) as Entrega[],
      mainTeste: (mt.error ? null : (mt.data as MainTeste | null)),
      filaTestes: (estat.data ?? []).find((x: { chave: string }) => x.chave === 'fila')?.quantidade ?? null,
    })
    const n = new Date()
    setAtualizado(n); setAgora(n)
  }, [])

  // carga + Realtime (as 3 tabelas na publicação supabase_realtime; a RLS decide quem recebe)
  useEffect(() => {
    if (!pode) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const agendar = (ms = 600) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { void carregar() }, ms) }
    agendar(0)
    const ch = supabase.channel(`dev-codes-painel-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_dev_entrega' }, () => agendar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_agente_mensagem' }, () => agendar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_agente_sessao_lease' }, () => agendar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_dev_esteira_status' }, () => agendar())
      .subscribe((st) => setAoVivo(st === 'SUBSCRIBED'))
    return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(ch) }
  }, [pode, carregar])

  // relógio: a sessão expira sozinha (12 min sem renovar) e a faixa depende da hora; sem Realtime, recarrega a cada 1 min
  useEffect(() => {
    if (!pode) return
    const i = setInterval(() => { setAgora(new Date()); if (!aoVivo) void carregar() }, 60_000)
    return () => clearInterval(i)
  }, [pode, aoVivo, carregar])

  const trocarDia = (d: string) => { diaRef.current = d; setDia(d); void carregar() }

  const f = useMemo(() => (dados ? faixa({ entregas: dados.entregas, msgs: dados.msgs, leases: dados.leases, agora }) : null), [dados, agora])
  const est = useMemo(() => (dados ? esteira({
    entregas: dados.entregas, agora,
    mainVerde: dados.mainTeste?.verde ?? null,
    mainDesde: dados.mainTeste?.desde ? new Date(dados.mainTeste.desde) : null,
    specFalha: dados.mainTeste?.spec_falha ?? null,
    filaTestes: dados.filaTestes,
  }) : null), [dados, agora])
  const resumos = useMemo(
    () => (dados ? CODES_PRINCIPAIS.map((code) => resumoCode({ code, entregas: dados.entregas, msgs: dados.msgs, leases: dados.leases, rotinas: dados.rotinas, agora })) : []),
    [dados, agora],
  )

  if (pode === null) return <div style={{ color: TXM, fontSize: 13, padding: 16 }}>Conferindo acesso…</div>
  if (!pode) {
    return (
      <div data-testid="codes-acesso-negado" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 20, color: ESP, maxWidth: 520 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Acesso restrito à equipe PS</div>
        <div style={{ fontSize: 13, color: TXM }}>A aba Codes mostra o trabalho dos agentes de desenvolvimento e só abre para a equipe PS.</div>
      </div>
    )
  }

  return (
    <div data-testid="codes-painel" style={{ color: ESP, background: OFF }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Codes</h2>
        <span data-testid="codes-atualizado" style={{ fontSize: 12, color: TXM }}>
          {atualizado ? `Atualizado ${diaMes(atualizado)} · ${hora(atualizado)}` : 'Carregando…'}
          {' '}<b style={{ color: aoVivo ? DOU : TXM }}>{aoVivo ? '(ao vivo)' : '(reconectando…)'}</b>
          {(() => {
            // Idade do dado em vermelho quando > 2 min (CEO 26/10): deixa claro que a foto está velha
            // — a esteira pode ter publicado e o painel ainda não recarregou. `agora` recomputa a cada 60 s.
            if (!atualizado) return null
            const min = Math.floor((agora.getTime() - atualizado.getTime()) / 60000)
            if (min < 2) return null
            return <b data-testid="codes-dado-velho" title="O painel não recarregou há mais de 2 min — pode haver publicação mais recente ainda não refletida." style={{ color: VERM, marginLeft: 6 }}>· dado de {min} min atrás</b>
          })()}
        </span>
      </div>

      {erro && <div role="alert" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 10, padding: 10, fontSize: 12, marginBottom: 10 }}>Não consegui ler os dados: {erro}</div>}

      {/* UMA TELA DE MONITOR (CEO 24/10): faixa da esteira enxuta; linha 1 = fila viva · publicações do dia · qualidade por vertical;
          linha 2 (logo abaixo) = resumo por Code · produzidas × publicadas por hora · saúde da esteira. Empilha no celular. */}
      {est && f && <BlocoSeguro nome="Faixa da esteira"><FaixaEsteira e={est} alerta={f.cor === 'vermelha' ? f.frase : null} agora={agora} /></BlocoSeguro>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start" data-testid="codes-topo-3col">
        <div style={{ minWidth: 0, maxHeight: 'min(46vh, 400px)', overflowY: 'auto' }}><BlocoSeguro nome="Próximas publicações"><ProximasPublicacoes /></BlocoSeguro></div>
        {dados && <div style={{ minWidth: 0, maxHeight: 'min(46vh, 400px)', overflowY: 'auto' }}><BlocoSeguro nome="Publicações do dia"><LinhaDoTempo itens={dados.linhaTempo} dia={dia} setDia={trocarDia} agora={agora} /></BlocoSeguro></div>}
        <div style={{ minWidth: 0 }}><BlocoSeguro nome="Qualidade por vertical"><BarrasQualidadeVertical altura={230} /></BlocoSeguro></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start mt-3" data-testid="codes-linha-2">
        <div style={{ minWidth: 0 }}>{resumos.length > 0 && <BlocoSeguro nome="Resumo por Code"><ResumoPorCode itens={resumos} agora={agora} /></BlocoSeguro>}</div>
        <div style={{ minWidth: 0 }}>{dados && <BlocoSeguro nome="Produzidas × publicadas por hora"><ProducaoCompacta entregas={dados.entregas} agora={agora} /></BlocoSeguro>}</div>
        <div style={{ minWidth: 0 }}><BlocoSeguro nome="Saúde da esteira"><SaudeEsteira compacto /></BlocoSeguro></div>
      </div>

      {/* Detalhe e diagnóstico (abaixo da primeira tela) */}
      <div style={{ marginTop: 12 }}><BlocoSeguro nome="Gráficos"><GraficosCodes semProducao /></BlocoSeguro></div>
      <BlocoSeguro nome="Avanço por vertical"><AvancoVertical /></BlocoSeguro>
      <BlocoSeguro nome="Diagnóstico da esteira"><DiagnosticoEsteira /></BlocoSeguro>
      <BlocoSeguro nome="Cronograma do Hub"><CronogramaHub /></BlocoSeguro>
      <BlocoSeguro nome="Saúde dos Codes"><SaudeCodes /></BlocoSeguro>

      {/* Canal PS: o sócio dono de um Code pede direto a ele (só aparece para o dono) */}
      <BlocoSeguro nome="Meu Code"><MeuCode /></BlocoSeguro>
      <BlocoSeguro nome="Esperando OK do CEO"><EsperandoOkCeo /></BlocoSeguro>

      {dados && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {CODES_PRINCIPAIS.map((c) => <BlocoSeguro key={c} nome={c}><CartaoCode code={c} dados={dados} agora={agora} /></BlocoSeguro>)}
          </div>
          {CODES_LINHA_FINAL.length > 0 && <>
          <div style={{ fontSize: 12, color: TXM, fontWeight: 600, margin: '16px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Outros Codes</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {CODES_LINHA_FINAL.map((c) => c === AUDITOR_CODE
              ? <BlocoSeguro key={c} nome={AUDITOR_NOME}><CartaoAuditor dados={dados} agora={agora} /></BlocoSeguro>
              : <BlocoSeguro key={c} nome={c}><CartaoCode code={c} dados={dados} agora={agora} compacto /></BlocoSeguro>)}
          </div>
          </>}
          <BlocoSeguro nome="Conectar Claude"><ConectarClaude /></BlocoSeguro>
        </>
      )}
    </div>
  )
}

const COR_ESTEIRA = {
  verde: { bg: VERDE_BG, fg: VERDE }, amarela: { bg: '#FEF3C7', fg: '#92400E' }, vermelha: { bg: VERM_BG, fg: VERM },
} as const
const COR_STATUS: Record<StatusCode, { bg: string; fg: string; ico: string; nome: string; ajuda: string }> = {
  trabalhando: { bg: VERDE_BG, fg: VERDE, ico: '●', nome: 'Trabalhando', ajuda: 'Tem sessão ativa (renovada há menos de 12 min).' },
  travado: { bg: VERM_BG, fg: VERM, ico: '■', nome: 'Travado', ajuda: 'Há trabalho pendente (tarefa aberta ou PR parada) e o plantão não é atualizado há mais de 30 min, sem sessão ativa. Sessão encerrada normalmente não é Travado.' },
  na_fila: { bg: '#FEF3C7', fg: '#92400E', ico: '◔', nome: 'Na fila', ajuda: 'Tem tarefa NOVA esperando há menos de 15 min (ou há sessão recente que vai lê-la).' },
  esperando: { bg: '#FEF3C7', fg: '#92400E', ico: '◐', nome: 'Esperando', ajuda: 'Sem sessão, mas tem PR em teste ou aguardando autorização.' },
  agendado: { bg: '#E0ECFF', fg: '#1E40AF', ico: '◇', nome: 'Agendado', ajuda: 'Tarefa agendada LIGADA: roda sozinho a cada hora (plantão) e acorda ao receber mensagem. Sem sessão ativa neste instante — não é "dormindo".' },
  dormindo: { bg: OFF, fg: TXM, ico: '○', nome: 'Dormindo', ajuda: 'Sem sessão e sem rotina agendada: só acorda ao receber mensagem.' },
}

function FaixaEsteira({ e, alerta, agora }: { e: ReturnType<typeof esteira>; alerta: string | null; agora: Date }) {
  const c = COR_ESTEIRA[e.cor]
  const pub = e.ultimaPub ? `publicou ${hora(e.ultimaPub)} (há ${duracao(agora.getTime() - e.ultimaPub.getTime())})` : 'sem publicação nos últimos 7 dias'
  const main = e.mainVerde === null ? 'teste da main sem dado'
    : e.mainVerde ? 'teste da main verde'
    : `teste da main VERMELHO${e.mainDesde ? ` há ${duracao(agora.getTime() - e.mainDesde.getTime())}` : ''}${e.specFalha ? ` — ${e.specFalha}` : ''}`
  const filaT = e.filaTestes === null ? 'fila de testes sem dado' : `fila de testes ${e.filaTestes} esperando`
  return (
    <div data-testid="codes-faixa" data-cor={e.cor}
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.fg}`, borderRadius: 12, padding: '10px 14px', fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
      <span data-testid="codes-esteira">● Esteira: {pub} · PRs prontas {e.prontas} · {main} · {filaT}</span>
      {alerta && <div style={{ fontWeight: 500, fontSize: 12, marginTop: 4 }}>{alerta}</div>}
      <details style={{ fontWeight: 400, fontSize: 12, marginTop: 4 }}>
        <summary style={{ cursor: 'pointer' }} aria-label="O que significa">?</summary>
        Verde: publicou na última hora e a main não está vermelha. Amarelo: sem publicação há mais de 1 h. Vermelho: main vermelha ou teste parado há mais de 90 min.
      </details>
    </div>
  )
}

function ResumoPorCode({ itens, agora }: { itens: ReturnType<typeof resumoCode>[]; agora: Date }) {
  return (
    <section data-testid="codes-resumo" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 12 }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Resumo por Code</h3>
        <span style={{ fontSize: 11, color: TXM }}>{itens.filter((r) => r.status === 'trabalhando').length} de {itens.length} trabalhando agora</span>
        <details style={{ fontSize: 11, color: TXM, marginLeft: 'auto' }}>
          <summary style={{ cursor: 'pointer' }} aria-label="O que significam os status">?</summary>
          <div style={{ position: 'absolute', zIndex: 5, background: BRANCO, border: `1px solid ${BD}`, borderRadius: 8, padding: 8, maxWidth: 320 }}>
            {(Object.keys(COR_STATUS) as StatusCode[]).map((k) => <div key={k}><b>{COR_STATUS[k].nome}:</b> {COR_STATUS[k].ajuda}</div>)}
            <div><b>Colunas:</b> fila = tarefas na caixa; teste = PRs abertas; hoje = PRs publicadas hoje.</div>
            <div><b>Plantão permanente:</b> nunca entra na fila (não é concluído por desenho). <b>Fila antiga:</b> há mais de 24 h; nunca conta como Travado.</div>
          </div>
        </details>
      </header>
      <div style={{ display: 'grid', gap: 4 }}>
        {itens.map((r) => {
          const s = COR_STATUS[r.status]
          const sessao = r.status === 'agendado' && r.ultimaSessaoMin === null ? 'roda sozinho a cada hora'
            : `última sessão ${r.status === 'trabalhando' ? 'agora' : r.ultimaSessaoMin === null ? '—' : `há ${duracao(r.ultimaSessaoMin * 60_000)}`}`
          return (
            <a key={r.code} href={`#card-code-${r.code}`} data-testid={`resumo-${r.code}`} data-status={r.status} title={`${r.fazendo} · ${sessao} · não lidas ${r.naoLidas}`}
              onClick={(ev) => { ev.preventDefault(); document.querySelector(`[data-testid="card-code-${r.code}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) auto minmax(0,1fr)', alignItems: 'center', gap: 8, textDecoration: 'none', color: ESP, border: `1px solid ${BD}`, borderRadius: 8, padding: '5px 8px', background: OFF }}>
              <span style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.code}</span>
              <span data-testid={`resumo-status-${r.code}`} style={{ fontSize: 10.5, fontWeight: 700, background: s.bg, color: s.fg, border: `1px solid ${s.fg}`, borderRadius: 999, padding: '0 7px', whiteSpace: 'nowrap' }}>
                {s.ico} {s.nome}{r.desde ? ` ${hora(r.desde)}` : ''}
              </span>
              <span style={{ fontSize: 11, color: TXM, textAlign: 'right', whiteSpace: 'nowrap' }}>
                fila {r.fila}{r.filaAntiga > 0 ? `+${r.filaAntiga}` : ''} · teste {r.emTeste} · hoje {r.entreguesHoje}
              </span>
            </a>
          )
        })}
      </div>
      <div style={{ fontSize: 10.5, color: TXM, marginTop: 6 }}>Passe o mouse na linha: o que está fazendo e a última sessão. Clique: abre o cartão do Code.</div>
    </section>
  )
}

function Bloco({ titulo, children, testid }: { titulo: string; children: React.ReactNode; testid: string }) {
  return (
    <div data-testid={testid} style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: TXM, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{titulo}</div>
      {children}
    </div>
  )
}
const Vazio = ({ t }: { t: string }) => <div style={{ fontSize: 12, color: TXM }}>{t}</div>
const LinkPr = ({ n, url }: { n: number; url: string | null }) =>
  url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: DOU, fontWeight: 700, textDecoration: 'none' }}>#{n}</a> : <b>#{n}</b>

function CartaoCode({ code, dados, agora, compacto }: { code: string; dados: Dados; agora: Date; compacto?: boolean }) {
  const sessao = estadoSessao(dados.leases.find((l) => l.agente === code), agora)
  const andando = emAndamento(dados.msgs, code)
  const resp = ultimaResposta(dados.msgs, code)
  const entregue = entregues(dados.entregas, code, agora)
  const teste = emTeste(dados.entregas, code)
  const filaCode = fila(dados.msgs, code)
  const rotina = dados.rotinas.find((r) => r.agente === code)

  return (
    <div data-testid={`card-code-${code}`} style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 14, padding: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{code}</span>
        {rotina && !rotina.aciona && <span style={{ fontSize: 10, color: TXM, border: `1px solid ${BD}`, borderRadius: 999, padding: '2px 8px' }}>rotina desligada</span>}
      </div>

      {/* (1) TRABALHANDO AGORA */}
      <div data-testid={`card-agora-${code}`} data-ativo={sessao.ativa ? 'sim' : 'nao'}
        style={{ marginTop: 10, borderRadius: 10, padding: 10, background: sessao.ativa ? ESP : OFF, color: sessao.ativa ? OFF : ESP,
          border: `1px solid ${sessao.ativa ? ESP : BD}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: sessao.ativa ? DOU : TXM }}>TRABALHANDO AGORA</div>
        {sessao.ativa ? (
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {andando[0]
              ? <>{andando[0].pr_numero ? <b>#{andando[0].pr_numero} · </b> : null}{andando[0].assunto || 'tarefa sem assunto'}</>
              : 'sessão ativa, sem tarefa em andamento'}
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
              sessão desde {quando(sessao.desde, agora)}{andando.length > 1 ? ` · ${andando.length} em andamento` : ''}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {sessao.paradoDesde ? `parado desde ${quando(sessao.paradoDesde, agora)}` : 'parado (sem sessão registrada)'}
            {andando.length > 0 && <div style={{ fontSize: 11, color: TXM, marginTop: 2 }}>{andando.length} marcada(s) em andamento sem sessão ativa</div>}
          </div>
        )}
        {!compacto && resp && (
          <div style={{ fontSize: 11, marginTop: 6, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={resp.resposta ?? ''}>última resposta ({quando(resp.atualizado_em ?? resp.criado_em, agora)}): {resp.resposta}</div>
        )}
      </div>

      {/* (2) Entregue · 24 h */}
      <Bloco titulo="Entregue · 24 h" testid={`card-entregue-${code}`}>
        {entregue.length === 0 ? <Vazio t="nada publicado nas últimas 24 h" /> : entregue.map((e) => (
          <div key={e.id} data-testid={`entrega-${e.pr_numero}`} style={{ fontSize: 13, display: 'flex', gap: 6, minWidth: 0 }}>
            <span style={{ color: TXM, flexShrink: 0 }}>{quando(e.ocorrido_em, agora)}</span>
            <LinkPr n={e.pr_numero} url={e.url} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.titulo}</span>
          </div>
        ))}
      </Bloco>

      {/* (3) Em teste */}
      <Bloco titulo="Em teste" testid={`card-teste-${code}`}>
        {teste.length === 0 ? <Vazio t="nenhuma PR aberta" /> : teste.map((p) => (
          <div key={p.pr_numero} style={{ fontSize: 13, display: 'flex', gap: 6, minWidth: 0 }}>
            <LinkPr n={p.pr_numero} url={p.url} />
            <span style={{ fontSize: 10, color: TXM, border: `1px solid ${BD}`, borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>
              {p.pronta ? 'pronta' : 'rascunho'}{p.via === 'revisada' ? ' · revisada' : ''}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.titulo}</span>
          </div>
        ))}
      </Bloco>

      {/* (4) Fila */}
      <Bloco titulo={`Fila${filaCode.length ? ` · ${filaCode.length.toLocaleString('pt-BR')}` : ''}`} testid={`card-fila-${code}`}>
        {filaCode.length === 0 ? <Vazio t="fila vazia" /> : (
          <>
            {filaCode.slice(0, FILA_VISIVEL).map((m) => (
              <div key={m.id} style={{ fontSize: 13, display: 'flex', gap: 6, minWidth: 0 }}>
                <span style={{ color: TXM, flexShrink: 0 }}>{quando(m.criado_em, agora)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.assunto || 'sem assunto'}{m.status === 'recebida' ? ' (recebida)' : ''}
                </span>
              </div>
            ))}
            {filaCode.length > FILA_VISIVEL && <Vazio t={`e mais ${(filaCode.length - FILA_VISIVEL).toLocaleString('pt-BR')} na fila`} />}
          </>
        )}
      </Bloco>
    </div>
  )
}

const COR_AUDITOR = {
  trabalhando: { bg: VERDE_BG, fg: VERDE, nome: 'Auditando agora' },
  plantao: { bg: '#FEF3C7', fg: '#92400E', nome: 'Em plantão' },
  dormindo: { bg: OFF, fg: TXM, nome: 'Dormindo' },
} as const
const VEREDITOS_AUDITOR = ['OURO', 'BRONZE', 'BLOQUEADO', 'PENDENTE']

function CartaoAuditor({ dados, agora }: { dados: Dados; agora: Date }) {
  const est = estadoAuditor(dados.leases.find((l) => l.agente === AUDITOR_CODE), agora)
  const c = COR_AUDITOR[est.estado]
  const a = dados.auditor
  const chaves = a ? [...VEREDITOS_AUDITOR, ...Object.keys(a.vereditos).filter((k) => !VEREDITOS_AUDITOR.includes(k))] : []
  return (
    <div data-testid={`card-code-${AUDITOR_CODE}`} data-estado={est.estado}
      style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 14, padding: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{AUDITOR_NOME}</span>
        <span data-testid="auditor-estado" style={{ fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg, border: `1px solid ${c.fg}`, borderRadius: 999, padding: '1px 8px' }}>{c.nome}</span>
      </div>
      <div style={{ fontSize: 12, color: TXM, marginTop: 2 }}>{AUDITOR_LEGENDA}</div>
      <Bloco titulo="Última sessão" testid="auditor-sessao">
        <div style={{ fontSize: 13 }}>{est.estado === 'trabalhando' ? 'sessão ativa agora' : est.ultima ? quando(est.ultima, agora) : 'nenhuma sessão registrada'}</div>
      </Bloco>
      <Bloco titulo="Auditado hoje" testid="auditor-hoje">
        {!a ? <Vazio t="sem dados de auditoria ainda" /> : (
          <div style={{ fontSize: 13 }}>
            <b data-testid="auditor-prs">{a.prs_hoje}</b> PRs · <b data-testid="auditor-telas">{a.telas_hoje}</b> telas
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {chaves.map((k) => (
                <span key={k} data-testid={`auditor-veredito-${k}`} style={{ fontSize: 11, border: `1px solid ${BD}`, borderRadius: 999, padding: '1px 8px' }}>{k} {a.vereditos[k] ?? 0}</span>
              ))}
            </div>
          </div>
        )}
      </Bloco>
      <Bloco titulo="Último relatório" testid="auditor-ultimo">
        {a?.ultimo ? (
          <div style={{ fontSize: 13 }}>
            {quando(a.ultimo.quando, agora)}{' · '}
            {a.ultimo.rota ? <a href={a.ultimo.rota} style={{ color: DOU, fontWeight: 700, textDecoration: 'none' }}>{a.ultimo.rota}</a> : (a.ultimo.screen_id ?? 'tela não identificada')}
          </div>
        ) : <Vazio t="nenhuma auditoria registrada" />}
      </Bloco>
      <details style={{ fontSize: 12, marginTop: 8 }}>
        <summary style={{ cursor: 'pointer' }} aria-label="O que é o Code-Auditor">?</summary>
        Auditor de plantão: confere no dado, sem supor (RD-38), se as PRs e telas publicadas respeitam a RD-97 (nenhuma mudança pode gerar instabilidade,
        perda de dado ou regressão). Os vereditos vêm da auditoria Gold (OURO, BRONZE, BLOQUEADO, PENDENTE). "Dormindo" = nenhuma sessão nas últimas 24 h.
      </details>
    </div>
  )
}

const LINHA_CELULAR = 8

function LinhaDoTempo({ itens, dia, setDia, agora }: { itens: Entrega[]; dia: string; setDia: (d: string) => void; agora: Date }) {
  const [todas, setTodas] = useState(false)
  return (
    <div data-testid="codes-linha-tempo" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 700 }}>Publicações do dia</span><AjudaCampo chave="dev.codes.filtro_data" rota="/dashboard/dev/codes" />
        <input data-testid="codes-filtro-data" type="date" value={dia} max={diaSP(agora)} onChange={(e) => e.target.value && setDia(e.target.value)}
          style={{ border: `1px solid ${BD}`, borderRadius: 8, padding: '4px 8px', color: ESP, background: OFF, fontFamily: 'inherit' }} />
      </div>
      {itens.length === 0 ? <Vazio t="nenhuma publicação neste dia" /> : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: `2px solid ${DOU}` }}>
          {itens.map((e, i) => (
            <li key={e.id} data-testid={`linha-tempo-${e.pr_numero}`} className={!todas && i >= LINHA_CELULAR ? 'hidden md:flex' : 'flex'} style={{ position: 'relative', padding: '4px 0 4px 12px', fontSize: 13, gap: 6, flexWrap: 'wrap' }}>
              <span style={{ position: 'absolute', left: -5, top: 10, width: 8, height: 8, borderRadius: 8, background: DOU }} />
              <span style={{ color: TXM, minWidth: 40 }}>{hora(e.ocorrido_em)}</span>
              <span style={{ fontWeight: 600 }}>{e.code}</span>
              <LinkPr n={e.pr_numero} url={e.url} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.titulo}</span>
            </li>
          ))}
        </ol>
      )}
      {itens.length > LINHA_CELULAR && (
        <button type="button" data-testid="codes-ver-todas" className="md:hidden" onClick={() => setTodas((v) => !v)}
          style={{ marginTop: 8, border: 'none', background: 'none', color: DOU, fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}>
          {todas ? 'ver menos' : `ver todas (${itens.length})`}
        </button>
      )}
    </div>
  )
}
