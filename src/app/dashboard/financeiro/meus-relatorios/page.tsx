'use client'
// Meus relatórios (chamado #3281) — relatórios longos gerados em SEGUNDO PLANO: a pessoa pede, pode fechar a tela e
// volta para baixar quando estiver pronto. Etapa 1: pedir, acompanhar e cancelar (fila erp_relatorio_pedido, RPCs com
// guarda por empresa e solicitante). Etapa 2: o gerador (/api/relatorios/fila) grava o arquivo no storage privado
// "relatorios" (validade 7 dias) — a tela o acorda logo após o pedido e o pg_cron cobre a tela fechada. Etapa 3: ao
// terminar, o banco avisa quem pediu no sino (e no celular) e, quando fica pronto, por e-mail (trg_relatorio_pedido_avisar).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

type Status = 'na_fila' | 'gerando' | 'pronto' | 'erro' | 'cancelado' | 'expirado'
interface Pedido {
  id: string
  tipo: string
  formato: 'excel' | 'pdf'
  titulo: string
  status: Status
  progresso: number
  erro: string | null
  linhas: number | null
  tamanho_bytes: number | null
  expira_em: string | null
  criado_em: string
  concluido_em: string | null
}

const TIPOS: { id: string; nome: string }[] = [
  { id: 'financeiro_movimentacao', nome: 'Movimentação financeira' },
  { id: 'financeiro_pagar', nome: 'Contas a pagar' },
  { id: 'financeiro_receber', nome: 'Contas a receber' },
  { id: 'dre', nome: 'DRE' },
  { id: 'fluxo_caixa', nome: 'Fluxo de caixa' },
]

const STATUS: Record<Status, { rotulo: string; fg: string; bg: string }> = {
  na_fila: { rotulo: 'Na fila', fg: '#5C4A3D', bg: '#F1ECE4' },
  gerando: { rotulo: 'Gerando', fg: '#8A5A00', bg: '#FAEEDA' },
  pronto: { rotulo: 'Pronto', fg: '#3B6D11', bg: '#EAF3DE' },
  erro: { rotulo: 'Erro', fg: '#A32D2D', bg: '#FCEBEB' },
  cancelado: { rotulo: 'Cancelado', fg: '#7A7067', bg: '#F1ECE4' },
  expirado: { rotulo: 'Expirado', fg: '#7A7067', bg: '#F1ECE4' },
}

const ERROS: Record<string, string> = {
  sem_acesso: 'Você não tem acesso a esta empresa.',
  tipo_invalido: 'Escolha um relatório da lista.',
  periodo_invalido: 'Confira o período: a data final precisa ser depois da inicial.',
  periodo_maior_que_36_meses: 'O período pode ter no máximo 36 meses.',
  limite_pedidos_abertos: 'Você já tem 5 relatórios na fila. Espere algum ficar pronto.',
  nao_cancelavel: 'Só dá para cancelar o que ainda está na fila.',
}

