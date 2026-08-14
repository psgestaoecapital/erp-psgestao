'use client'
// F3 · Conectores (ERPs) Industrial — cadastro plug-and-play do ATAK.
// Um frigorífico entra em ~15 min pela tela: preenche host/banco/usuário, a senha
// vai pro Vault (fn_atak_secret_set), gera-se o token do Agente PS, e o monitor
// (semáforo do erp_sync_log) mostra se a carga está chegando. Trocar de servidor =
// editar 1 campo aqui (RD-52), não na máquina do cliente.
import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = { bg: '#FAF7F2', card: '#FFFFFF', card2: '#F5EFE4', bd: '#E7DECF', go: '#C8941A', gol: '#A57A15', tx: '#3D2314', txm: '#6B5D4F', txd: '#9C8E80', g: '#16A34A', r: '#B91C1C', y: '#B45309', b: '#2563EB' }

const SEMAFORO: Record<string, { cor: string; label: string }> = {
  verde:     { cor: C.g,   label: 'Coletando' },
  amarelo:   { cor: C.y,   label: 'Atrasado' },
  vermelho:  { cor: C.r,   label: 'Parado' },
  sem_dados: { cor: C.txd, label: 'Sem dados ainda' },
}

// slug pro nome do arquivo (instalador-frioeste.zip) — sem acento/espaço.
const slug = (s: string) =>
  (s || 'empresa').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'empresa'

// Guia de 1 página que vai dentro do .zip (o mesmo do #966 · collectors/atak-agente/LEIA-ME.md).
const LEIA_ME_TEXTO = `# PS Agente ATAK — instalação em 3 passos

> Guia de 1 página para o TI do cliente. **A senha do SQL fica só nesta máquina — nunca vai pra PS.**

## O que você recebeu (no .zip)
- **agente-atak.exe** — o coletor (não precisa instalar Node).
- **nssm.exe** — utilitário que registra o coletor como serviço do Windows (fica ao lado do .exe; não mexa).
- **config.json** — já vem com o endereço da PS e o **token desta empresa** (não mexa).
- **instalar.bat** — instala o serviço com 1 duplo-clique.
- **LEIA-ME.md** — este guia.

## Passo a passo
1. **Copie a pasta** do instalador para o **servidor** (o mesmo que enxerga o SQL Server).
2. **Duplo-clique em instalar.bat.** (Se o Windows pedir, confirme "Executar como administrador".)
3. Quando aparecer **"Digite a senha do usuário de LEITURA do SQL Server"**, digite a senha e **Enter**.
   - A senha é **gravada criptografada** aqui na máquina (cred.dat, DPAPI do Windows) e **não é enviada pra PS**.

Pronto. Em ~1 minuto a tela da PS acende **verde** (conectou). Se acender **vermelho**, a mensagem diz o porquê
em português: **rede** (não alcança o host), **senha** (credencial inválida) ou **banco** (sem acesso).

## Depois (não precisa mexer)
- O serviço **"PS Agente ATAK"** roda sozinho, reinicia com a máquina e **coleta a cada ~15 min**.
- **Trocou de servidor/host?** A PS ajusta na tela — **você não toca na máquina**. O agente pega no próximo ciclo.

## Comandos úteis (opcional, prompt na pasta do .exe)
- \`agente-atak.exe --testar\` — testa a conexão agora (SELECT 1) e mostra o resultado.
- \`agente-atak.exe --set-senha\` — troca a senha local (se o usuário de leitura mudar).
- \`agente-atak.exe --desinstalar-servico\` — remove o serviço.

## Log
- \`agente.log\` (ao lado do .exe) registra cada ciclo e qualquer erro, em português.
`

type Conexao = {
  host: string; porta: number; banco: string; cod_filial: string; usuario: string
  dominios: string[] | null; sync_minuto: number; ativo: boolean; tem_senha: boolean; agente_token: string | null
}
type Monitor = {
  semaforo: string; ultimo_sucesso: string | null; horas_desde_sucesso: number | null
  ultima_fase: string | null; ultimo_erro: string | null; ultimo_host: string | null
  ultima_versao: string | null; ultimo_dominio: string | null; ultimos_gravados: string | null
}
type Teste = { status: string; resultado: string | null; solicitado_em: string | null; respondido_em: string | null }
type Listar = { company_id: string; nome: string | null; conexao: Conexao | null; monitor?: Monitor; teste?: Teste | null }
type AgenteStatus = { versao_agente: string | null; hostname: string | null; ultima_carga: string | null; status: string | null; ultimo_heartbeat: string | null }

