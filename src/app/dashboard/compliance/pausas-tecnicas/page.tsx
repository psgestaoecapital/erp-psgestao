'use client'
// Compliance · Pausas Térmicas frigorífico (NR-36 psicofisiológica + Art.253 CLT térmica).
// Resolve #52 (upload da planilha de pausas) e reorganiza as abas (SPEC NR-36 Frontend):
//   PAINEL        = KPIs + apuração (devido vs realizado, semáforo) + dias sem dado + prova por colaborador
//   IMPORTAR      = upload do relatório de ponto (CSV/XLSX) → hash SHA-256 → storage → registrar → processar
//   HISTÓRICO     = uploads (quem/quando/hash) + baixar original + substituir (nunca apaga — RD-30)
//   CONFIGURAÇÃO  = regras editáveis (base legal) + elegíveis (por função/manual)
// Realizado agora VEM do upload (ind_ponto_pausa). Dia sem planilha importada NÃO é dia sem pausa (RD-51).
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { rpc } from '@/lib/authFetch'
import { supabase } from '@/lib/supabase'
import { Timer, Snowflake, ClipboardList, FileText, AlertTriangle, Save, Upload, History, Download, RefreshCw, ShieldAlert, CheckCircle2 } from 'lucide-react'

const C = {
  espresso: '#3D2314', offwhite: '#FAF7F2', gold: '#C8941A', beigeLt: '#f5f0e8', borderLt: '#ece3d2',
  ink: '#1a1a1a', green: '#2d6a3e', greenBg: '#e8f3ec', amber: '#8a6a10', amberBg: '#fdf4e0',
  red: '#a02020', redBg: '#fce8e8', gray: '#6b6b6b', blue: '#1f4e79', blueBg: '#e8f0f8',
}
type Regra = { id: string; tipo: string; nome: string; parametros: Record<string, unknown>; base_legal: string | null; ativo: boolean }
type Colab = { colaborador_id: string; nome: string; cpf: string; funcao: string | null; departamento: string | null; psico: boolean; termica: boolean }
type Resumo = { colaborador_id: string; cpf: string; nome: string; funcao: string | null; tipo: string; dias: number; devido_min: number; realizado_min: number | null; dias_nao_cumpridos: number; dias_parciais: number; dias_aguardando: number; status: string }
type ProvaLinha = { data: string; tipo: string; jornada_seg: number; devido_min: number; realizado_min: number | null; status: string }
type UploadRow = { id: string; arquivo_nome: string; arquivo_hash: string; periodo_inicio: string | null; periodo_fim: string | null; linhas_lidas: number | null; linhas_aceitas: number | null; linhas_rejeitadas: number | null; status: string; enviado_por_email: string | null; enviado_em: string; arquivo_path: string | null; substituido_por: string | null }
type Rejeitada = { linha: number; cpf: string | null; motivo: string }
type LinhaImport = { cpf: string; data: string; inicio: string; fim: string | null; duracao_seg: number | null; tipo: string | null; _nome?: string }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const fmtData = (s: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('pt-BR') : '—'
const fmtDT = (s: string | null) => s ? new Date(s).toLocaleString('pt-BR') : '—'
const hhmm = (seg: number) => `${Math.floor(seg / 3600)}h${String(Math.round((seg % 3600) / 60)).padStart(2, '0')}`
const tipoLabel = (t: string | null) => t === 'termica_253' ? 'Térmica (Art.253)' : t === 'psicofisiologica' ? 'Psicofisiológica (NR-36)' : (t || '—')
const semColor: Record<string, { c: string; bg: string; l: string }> = {
  cumprida: { c: C.green, bg: C.greenBg, l: 'Cumprida' },
  parcial: { c: C.amber, bg: C.amberBg, l: 'Parcial' },
  nao_cumprida: { c: C.red, bg: C.redBg, l: 'Não cumprida' },
  aguardando_realizado: { c: C.blue, bg: C.blueBg, l: 'Aguardando realizado' },
}
const motivoLabel = (m: string) => m === 'cpf_nao_cadastrado' ? 'CPF não está no cadastro de colaboradores' : m === 'data_hora_invalida' ? 'Data/hora inválida' : m

// normaliza cabeçalho: minúsculo, sem acento, sem espaços/pontuação
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export default function PausasTecnicasPage() {
  const { sel, selInfo, loading } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' ? sel : null
  const [aba, setAba] = useState<'painel' | 'importar' | 'historico' | 'config'>('painel')

  if (loading) return <Wrap><div style={{ color: C.gray, padding: 40 }}>Carregando…</div></Wrap>
  if (!companyId) return <Wrap><Header /><Vazio titulo="Selecione uma empresa" texto="As pausas térmicas são por empresa. Escolha uma empresa específica no topo (não Consolidado/Grupo)." /></Wrap>

  return (
    <Wrap>
      <Header />
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.borderLt}`, flexWrap: 'wrap' }}>
        {([['painel', 'Painel', ClipboardList], ['importar', 'Importar', Upload], ['historico', 'Histórico', History], ['config', 'Configuração', Timer]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setAba(k)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: aba === k ? 700 : 500, color: aba === k ? C.espresso : C.gray, borderBottom: `2px solid ${aba === k ? C.gold : 'transparent'}`, marginBottom: -1 }}><Icon size={16} /> {label}</button>
        ))}
      </div>
      {aba === 'painel' && <AbaPainel companyId={companyId} />}
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
    const k = { cumprida: 0, parcial: 0, nao_cumprida: 0, aguardando_realizado: 0 }
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi label="Cumpridas" n={kpi.cumprida} cor={C.green} bg={C.greenBg} />
        <Kpi label="Parciais" n={kpi.parcial} cor={C.amber} bg={C.amberBg} />
        <Kpi label="Não cumpridas" n={kpi.nao_cumprida} cor={C.red} bg={C.redBg} />
        <Kpi label="Aguardando realizado" n={kpi.aguardando_realizado} cor={C.blue} bg={C.blueBg} />
      </div>

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
                  <td style={td()}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: s.bg, color: s.c, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 700 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: s.c }} /> {s.l}</span></td>
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

function ModalProva({ companyId, cpf, nome, ini, fim, onClose }: { companyId: string; cpf: string; nome: string; ini: string; fim: string; onClose: () => void }) {
  const [linhas, setLinhas] = useState<ProvaLinha[]>([])
  const [colab, setColab] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => {
    try { const r = await rpc<{ linhas: ProvaLinha[]; colaborador: Record<string, unknown> }>('fn_nr36_relatorio_prova', { p_company_id: companyId, p_cpf: cpf, p_dt_ini: ini, p_dt_fim: fim }); setLinhas(r.linhas || []); setColab(r.colaborador) }
    catch { /* */ } finally { setLoading(false) }
  })() }, [companyId, cpf, ini, fim])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.offwhite, borderRadius: 14, maxWidth: 720, width: '100%', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.borderLt}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 11, color: C.gray, textTransform: 'uppercase', letterSpacing: 1 }}>Relatório de prova</div><div style={{ fontSize: 16, fontWeight: 700, color: C.espresso }}>{nome}</div></div>
          <BtnGhost onClick={() => window.print()}>Imprimir/PDF</BtnGhost>
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
    </div>
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
      const proc = await rpc<{ ok: boolean; lidas: number; aceitas: number; rejeitadas: number; rejeitadas_detalhe: Rejeitada[]; erro?: string }>('fn_nr36_upload_processar', { p_upload_id: reg.upload_id, p_linhas: payload })
      if (!proc.ok) throw new Error(proc.erro || 'Falha ao processar as linhas.')
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

  const carregar = useCallback(async () => {
    setLoading(true); setErro('')
    try { const r = await rpc<UploadRow[]>('fn_nr36_upload_listar', { p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim }); setRows(Array.isArray(r) ? r : []) }
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
                  <td style={td()}>{u.status === 'substituido' ? <span style={{ color: C.gray }}>substituído</span> : <span style={{ color: C.green }}>{u.status}</span>}</td>
                  <td style={{ ...td(), fontFamily: 'monospace', fontSize: 10.5, color: C.gray }} title={u.arquivo_hash}>{u.arquivo_hash?.slice(0, 10)}…</td>
                  <td style={td()}>{u.arquivo_path && <BtnGhost onClick={() => void baixar(u)}><Download size={13} /> Baixar</BtnGhost>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: C.gray, marginTop: 8 }}>🔒 Uploads nunca são apagados. Para corrigir, importe o novo e use &ldquo;Substituir&rdquo; — o antigo fica marcado, preservando a trilha (RD-30).</div>
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
function btnStyle(disabled: boolean): React.CSSProperties { return { display: 'inline-flex', alignItems: 'center', gap: 6, background: disabled ? '#d9c9a6' : C.gold, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer' } }
function Campo({ label, children }: { label: string; children: React.ReactNode }) { return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><label style={{ fontSize: 12, color: C.gray }}>{label}</label>{children}</div> }
function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) { return <button onClick={onClick} disabled={disabled} style={btnStyle(!!disabled)}>{children}</button> }
function BtnGhost({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) { return <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${C.borderLt}`, background: '#fff', color: C.espresso, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{children}</button> }
