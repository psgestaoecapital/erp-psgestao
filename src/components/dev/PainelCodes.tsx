'use client'
// Central de Desenvolvimento · aba "Codes" em TEMPO REAL (CEO 07/10 14:30). Por Code: TRABALHANDO AGORA, Entregue · 24 h,
// Em teste e Fila; faixa verde/vermelha no topo; linha do tempo das publicações do dia com filtro por data.
// Dados: erp_dev_entrega (workflow registrar-entrega.yml), erp_agente_mensagem, erp_agente_sessao_lease e erp_agente_rotina —
// leitura só da equipe PS (RLS fn_dev_painel_pode_ver, vale também no Realtime). Qualquer mudança nas 3 primeiras chega pelo
// Realtime e a aba recarrega sozinha, sem recarregar a página. Regras puras em src/lib/dev/painelCodes.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import MeuCode from '@/components/dev/MeuCode'
import {
  CODES_LINHA_FINAL, CODES_PRINCIPAIS, CODES_PAINEL, diaMes, diaSP, emAndamento, emTeste, entregues, estadoSessao, faixa,
  fila, hora, intervaloDia, quando, ultimaResposta,
  type Entrega, type Lease, type Mensagem, type Rotina,
} from '@/lib/dev/painelCodes'

// Identidade PS: Espresso (estrutura/texto) · Off-white (fundo) · Dourado (destaque). Verde/vermelho SÓ no semáforo.
const ESP = '#3D2314', OFF = '#FAF7F2', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const VERDE = '#166534', VERDE_BG = '#DCFCE7', VERM = '#B91C1C', VERM_BG = '#FEE2E2'

const COLS_ENTREGA = 'id,pr_numero,titulo,code,evento,via,sha,url,ocorrido_em'
const COLS_MSG = 'id,para,assunto,status,pr_numero,resposta,arquivada,criado_em,atualizado_em'
const FILA_VISIVEL = 6

type Dados = { entregas: Entrega[]; msgs: Mensagem[]; leases: Lease[]; rotinas: Rotina[]; linhaTempo: Entrega[] }

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
    const [ent, abertas, resp, leases, rotinas, linha] = await Promise.all([
      supabase.from('erp_dev_entrega').select(COLS_ENTREGA).gte('ocorrido_em', desde).order('ocorrido_em', { ascending: false }).limit(3000),
      supabase.from('erp_agente_mensagem').select(COLS_MSG).in('para', CODES_PAINEL as string[]).not('arquivada', 'is', true)
        .in('status', ['nova', 'recebida', 'em_andamento']).order('criado_em', { ascending: true }).limit(5000),
      supabase.from('erp_agente_mensagem').select(COLS_MSG).in('para', CODES_PAINEL as string[]).in('status', ['concluida', 'recusada'])
        .not('resposta', 'is', null).order('atualizado_em', { ascending: false }).limit(300),
      supabase.from('erp_agente_sessao_lease').select('agente,sessao_ref,iniciada_em,renovada_em'),
      supabase.from('erp_agente_rotina').select('agente,aciona'),
      supabase.from('erp_dev_entrega').select(COLS_ENTREGA).eq('evento', 'publicada').gte('ocorrido_em', de).lt('ocorrido_em', ate)
        .order('ocorrido_em', { ascending: false }).limit(500),
    ])
    const falha = [ent, abertas, resp, leases, rotinas, linha].find((r) => r.error)?.error
    if (falha) { setErro(falha.message); return }
    setErro(null)
    setDados({
      entregas: (ent.data ?? []) as Entrega[],
      msgs: [...((abertas.data ?? []) as Mensagem[]), ...((resp.data ?? []) as Mensagem[])],
      leases: (leases.data ?? []) as Lease[],
      rotinas: (rotinas.data ?? []) as Rotina[],
      linhaTempo: (linha.data ?? []) as Entrega[],
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
    const ch = supabase.channel('dev-codes-painel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_dev_entrega' }, () => agendar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_agente_mensagem' }, () => agendar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_agente_sessao_lease' }, () => agendar())
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
        </span>
      </div>

      {erro && <div role="alert" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 10, padding: 10, fontSize: 12, marginBottom: 10 }}>Não consegui ler os dados: {erro}</div>}

      {f && (
        <div data-testid="codes-faixa" data-cor={f.cor}
          style={{ background: f.cor === 'verde' ? VERDE_BG : VERM_BG, color: f.cor === 'verde' ? VERDE : VERM,
            border: `1px solid ${f.cor === 'verde' ? VERDE : VERM}`, borderRadius: 12, padding: '10px 14px', fontWeight: 600, fontSize: 14, marginBottom: 14 }}>
          ● {f.frase}
        </div>
      )}

      {/* Canal PS: o sócio dono de um Code pede direto a ele (só aparece para o dono) */}
      <MeuCode />

      {dados && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CODES_PRINCIPAIS.map((c) => <CartaoCode key={c} code={c} dados={dados} agora={agora} />)}
          </div>
          <div style={{ fontSize: 12, color: TXM, fontWeight: 600, margin: '16px 0 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Revisão e Eng. Chefe</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CODES_LINHA_FINAL.map((c) => <CartaoCode key={c} code={c} dados={dados} agora={agora} compacto />)}
          </div>
          <LinhaDoTempo itens={dados.linhaTempo} dia={dia} setDia={trocarDia} agora={agora} />
        </>
      )}
    </div>
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

function LinhaDoTempo({ itens, dia, setDia, agora }: { itens: Entrega[]; dia: string; setDia: (d: string) => void; agora: Date }) {
  return (
    <div data-testid="codes-linha-tempo" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 14, padding: 14, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 700 }}>Publicações do dia</span>
        <input data-testid="codes-filtro-data" type="date" value={dia} max={diaSP(agora)} onChange={(e) => e.target.value && setDia(e.target.value)}
          style={{ border: `1px solid ${BD}`, borderRadius: 8, padding: '4px 8px', color: ESP, background: OFF, fontFamily: 'inherit' }} />
      </div>
      {itens.length === 0 ? <Vazio t="nenhuma publicação neste dia" /> : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: `2px solid ${DOU}` }}>
          {itens.map((e) => (
            <li key={e.id} data-testid={`linha-tempo-${e.pr_numero}`} style={{ position: 'relative', padding: '4px 0 4px 12px', fontSize: 13, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ position: 'absolute', left: -5, top: 10, width: 8, height: 8, borderRadius: 8, background: DOU }} />
              <span style={{ color: TXM, minWidth: 40 }}>{hora(e.ocorrido_em)}</span>
              <span style={{ fontWeight: 600 }}>{e.code}</span>
              <LinkPr n={e.pr_numero} url={e.url} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.titulo}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
