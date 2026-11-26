'use client'
// Hub · ONDA S-MED · tela 335 — "Minhas aprovações (app)".
// Caixa de aprovações no celular: cada pessoa vê as medições que estão com ela e aprova/devolve pela
// própria cadeia de etapas, sem abrir a obra. REUTILIZA (RD-26) o backend já publicado e guardado por
// empresa (fn_obra_medicao_etapa_minhas_pendentes, #5808) e o componente de decisão MedicaoEtapas (#5861),
// que consome fn_obra_medicao_etapa_listar/_iniciar/_decidir. Nada é recriado.
// RD-95: "?" no indicador, no filtro e na ação (a ação herda o "?" do MedicaoEtapas). RD-96/RD-100: layout
// e linguagem próprios (identidade Espresso), mobile-first (cartões a partir de 390px).
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { MedicaoEtapas } from '@/components/hub/MedicaoEtapas'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DED3', MUT = 'rgba(61,35,20,0.55)'
const VERM = '#B91C1C'
const ROTA = '/dashboard/projetos/aprovacoes'

// Rótulos próprios das 6 etapas da cadeia padrão (mesma ordem/nomes do MedicaoEtapas e da RPC da cadeia).
const ROTULO: Record<string, string> = {
  lancamento: 'Lançamento',
  aceite_contratado: 'Aceite do contratado',
  engenharia: 'Engenharia',
  gestao_pessoas: 'Gestão de pessoas',
  diretoria: 'Diretoria',
  financeiro: 'Financeiro',
}

type Pendente = {
  etapa_id: string
  medicao_id: string
  etapa: string
  ordem: number
  prazo_em: string | null
  responsavel_user_id: string | null
  obra_id: string | null
  obra_nome: string | null
  medicao_numero: number | null
  medicao_valor: number | null
}

const brl = (v: number | null) =>
  typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'
const dataBR = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null

export default function MinhasAprovacoesPage() {
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [meuId, setMeuId] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const [{ data: userData }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('fn_obra_medicao_etapa_minhas_pendentes'),
    ])
    setMeuId(userData?.user?.id ?? null)
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error, 'Não foi possível carregar as suas aprovações.')); return }
    const r = data as { ok?: boolean; erro?: string; pendentes?: Pendente[] } | null
    if (r && r.ok === false) { setErro(r.erro ?? 'Não foi possível carregar as suas aprovações.'); return }
    setPendentes((r?.pendentes ?? []) as Pendente[])
  }, [])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  // "Minhas aprovações" = só as etapas sob a SUA responsabilidade (responsavel_user_id = você).
  // A RPC devolve todas as pendentes da empresa; aqui filtramos para o título/KPI "aguardando você"
  // baterem com a realidade e o usuário não abrir um cartão que não é dele (beco sem saída de alçada).
  // O backend (fn_obra_medicao_etapa_decidir) segue sendo a autoridade de alçada; isto é só exibição.
  const minhas = useMemo(
    () => (meuId ? pendentes.filter((p) => p.responsavel_user_id === meuId) : pendentes),
    [pendentes, meuId],
  )

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return minhas
    return minhas.filter((p) =>
      (p.obra_nome ?? '').toLowerCase().includes(q) ||
      String(p.medicao_numero ?? '').includes(q) ||
      (ROTULO[p.etapa] ?? p.etapa).toLowerCase().includes(q),
    )
  }, [minhas, busca])

  return (
    <div style={{ minHeight: '100%', background: BG, padding: '16px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: ESP, margin: 0 }}>Minhas aprovações</h1>
            <AjudaCampo chave="projetos.aprovacoes.tela" rota={ROTA} />
          </div>
          <p style={{ fontSize: 13, color: MUT, margin: '4px 0 0', maxWidth: 560 }}>
            As medições que estão aguardando a sua decisão, de qualquer obra. Aprove ou devolva aqui mesmo,
            sem precisar abrir a obra.
          </p>
        </header>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10 }} data-testid="aprovacoes-kpi">
            <span style={{ fontSize: 22, fontWeight: 800, color: GOLD, lineHeight: 1 }}>{minhas.length}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: MUT, fontWeight: 600 }}>
              aguardando você <AjudaCampo chave="projetos.aprovacoes.pendentes" rota={ROTA} />
            </span>
          </div>
          <label style={{ flex: 1, minWidth: 200, display: 'block' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700, marginBottom: 4 }}>
              Buscar <AjudaCampo chave="projetos.aprovacoes.filtro" rota={ROTA} />
            </span>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Obra, nº da medição ou etapa…"
              data-testid="aprovacoes-busca"
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 14, color: ESP }}
            />
          </label>
        </div>

        {erro && (
          <div role="alert" data-testid="aprovacoes-erro" style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>{erro}</div>
        )}

        {carregando ? (
          <div style={{ fontSize: 13, color: MUT, padding: 10 }}>Carregando as suas aprovações…</div>
        ) : lista.length === 0 ? (
          <div data-testid="aprovacoes-vazio" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: ESP, margin: '0 0 6px' }}>
              {minhas.length === 0 ? 'Nada aguardando a sua aprovação' : 'Nada encontrado para a busca'}
            </p>
            <p style={{ fontSize: 13, color: MUT, margin: '0 0 12px', maxWidth: 480, marginInline: 'auto' }}>
              {minhas.length === 0
                ? 'Quando uma medição chegar a uma etapa sob a sua responsabilidade, ela aparece aqui para você aprovar ou devolver.'
                : 'Ajuste o texto da busca para ver as medições que estão com você.'}
            </p>
            <Link href="/dashboard/projetos/obras" style={{ display: 'inline-block', padding: '8px 16px', borderRadius: 999, border: `1px solid ${ESP}`, background: ESP, color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
              Ir para as obras
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {lista.map((p) => {
              const estaAberta = aberta === p.medicao_id
              const prazo = dataBR(p.prazo_em)
              return (
                <div key={p.etapa_id} data-testid={`aprovacao-card-${p.medicao_id}`} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
                  <button
                    onClick={() => setAberta(estaAberta ? null : p.medicao_id)}
                    data-testid={`aprovacao-abrir-${p.medicao_id}`}
                    style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: 14, display: 'flex', gap: 12, alignItems: 'flex-start' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: ESP, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.obra_nome ?? 'Obra'}
                      </div>
                      <div style={{ fontSize: 12.5, color: MUT, marginTop: 3 }}>
                        Medição {p.medicao_numero != null ? `nº ${p.medicao_numero}` : ''} · {brl(p.medicao_valor)}
                        {prazo ? ` · prazo ${prazo}` : ''}
                      </div>
                      <div style={{ marginTop: 7 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: GOLD, background: '#FBF1DC', borderRadius: 999, padding: '2px 9px' }}>
                          Com você: {ROTULO[p.etapa] ?? p.etapa}
                        </span>
                      </div>
                    </div>
                    <span style={{ fontSize: 13, color: GOLD, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {estaAberta ? 'Fechar' : 'Decidir'}
                    </span>
                  </button>
                  {estaAberta && (
                    <div style={{ borderTop: `1px solid ${LINE}`, padding: '0 14px 14px' }}>
                      <MedicaoEtapas medicaoId={p.medicao_id} onMudou={() => void carregar()} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