export default function ConectoresIndustrialPage() {
  const { companyIds, selInfo, loading: compLoading, sel } = useCompanyIds()
  const empresaUnica = selInfo?.tipo === 'empresa' && sel && companyIds.length === 1 ? sel : null

  const [dados, setDados] = useState<Listar | null>(null)
  const [agente, setAgente] = useState<AgenteStatus | null>(null)
  const [dominiosDisp, setDominiosDisp] = useState<string[]>([])
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showToken, setShowToken] = useState(false)

  // form
  const [f, setF] = useState({ host: '', porta: 1433, banco: '', cod_filial: '100', usuario: '', senha: '', sync_minuto: 15, ativo: true })
  const [doms, setDoms] = useState<Set<string>>(new Set())

  const carregar = useCallback(async (companyId: string) => {
    const [{ data }, dm, ag] = await Promise.all([
      supabase.rpc('fn_atak_conexao_listar', { p_company_id: companyId }),
      supabase.from('atak_fonte_mapa').select('dominio').eq('ativo', true),
      supabase.from('erp_agente_status').select('versao_agente,hostname,ultima_carga,status,ultimo_heartbeat').eq('company_id', companyId).maybeSingle(),
    ])
    const d = data as Listar | null
    setDados(d)
    setAgente((ag.data as AgenteStatus | null) ?? null)
    const domsList = Array.from(new Set(((dm.data as { dominio: string }[]) ?? []).map((x) => x.dominio)))
    setDominiosDisp(domsList)
    const cx = d?.conexao
    if (cx) {
      setF({ host: cx.host ?? '', porta: cx.porta ?? 1433, banco: cx.banco ?? '', cod_filial: cx.cod_filial ?? '100', usuario: cx.usuario ?? '', senha: '', sync_minuto: cx.sync_minuto ?? 15, ativo: cx.ativo ?? true })
      setDoms(new Set(cx.dominios ?? domsList))
    } else {
      setDoms(new Set(domsList))
    }
  }, [])

  useEffect(() => {
    if (compLoading || !empresaUnica) { setDados(null); return }
    void carregar(empresaUnica)
  }, [empresaUnica, compLoading, carregar])

  const salvar = async () => {
    if (!empresaUnica) return
    if (!f.host || !f.banco || !f.usuario) { setMsg({ t: 'Preencha host, banco e usuário.', ok: false }); return }
    setBusy('salvar'); setMsg(null)
    const { data, error } = await supabase.rpc('fn_atak_conexao_salvar', {
      p_company_id: empresaUnica, p_host: f.host, p_porta: Number(f.porta), p_banco: f.banco,
      p_cod_filial: f.cod_filial, p_usuario: f.usuario,
      p_senha: f.senha ? f.senha : null,
      p_dominios: doms.size ? Array.from(doms) : null,
      p_sync_minuto: Number(f.sync_minuto), p_ativo: f.ativo,
    })
    setBusy(null)
    if (error) { setMsg({ t: 'Erro ao salvar: ' + error.message, ok: false }); return }
    const j = data as { tem_senha?: boolean } | null
    setMsg({ t: `Conexão salva.${j?.tem_senha ? ' Senha guardada no Vault.' : ' (sem senha — informe a senha ao menos uma vez)'}`, ok: true })
    setF((p) => ({ ...p, senha: '' }))
    await carregar(empresaUnica)
  }

  const testar = async () => {
    if (!empresaUnica) return
    setBusy('testar'); setMsg(null)
    const { data, error } = await supabase.rpc('fn_atak_testar_conexao', { p_company_id: empresaUnica })
    setBusy(null)
    if (error) { setMsg({ t: 'Erro: ' + error.message, ok: false }); return }
    const j = data as { mensagem?: string } | null
    setMsg({ t: j?.mensagem ?? 'Teste solicitado.', ok: true })
    await carregar(empresaUnica)
  }

  const toggleDom = (d: string) => setDoms((prev) => { const n = new Set(prev); if (n.has(d)) n.delete(d); else n.add(d); return n })
  const copiarToken = () => { if (dados?.conexao?.agente_token) { void navigator.clipboard?.writeText(dados.conexao.agente_token); setMsg({ t: 'Token copiado — cole na instalação do Agente PS.', ok: true }) } }

  // FIX3 · gera o .env desta empresa (config preenchida; a SENHA do SQL fica VAZIA — o TI preenche local).
  const baixarEnv = () => {
    const cx = dados?.conexao
    if (!cx || !empresaUnica) { setMsg({ t: 'Salve a conexão primeiro (gera o token).', ok: false }); return }
    const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
    const env = [
      '# Agente PS — configuração desta empresa. Gerado no painel. Salve este arquivo como .env em ANSI.',
      `# ${dados?.nome ?? ''}`,
      '',
      '# Nuvem PS (a anon key é PÚBLICA, não é segredo)',
      `SUPABASE_URL=${SB_URL}`,
      `SUPABASE_ANON_KEY=${SB_ANON}`,
      `AGENTE_TOKEN=${cx.agente_token ?? ''}`,
      `ATAK_COMPANY_ID=${empresaUnica}`,
      `INGEST_URL=${SB_URL}/functions/v1/atak-ingest`,
      '',
      '# SQL Server do frigorífico (na rede do cliente)',
      `ATAK_HOST=${cx.host ?? ''}`,
      `ATAK_PORTA=${cx.porta ?? 1433}`,
      `ATAK_BANCO=${cx.banco ?? ''}`,
      `ATAK_COD_FILIAL=${cx.cod_filial ?? '100'}`,
      `ATAK_USUARIO=${cx.usuario ?? ''}`,
      'ATAK_SENHA=          # <-- O TI PREENCHE a senha do SQL Server aqui (fica só nesta máquina · Pilar 2)',
      '',
      '# Domínios a coletar (marcados na tela) e cadência informativa',
      `DOMINIOS=${(cx.dominios ?? []).join(',')}`,
      `SYNC_MINUTOS=${cx.sync_minuto ?? 15}`,
      '',
    ].join('\r\n')
    baixarTexto(env, '.env')
    setMsg({ t: 'Configuração (.env) baixada — preencha a senha do SQL e salve em ANSI.', ok: true })
  }

  const baixarTexto = (conteudo: string, nome: string) => {
    const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); URL.revokeObjectURL(url)
  }
  const baixarBlob = (blob: Blob, nome: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); URL.revokeObjectURL(url)
  }

  // "Gerar instalador": monta o .zip (agente-atak.exe + nssm.exe + config.json c/ token + instalar.bat + LEIA-ME)
  // no navegador (JSZip). O .exe e o nssm.exe vêm do Supabase Storage (bucket público 'agente', publicado pelo CI).
  // O nssm.exe empacota o coletor como serviço do Windows (RD-41) — o instalar.bat o acha ao lado do binário.
  // Pilar 2: o config.json NÃO leva senha — só URL + token + anon key (pública). A senha o TI digita local no 1º run.
  const gerarInstalador = async () => {
    const cx = dados?.conexao
    if (!cx?.agente_token || !empresaUnica) { setMsg({ t: 'Salve a conexão primeiro — o token é gerado no salvar.', ok: false }); return }
    const SB_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
    const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
    if (!SB_URL || !SB_ANON) { setMsg({ t: 'Configuração da nuvem PS ausente (URL/chave pública). Avise o suporte.', ok: false }); return }
    setBusy('zip'); setMsg(null)
    const exeUrl = `${SB_URL}/storage/v1/object/public/agente/agente-atak.exe`
    try {
      const resp = await fetch(exeUrl, { cache: 'no-store' })
      if (!resp.ok) throw new Error('O instalador (agente-atak.exe) ainda não foi publicado no Storage — rode o build do agente (tag agente-v*). Avise o suporte PS.')
      const exe = await resp.arrayBuffer()
      const mz = new Uint8Array(exe.slice(0, 2)) // um .exe real começa com "MZ" — não zipa um HTML de 404 por engano
      if (exe.byteLength < 100000 || mz[0] !== 0x4D || mz[1] !== 0x5A) {
        throw new Error('O arquivo do instalador no Storage não é um executável válido (publicação pendente).')
      }
      // nssm.exe: envelopa o .exe como serviço do Windows (sc.exe nativo não roda um .exe comum como serviço).
      // Vem do mesmo bucket público 'agente' (publicado pelo CI). Sem ele, instalar.bat falha (RD-41 · erro do Jian).
      const nssmUrl = `${SB_URL}/storage/v1/object/public/agente/nssm.exe`
      const nresp = await fetch(nssmUrl, { cache: 'no-store' })
      if (!nresp.ok) throw new Error('O nssm.exe ainda não foi publicado no Storage (bucket agente) — rode o build do agente (tag agente-v*) ou suba o nssm.exe manualmente. Avise o suporte PS.')
      const nssm = await nresp.arrayBuffer()
      const nmz = new Uint8Array(nssm.slice(0, 2)) // MZ = PE válido — não zipa um HTML de 404 por engano
      if (nssm.byteLength < 100000 || nmz[0] !== 0x4D || nmz[1] !== 0x5A) {
        throw new Error('O nssm.exe no Storage não é um executável válido (publicação pendente).')
      }
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      zip.file('agente-atak.exe', exe)
      zip.file('nssm.exe', nssm)
      // config.json: PS_ANON_KEY é obrigatório pelo agente (#966 exige PS_URL+PS_TOKEN+PS_ANON_KEY) e é PÚBLICO.
      zip.file('config.json', JSON.stringify({ PS_URL: SB_URL, PS_TOKEN: cx.agente_token, PS_ANON_KEY: SB_ANON }, null, 2) + '\n')
      zip.file('instalar.bat', '@echo off\r\nagente-atak.exe --instalar-servico\r\npause\r\n')
      zip.file('LEIA-ME.md', LEIA_ME_TEXTO)
      const blob = await zip.generateAsync({ type: 'blob' })
      baixarBlob(blob, `instalador-${slug(dados?.nome ?? 'empresa')}.zip`)
      setMsg({ t: `Instalador da ${dados?.nome ?? 'empresa'} gerado — envie o .zip pro TI. A senha do SQL o TI digita 1× na máquina (Pilar 2).`, ok: true })
    } catch (e) {
      setMsg({ t: (e as Error).message, ok: false })
    } finally {
      setBusy(null)
    }
  }

  const inp: React.CSSProperties = { width: '100%', background: C.bg, border: '1px solid ' + C.bd, color: C.tx, padding: '8px 10px', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
  const lbl: React.CSSProperties = { fontSize: 10, color: C.txd, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }
  const dlBtn: React.CSSProperties = { padding: '9px 14px', borderRadius: 6, border: 'none', background: C.go, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }
  const dlGhost: React.CSSProperties = { padding: '9px 12px', borderRadius: 6, border: '1px solid ' + C.bd, background: 'transparent', color: C.txm, fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }

  if (!compLoading && !empresaUnica) return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.tx }}>
      <Header />
      <div style={{ padding: 40, textAlign: 'center', background: C.card, border: '1px solid ' + C.bd, borderRadius: 10, marginTop: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Selecione uma empresa</div>
        <div style={{ fontSize: 12, color: C.txm, maxWidth: 460, margin: '8px auto 0', lineHeight: 1.5 }}>
          Escolha um frigorífico específico no seletor da sidebar. O cadastro grava host/credencial por empresa (senha no Vault).
        </div>
      </div>
    </div>
  )

  const mon = dados?.monitor
  const sem = SEMAFORO[mon?.semaforo ?? 'sem_dados'] ?? SEMAFORO.sem_dados
  const teste = dados?.teste

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.tx }}>
      <Header />

      {msg && <div style={{ background: (msg.ok ? C.g : C.r) + '15', border: '1px solid ' + (msg.ok ? C.g : C.r) + '40', borderRadius: 8, padding: '10px 14px', margin: '12px 0', fontSize: 12.5, color: msg.ok ? C.g : C.r }}>{msg.t}</div>}

      {/* MONITOR — semáforo real do erp_sync_log (heartbeat do atak-ingest) */}
      <div style={{ background: C.card, border: '1px solid ' + C.bd, borderLeft: '4px solid ' + sem.cor, borderRadius: 10, padding: 14, marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: sem.cor, boxShadow: '0 0 0 3px ' + sem.cor + '25' }} />
          <b style={{ fontSize: 15 }}>{dados?.nome ?? 'Empresa'}</b>
          <span style={{ fontSize: 11, fontWeight: 700, color: sem.cor, background: sem.cor + '15', padding: '2px 10px', borderRadius: 999 }}>{sem.label}</span>
          {mon?.ultimo_sucesso && <span style={{ fontSize: 11, color: C.txm, marginLeft: 'auto' }}>
            última carga {new Date(mon.ultimo_sucesso).toLocaleString('pt-BR')}
            {mon.ultimos_gravados ? ` · ${mon.ultimos_gravados} registros` : ''}
          </span>}
        </div>
        <div style={{ fontSize: 11, color: C.txd, marginTop: 6 }}>
          {mon?.ultimo_host ? `Máquina: ${mon.ultimo_host}` : 'Nenhum heartbeat recebido ainda — o Agente PS ainda não reportou.'}
          {mon?.ultima_versao ? ` · agente ${mon.ultima_versao}` : ''}
          {mon?.ultima_fase === 'falha' && mon?.ultimo_erro ? ` · último ciclo com erro: ${mon.ultimo_erro}` : ''}
        </div>
        {/* Heartbeat do AGENTE (auto-reporta versão/status mesmo sem carga) — a PS vê quem está parado/desatualizado */}
        {(() => {
          const hb = agente?.ultimo_heartbeat ? new Date(agente.ultimo_heartbeat) : null
          const min = hb ? Math.floor((Date.now() - hb.getTime()) / 60000) : null
          const online = min != null && min < 30   // 2 ciclos de ~15min
          if (!agente) return null
          return (
            <div style={{ fontSize: 11, color: C.txm, marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid ' + C.bd, paddingTop: 6 }}>
              <span style={{ fontWeight: 700, color: online ? C.g : C.r }}>{online ? '● online' : '○ offline'}</span>
              <span>Agente <b>{agente.versao_agente ?? '—'}</b></span>
              {agente.hostname && <span>· {agente.hostname}</span>}
              {min != null && <span>· heartbeat há {min < 1 ? 'menos de 1 min' : `${min} min`}</span>}
              {agente.status && agente.status !== 'ok' && <span style={{ color: C.y }}>· {agente.status}</span>}
            </div>
          )
        })()}
      </div>

      {/* FORMULÁRIO */}
      {empresaUnica && (
        <div style={{ background: C.card, border: '1px solid ' + C.bd, borderRadius: 10, padding: 16, marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Conexão ATAK / Frigosoft (SQL Server)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div><div style={lbl}>Host / IP</div><input style={inp} value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="192.168.20.77" /></div>
            <div><div style={lbl}>Porta</div><input style={inp} type="number" value={f.porta} onChange={(e) => setF({ ...f, porta: Number(e.target.value) })} /></div>
            <div><div style={lbl}>Banco</div><input style={inp} value={f.banco} onChange={(e) => setF({ ...f, banco: e.target.value })} placeholder="SATKFRIOESTE" /></div>
            <div><div style={lbl}>Cód. filial</div><input style={inp} value={f.cod_filial} onChange={(e) => setF({ ...f, cod_filial: e.target.value })} /></div>
            <div><div style={lbl}>Usuário</div><input style={inp} value={f.usuario} onChange={(e) => setF({ ...f, usuario: e.target.value })} placeholder="usuario_leitura" /></div>
            <div><div style={lbl}>Senha (opcional — o TI preenche no .env local)</div>
              <input style={inp} type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} placeholder="fica na máquina do cliente" autoComplete="new-password" /></div>
            <div><div style={lbl}>Coletar a cada (min)</div><input style={inp} type="number" value={f.sync_minuto} onChange={(e) => setF({ ...f, sync_minuto: Number(e.target.value) })} /></div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={lbl}>Domínios a coletar</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {dominiosDisp.length === 0 && <span style={{ fontSize: 11, color: C.txd }}>Nenhum domínio no de-para (atak_fonte_mapa).</span>}
              {dominiosDisp.map((d) => {
                const on = doms.has(d)
                return <button key={d} onClick={() => toggleDom(d)} style={{ padding: '5px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + (on ? C.go : C.bd), background: on ? C.go + '18' : 'transparent', color: on ? C.gol : C.txm }}>{on ? '✓ ' : ''}{d}</button>
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.txm, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Conexão ativa
            </label>
            <div style={{ flex: 1 }} />
            <button onClick={salvar} disabled={busy === 'salvar'} style={{ padding: '9px 18px', borderRadius: 6, border: 'none', background: C.go, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: busy === 'salvar' ? 0.6 : 1 }}>{busy === 'salvar' ? 'Salvando…' : 'Salvar conexão'}</button>
            <button onClick={testar} disabled={busy === 'testar' || !dados?.conexao} title={!dados?.conexao ? 'Salve a conexão primeiro' : 'O Agente PS executa o SELECT 1 na rede do cliente'} style={{ padding: '9px 18px', borderRadius: 6, border: '1px solid ' + C.b, background: 'transparent', color: C.b, fontSize: 12, fontWeight: 700, cursor: dados?.conexao ? 'pointer' : 'not-allowed', opacity: (busy === 'testar' || !dados?.conexao) ? 0.55 : 1 }}>{busy === 'testar' ? 'Solicitando…' : 'Testar conexão'}</button>
          </div>

          {/* resultado do teste (mediado pelo agente) */}
          {teste && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, fontSize: 12,
              background: (teste.status === 'ok' ? C.g : teste.status === 'erro' ? C.r : C.y) + '12',
              border: '1px solid ' + (teste.status === 'ok' ? C.g : teste.status === 'erro' ? C.r : C.y) + '35',
              color: teste.status === 'ok' ? C.g : teste.status === 'erro' ? C.r : C.y }}>
              {teste.status === 'solicitado'
                ? '⏳ Aguardando o Agente PS executar o teste na rede do cliente (próximo ciclo).'
                : (teste.status === 'ok' ? '✅ ' : '❌ ') + (teste.resultado ?? teste.status)}
              {teste.respondido_em && <span style={{ color: C.txd }}> · {new Date(teste.respondido_em).toLocaleString('pt-BR')}</span>}
            </div>
          )}

          {/* token do Agente PS (pro instalador .msi) */}
          {dados?.conexao?.agente_token && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: C.card2, border: '1px solid ' + C.bd }}>
              <div style={{ fontSize: 10, color: C.txd, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Token do Agente PS (cole na instalação)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ fontSize: 12, color: C.tx, background: C.bg, padding: '4px 8px', borderRadius: 5, border: '1px solid ' + C.bd, wordBreak: 'break-all' }}>
                  {showToken ? dados.conexao.agente_token : dados.conexao.agente_token.slice(0, 8) + '…' + dados.conexao.agente_token.slice(-6)}
                </code>
                <button onClick={() => setShowToken((s) => !s)} style={{ fontSize: 11, color: C.b, background: 'transparent', border: 'none', cursor: 'pointer' }}>{showToken ? 'ocultar' : 'revelar'}</button>
                <button onClick={copiarToken} style={{ fontSize: 11, color: C.gol, background: 'transparent', border: '1px solid ' + C.bd, borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}>copiar</button>
              </div>
              <div style={{ fontSize: 10.5, color: C.txd, marginTop: 6 }}>É a identidade do agente naquela máquina — o agente puxa host/senha/domínios da nuvem com ele. Trate como senha.</div>
            </div>
          )}
        </div>
      )}

      {/* Instalar o Agente PS — 1 clique gera o .zip completo (RD-41) */}
      {empresaUnica && (
        <div style={{ background: C.card, border: '1px solid ' + C.bd, borderRadius: 10, padding: 16, marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Instalar o Agente PS</div>
          <div style={{ fontSize: 11, color: C.txm, marginBottom: 12, lineHeight: 1.5 }}>
            Gere o instalador desta empresa (1 clique), baixe o <b>.zip</b> e mande pro TI. Dentro vão o executável,
            a configuração com o <b>token desta empresa</b> e o guia. A <b>senha do SQL Server</b> o TI digita 1× na
            máquina — nunca sai da rede do cliente (Pilar 2).
          </div>
          {!dados?.conexao?.agente_token && <div style={{ fontSize: 11.5, color: C.y, marginBottom: 10 }}>⚠ Salve a conexão primeiro — o token e a configuração são gerados no salvar.</div>}
          <button onClick={gerarInstalador} disabled={!dados?.conexao?.agente_token || busy === 'zip'}
            style={{ ...dlBtn, fontSize: 13, padding: '11px 18px', opacity: (dados?.conexao?.agente_token && busy !== 'zip') ? 1 : 0.5, cursor: (dados?.conexao?.agente_token && busy !== 'zip') ? 'pointer' : 'not-allowed' }}>
            {busy === 'zip' ? 'Gerando…' : '📦 Gerar instalador (.zip)'}
          </button>
          <div style={{ fontSize: 10.5, color: C.txd, marginTop: 8 }}>
            Baixa <code>instalador-{slug(dados?.nome ?? 'empresa')}.zip</code> com 5 arquivos: <b>agente-atak.exe</b>, <b>nssm.exe</b>,
            {' '}<b>config.json</b> (token embutido), <b>instalar.bat</b> e <b>LEIA-ME.md</b>. O TI extrai e dá duplo-clique no <code>instalar.bat</code>.
          </div>

          {/* Avançado — arquivos separados (modelo antigo Node/.env; mantido por compatibilidade) */}
          <details style={{ marginTop: 14 }}>
            <summary style={{ fontSize: 11.5, color: C.txm, cursor: 'pointer' }}>Avançado — arquivos separados (Node/.env)</summary>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <a href="/downloads/atak/collector.js" download style={dlGhost}>collector.js</a>
              <a href="/downloads/atak/package.json" download style={dlGhost}>package.json</a>
              <a href="/downloads/atak/README.md" download style={dlGhost}>README</a>
              <button onClick={baixarEnv} disabled={!dados?.conexao?.agente_token} style={{ ...dlGhost, opacity: dados?.conexao?.agente_token ? 1 : 0.5, cursor: dados?.conexao?.agente_token ? 'pointer' : 'not-allowed' }}>configuração (.env)</button>
              <a href="/downloads/atak/INSTALACAO.md" download style={dlGhost}>passo-a-passo</a>
            </div>
            <div style={{ fontSize: 10.5, color: C.txd, marginTop: 8 }}>Modelo antigo (Node + <code>.env</code> em <b>ANSI</b>). Use só se precisar rodar sem o <code>.exe</code>.</div>
          </details>
        </div>
      )}

      <div style={{ fontSize: 10.5, color: C.txm, marginTop: 12, lineHeight: 1.5 }}>
        🔒 <b>Modelo self-service:</b> a <b>senha do SQL Server</b> fica na máquina do cliente (o TI preenche no <code>.env</code>) e
        <b> nunca trafega</b> pro nosso backend — só o <b>token do agente</b> identifica a empresa (Pilar 2). O monitor (semáforo)
        reflete o heartbeat real do coletor no <code>erp_sync_log</code> (RD-58).
      </div>
    </div>
  )
}

function Header() {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 9, color: C.go, letterSpacing: 2, textTransform: 'uppercase' }}>Industrial · Administração</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.tx, margin: '2px 0 0' }}>Conectores (ERPs)</h1>
        <div style={{ fontSize: 11, color: C.txd }}>Cadastre um frigorífico · a senha vai pro Vault · o Agente PS coleta e o monitor acende</div>
      </div>
      <a href="/dashboard/industrial" style={{ color: C.go, fontSize: 11, textDecoration: 'none', padding: '5px 10px', border: '1px solid ' + C.bd, borderRadius: 6 }}>← Industrial</a>
    </div>
  )
}