const hojeISO = () => new Date().toISOString().slice(0, 10)
const inicio12m = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 11); return d.toISOString().slice(0, 10) }
const dataHora = (s: string | null) => (s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const tamanho = (b: number | null) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

export default function MeusRelatoriosPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [carregando, setCarregando] = useState(true)
  const [tipo, setTipo] = useState('financeiro_movimentacao')
  const [dataInicio, setDataInicio] = useState(inicio12m)
  const [dataFim, setDataFim] = useState(hojeISO)
  const [formato, setFormato] = useState<'excel' | 'pdf'>('excel')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const carregar = useCallback(async () => {
    if (!empresa) return
    const { data, error } = await supabase.rpc('fn_relatorio_meus', { p_company_id: empresa })
    const r = data as { ok: boolean; erro?: string; pedidos?: Pedido[] } | null
    if (error || !r?.ok) setAviso({ tipo: 'erro', texto: ERROS[r?.erro ?? ''] ?? 'Não foi possível carregar os relatórios.' })
    else setPedidos(r.pedidos ?? [])
    setCarregando(false)
  }, [empresa])

  useEffect(() => {
    const t = setTimeout(() => { void carregar() }, 0)
    return () => clearTimeout(t)
  }, [carregar])

  // enquanto houver pedido na fila/gerando, atualiza sozinho a cada 10 s
  const temAberto = pedidos.some((p) => p.status === 'na_fila' || p.status === 'gerando')
  useEffect(() => {
    if (!temAberto) return
    const t = setInterval(() => { void carregar() }, 10000)
    return () => clearInterval(t)
  }, [temAberto, carregar])

  async function pedir() {
    if (!empresa) return
    setEnviando(true); setAviso(null)
    const { data, error } = await supabase.rpc('fn_relatorio_pedir', {
      p_company_id: empresa, p_tipo: tipo, p_parametros: { data_inicio: dataInicio, data_fim: dataFim }, p_formato: formato,
    })
    const r = data as { ok: boolean; erro?: string; titulo?: string } | null
    if (error || !r?.ok) setAviso({ tipo: 'erro', texto: ERROS[r?.erro ?? ''] ?? 'Não foi possível fazer o pedido.' })
    else {
      setAviso({ tipo: 'ok', texto: `Pedido feito: ${r.titulo}. Pode fechar a tela — ele continua sendo gerado e avisamos no sino e por e-mail quando ficar pronto.` })
      void carregar()
      void acordarGerador()
    }
    setEnviando(false)
  }

  // Começa a gerar na hora (sem esperar a próxima volta do pg_cron, a cada 2 min). Falha aqui não perde o pedido.
  async function acordarGerador() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      await fetch('/api/relatorios/fila', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, keepalive: true })
    } catch { /* o pg_cron pega o pedido na próxima volta */ }
    void carregar()
  }

  async function cancelar(id: string) {
    const { data } = await supabase.rpc('fn_relatorio_cancelar', { p_id: id })
    const r = data as { ok: boolean; erro?: string } | null
    if (!r?.ok) setAviso({ tipo: 'erro', texto: ERROS[r?.erro ?? ''] ?? 'Não foi possível cancelar.' })
    void carregar()
  }

  async function baixar(p: Pedido) {
    const { data: linha } = await supabase.from('erp_relatorio_pedido').select('arquivo_path').eq('id', p.id).maybeSingle()
    const caminho = (linha as { arquivo_path: string | null } | null)?.arquivo_path
    if (!caminho) { setAviso({ tipo: 'erro', texto: 'O arquivo ainda não está disponível.' }); return }
    const { data, error } = await supabase.storage.from('relatorios').createSignedUrl(caminho, 300)
    if (error || !data?.signedUrl) { setAviso({ tipo: 'erro', texto: 'Não foi possível baixar. Tente de novo em instantes.' }); return }
    window.location.assign(data.signedUrl)
  }

  if (!empresa) {
    return <div style={{ padding: 40, textAlign: 'center', background: '#FAF7F2', minHeight: '100vh', color: '#3D2314' }}>
      Selecione uma empresa para ver os seus relatórios.
    </div>
  }

  const rotulo: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#5C4A3D', marginBottom: 6 }
  const campo: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #E2D9CC', background: '#fff', fontSize: 15, color: '#3D2314' }
  const botao: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer' }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px', color: '#3D2314' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Meus relatórios</h1>
        <p style={{ fontSize: 15, color: '#7A6A5C', margin: '0 0 24px' }}>
          Peça relatórios grandes e continue trabalhando. Quando ficar pronto, avisamos no sino e por e-mail, e ele aparece aqui para baixar (o arquivo vale 7 dias).
        </p>

        <section style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(61,35,20,.08)', marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Relatório <AjudaCampo chave="financeiro.meus_relatorios.tipo" /></span>
              <select style={campo} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>De <AjudaCampo chave="financeiro.meus_relatorios.data_inicio" /></span>
              <input type="date" style={campo} value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Até <AjudaCampo chave="financeiro.meus_relatorios.data_fim" /></span>
              <input type="date" style={campo} value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={rotulo}>Formato <AjudaCampo chave="financeiro.meus_relatorios.formato" /></span>
              <select style={campo} value={formato} onChange={(e) => setFormato(e.target.value as 'excel' | 'pdf')}>
                <option value="excel">Excel</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
            <button type="button" onClick={pedir} disabled={enviando}
              style={{ ...botao, background: '#3D2314', color: '#fff', opacity: enviando ? 0.6 : 1 }}>
              {enviando ? 'Pedindo…' : 'Gerar em segundo plano'}
            </button>
            <AjudaCampo chave="financeiro.meus_relatorios.pedir" />
          </div>
          {aviso && (
            <p role="status" style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, fontSize: 14,
              background: aviso.tipo === 'ok' ? '#EAF3DE' : '#FCEBEB', color: aviso.tipo === 'ok' ? '#3B6D11' : '#A32D2D' }}>
              {aviso.texto}
            </p>
          )}
        </section>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 18, fontWeight: 700, margin: 0 }}>
            Pedidos <AjudaCampo chave="financeiro.meus_relatorios.status" />
          </h2>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" onClick={() => { setCarregando(true); void carregar() }}
              style={{ ...botao, background: '#F1ECE4', color: '#3D2314' }}>Atualizar</button>
            <AjudaCampo chave="financeiro.meus_relatorios.atualizar" />
          </span>
        </div>

        {carregando ? (
          <p style={{ color: '#7A6A5C' }}>Carregando…</p>
        ) : pedidos.length === 0 ? (
          <p style={{ background: '#fff', borderRadius: 16, padding: 24, textAlign: 'center', color: '#7A6A5C' }}>
            Nenhum relatório pedido ainda nesta empresa.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {pedidos.map((p) => {
              const s = STATUS[p.status] ?? STATUS.na_fila
              return (
                <li key={p.id} style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', boxShadow: '0 1px 3px rgba(61,35,20,.06)',
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{p.titulo}</div>
                    <div style={{ fontSize: 13, color: '#7A6A5C', marginTop: 2 }}>
                      {p.formato === 'pdf' ? 'PDF' : 'Excel'} · pedido em {dataHora(p.criado_em)}
                      {p.status === 'pronto' && p.expira_em ? ` · disponível até ${dataHora(p.expira_em)}` : ''}
                      {p.status === 'pronto' && p.tamanho_bytes ? ` · ${tamanho(p.tamanho_bytes)}` : ''}
                      {p.status === 'erro' && p.erro ? ` · ${p.erro}` : ''}
                    </div>
                  </div>
                  <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: s.bg, color: s.fg }}>
                    {s.rotulo}{p.status === 'gerando' && p.progresso > 0 ? ` ${p.progresso}%` : ''}
                  </span>
                  {p.status === 'pronto' && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button type="button" onClick={() => baixar(p)} style={{ ...botao, background: '#3B6D11', color: '#fff' }}>Baixar</button>
                      <AjudaCampo chave="financeiro.meus_relatorios.baixar" />
                    </span>
                  )}
                  {p.status === 'na_fila' && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button type="button" onClick={() => cancelar(p.id)} style={{ ...botao, background: '#F1ECE4', color: '#A32D2D' }}>Cancelar</button>
                      <AjudaCampo chave="financeiro.meus_relatorios.cancelar" />
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
