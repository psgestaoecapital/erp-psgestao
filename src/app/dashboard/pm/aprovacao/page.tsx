'use client'
// APROVAÇÃO CLIENTE (P&M). Jobs em 'em_aprovacao' → aprovar (→publicado) ou reprovar (→em_producao).
// Escopo por company_id (RD-45). Tema Espresso.
import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const GREEN = '#1F5A1F'; const RED = '#7A1F1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const PAGINA = 30 // jobs renderizados por vez (paginação client-side da fila de aprovação)

type Job = { id: string; titulo: string; numero: string | null; valor_job: number | null; cliente_id: string | null; data_prazo: string | null }
type Cli = { id: string; nome: string; nome_fantasia: string | null }

export default function AprovacaoPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [jobs, setJobs] = useState<Job[]>([]); const [clientes, setClientes] = useState<Cli[]>([])
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [toast, setToast] = useState<string | null>(null)
  // Busca + paginação (RD-98 usabilidade): fila de aprovação pode encher (ex.: import em lote) e virar parede de linhas
  // iguais; a busca filtra por título/número/cliente e o "mostrar mais" rende a lista de PAGINA em PAGINA.
  const [busca, setBusca] = useState(''); const [mostrar, setMostrar] = useState(PAGINA)
  // Seleção para decidir VÁRIOS jobs de uma vez (RD-99): quem recebe o OK de um lote inteiro do cliente não precisa
  // clicar job a job. A seleção é por id; "selecionar todos" marca só os VISÍVEIS (respeita busca + paginação).
  const [sel, setSel] = useState<Set<string>>(new Set())

  const carregar = async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true)
    // Jobs primeiro; só então os clientes REFERENCIADOS por id. Buscar "todos os clientes da empresa" estourava o
    // limite padrão de 1000 linhas do PostgREST em empresas grandes (p.ex. 1374 clientes), e os jobs cujo cliente
    // ficava fora da página mostravam o nome como "—". Buscando só os ids usados (conjunto pequeno), o nome real
    // sempre aparece. RD-45: a RLS por empresa segue valendo nas duas consultas.
    const j = await supabase.from('agency_jobs')
      // RD-98 p4: não lista job com exclusão rastreável (excluido_em) — só os efetivamente em aprovação.
      .select('id, titulo, numero, valor_job, cliente_id, data_prazo')
      .eq('company_id', empresa).eq('status', 'em_aprovacao').is('excluido_em', null).order('data_prazo')
    const jobsData = (j.data ?? []) as Job[]
    const ids = Array.from(new Set(jobsData.map((x) => x.cliente_id).filter((v): v is string => !!v)))
    let clientesData: Cli[] = []
    if (ids.length) {
      const { data: cl } = await supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa).in('id', ids)
      clientesData = (cl ?? []) as Cli[]
    }
    setJobs(jobsData); setClientes(clientesData); setSel(new Set()); setMostrar(PAGINA); setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])
  // Nome do cliente para exibição. Sem vínculo (cliente_id nulo) → rótulo claro; vínculo que não resolve (cliente
  // ausente/removido) → aviso, para o usuário saber que há um dado a corrigir — nunca um "—" cru e ambíguo.
  const nomeCli = (id: string | null) => {
    if (!id) return 'Sem cliente vinculado'
    const c = clientes.find((x) => x.id === id)
    return c ? (c.nome_fantasia ?? c.nome) : 'Cliente não encontrado'
  }

  async function decidir(j: Job, aprovar: boolean) {
    setBusy(true)
    await supabase.rpc('fn_pm_job_mover_status', { p_job_id: j.id, p_status: aprovar ? 'publicado' : 'em_producao' })
    setBusy(false); setToast(aprovar ? 'Job APROVADO · publicado.' : 'Job devolvido pra produção.'); void carregar()
  }

  async function decidirLote(aprovar: boolean) {
    const alvo = jobs.filter((j) => sel.has(j.id))
    if (!alvo.length) return
    if (!window.confirm(`${aprovar ? 'Aprovar' : 'Reprovar'} ${alvo.length} job(s) selecionado(s)? ${aprovar ? 'Aprovar publica cada um.' : 'Reprovar devolve cada um pra produção.'}`)) return
    setBusy(true)
    for (const j of alvo) await supabase.rpc('fn_pm_job_mover_status', { p_job_id: j.id, p_status: aprovar ? 'publicado' : 'em_producao' })
    setBusy(false); setToast(`${alvo.length} job(s) ${aprovar ? 'aprovados · publicados' : 'devolvidos pra produção'}.`); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  const termo = busca.trim().toLowerCase()
  const filtrados = termo
    ? jobs.filter((j) => `${j.titulo ?? ''} ${j.numero ?? ''} ${nomeCli(j.cliente_id)}`.toLowerCase().includes(termo))
    : jobs
  const visiveis = filtrados.slice(0, mostrar)
  const restantes = filtrados.length - visiveis.length
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const todosVisiveisSel = visiveis.length > 0 && visiveis.every((j) => sel.has(j.id))
  const toggleTodos = () => setSel((s) => { const n = new Set(s); if (todosVisiveisSel) visiveis.forEach((j) => n.delete(j.id)); else visiveis.forEach((j) => n.add(j.id)); return n })

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🏭 P&amp;M · Produção</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Aprovação do cliente<AjudaCampo chave="pm.aprovacao.tela" rota="/dashboard/pm/aprovacao" /></h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Jobs em conferência aguardando o OK. Aprovar publica; reprovar volta pra produção.</p>
        </header>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : jobs.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>Nada aguardando aprovação.</div>
          : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 220 }}>
                  <input value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(PAGINA) }} placeholder="Buscar por título, número ou cliente…" style={inpBusca} data-testid="aprovacao-busca" />
                  <AjudaCampo chave="pm.aprovacao.busca" rota="/dashboard/pm/aprovacao" />
                </div>
                <span style={{ fontSize: 12, color: TEXTM }} data-testid="aprovacao-contagem">
                  {termo ? `${filtrados.length} de ${jobs.length}` : `${jobs.length} aguardando`}
                </span>
              </div>
              {filtrados.length === 0
                ? <div style={{ padding: 32, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }} data-testid="aprovacao-sem-resultado">Nenhum job com “{busca.trim()}”.</div>
                : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXTM, cursor: 'pointer' }}>
                        <input type="checkbox" checked={todosVisiveisSel} onChange={toggleTodos} style={{ width: 16, height: 16, accentColor: ESPRESSO }} data-testid="aprovacao-sel-todos" />
                        Selecionar todos os visíveis
                        <AjudaCampo chave="pm.aprovacao.selecionar" rota="/dashboard/pm/aprovacao" />
                      </label>
                      {sel.size > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }} data-testid="aprovacao-barra-lote">
                          <span style={{ fontSize: 12, color: ESPRESSO, fontWeight: 700 }}>{sel.size} selecionado{sel.size > 1 ? 's' : ''}</span>
                          <button disabled={busy} onClick={() => decidirLote(true)} style={btnOk} data-testid="aprovacao-lote-aprovar">✓ Aprovar selecionados</button>
                          <button disabled={busy} onClick={() => decidirLote(false)} style={btnNo} data-testid="aprovacao-lote-reprovar">↩ Reprovar selecionados</button>
                          <button onClick={() => setSel(new Set())} style={btnLimpar}>Limpar</button>
                          <AjudaCampo chave="pm.aprovacao.acao_lote" rota="/dashboard/pm/aprovacao" />
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {visiveis.map((j) => (
                        <div key={j.id} style={{ background: '#fff', border: `1px solid ${sel.has(j.id) ? DOURADO : BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div data-ajuda="pm.aprovacao.selecionar" style={{ display: 'flex', alignItems: 'center' }}>
                            <input type="checkbox" checked={sel.has(j.id)} onChange={() => toggle(j.id)} style={{ width: 16, height: 16, accentColor: ESPRESSO }} aria-label={`Selecionar ${j.titulo}`} data-testid={`aprovacao-sel-${j.id}`} />
                          </div>
                          <div style={{ flex: 1, minWidth: 160 }}>
                            <div style={{ fontWeight: 700 }}>{j.titulo}</div>
                            <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{nomeCli(j.cliente_id)} · {brl(Number(j.valor_job ?? 0))}{j.data_prazo ? ` · prazo ${j.data_prazo}` : ''}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <button disabled={busy} onClick={() => decidir(j, true)} style={btnOk}>✓ Aprovar</button>
                            <AjudaCampo chave="pm.aprovacao.acao_aprovar" rota="/dashboard/pm/aprovacao" />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <button disabled={busy} onClick={() => decidir(j, false)} style={btnNo}>↩ Reprovar</button>
                            <AjudaCampo chave="pm.aprovacao.acao_reprovar" rota="/dashboard/pm/aprovacao" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              {restantes > 0 && (
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                  <button onClick={() => setMostrar((m) => m + PAGINA)} style={btnMais} data-testid="aprovacao-mais">Mostrar mais ({restantes} restante{restantes > 1 ? 's' : ''})</button>
                </div>
              )}
            </>
          )}
      </div>
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}
const btnOk: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnNo: CSSProperties = { border: `1px solid ${RED}`, color: RED, background: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', minHeight: 42 }
const btnLimpar: CSSProperties = { border: `1px solid ${BORDA}`, color: TEXTM, background: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer', minHeight: 42 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
const inpBusca: CSSProperties = { flex: 1, minWidth: 0, border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: ESPRESSO, background: '#fff', minHeight: 42 }
const btnMais: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', minHeight: 42 }
