'use client'

// Quadro de chamados (Fase 2 do #7050, CEO 09/11). Colunas por status: Pendentes, Em andamento, Aguardando
// usuário e Finalizados (no modo usuário, antes delas a coluna "Minha carteira"). O ESCOPO (minha carteira ×
// gerais / meu usuário × todos) é dado pelo FILTRO no topo — a antiga coluna "Todos" duplicava as colunas de
// status (todo chamado ativo já cai em uma delas) e, no teste do CEO (12/11), comia largura e empurrava a última
// coluna para fora da tela; por isso virou filtro em vez de coluna e foi removida. O cartão mostra só número,
// título e "Abrir" (o detalhe — descrição, anexos, fotos, histórico e respostas — continua na lista). A etiqueta
// de status aparece na busca (nas colunas, o cabeçalho da coluna já diz o status).
// A busca fica fixa no topo e acha finalizados e arquivados (estes com a etiqueta ARQUIVADA).
// Regras de coluna e de busca: src/lib/melhorias/kanban.ts (puras, com gate). Filtro Minha carteira / Gerais.
//
// #7050 Fase 3 (CEO/Jordana 12/11): arrastar o cartão de uma coluna para a outra (prop onMover). Cartão e coluna são
// componentes de MÓDULO (não definidos dentro do render): se fossem inline, cada setState do arraste trocaria a
// identidade do componente e o React remontaria o nó arrastado, ABORTANDO o drag nativo. Com tipo estável, o
// destaque do alvo e o "fantasma" do cartão em arraste atualizam via props sem remontar.

import { useRef, useState, type ReactNode } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import {
  casaBusca, colunaDoChamado, ehArquivado, passaFiltro, ROTULO_COLUNA, semDono,
  type ChamadoKanban, type ColunaKanban, type FiltroKanban,
} from '@/lib/melhorias/kanban'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', amber: '#BA7517', amberBg: '#FFF6E5',
}

export type ItemQuadro = ChamadoKanban & {
  id: string
  numero: number
  titulo: string | null
  descricao: string
  empresa: string | null
  user_name: string | null
}

type Props = {
  itens: ItemQuadro[]
  meuId: string | null
  busca: string
  onBusca: (v: string) => void
  filtro: FiltroKanban
  onFiltro: (f: FiltroKanban) => void
  rotuloStatus: (s: string) => string
  onAbrir: (numero: number, arquivada: boolean) => void
  // 'operador' = fila de atendimento (#7050): colunas de status (Pendentes/Em andamento/Aguardando usuário/Finalizados) e
  // seletor "Meu usuário" / "Todos usuários" (sem a coluna extra "Minha carteira"). Padrão 'usuario' = tela de melhorias.
  modo?: 'usuario' | 'operador'
  // #7050 Fase 3: arrastar o cartão. Quando presente, os cartões das colunas de status ficam arrastáveis e as colunas
  // de status viram alvo de soltura. A PÁGINA decide o que cada transição faz (hoje só Pendentes → Em andamento =
  // assumir); transição não suportada é tratada com um aviso pela própria página. Arrastar NUNCA envia mensagem ao
  // cliente — a ação é a troca de status/atendente, registrada no histórico.
  onMover?: (card: ItemQuadro, de: ColunaKanban, para: ColunaKanban) => void
}

const COLUNAS: ColunaKanban[] = ['pendentes', 'andamento', 'aguardando', 'finalizados']

// Selo de como o chamado terminou — pura, usada pelo cartão.
const seloFinalDe = (c: ItemQuadro): string | null =>
  colunaDoChamado(c) !== 'finalizados' ? null : c.confirmado_pelo_autor ? 'Aprovado pelo autor' : 'Finalizado pela equipe'

// ── Cartão (componente de módulo: tipo estável, não remonta durante o arraste) ───────────────────────────────────
function Cartao({
  c, mostrarStatus, selo, col, arrastavel, emArraste, onAbrir, rotuloStatus, onDragStartCard, onDragEndCard, onAssumir,
}: {
  c: ItemQuadro
  mostrarStatus: boolean
  selo?: 'sem_dono'
  col?: ColunaKanban
  arrastavel: boolean
  emArraste: boolean
  onAbrir: (numero: number, arquivada: boolean) => void
  rotuloStatus: (s: string) => string
  onDragStartCard: (id: string, de: ColunaKanban, e: React.DragEvent) => void
  onDragEndCard: () => void
  // #7050: no celular o arraste nativo (HTML5 drag) não dispara no toque; quando presente, mostra um botão
  // "Assumir" no cartão para mover de Pendentes → Em andamento também no touch (mesmo efeito do arraste).
  onAssumir?: () => void
}) {
  const self = seloFinalDe(c)
  return (
    <div data-testid="kanban-cartao"
      draggable={arrastavel}
      onDragStart={arrastavel && col ? (e) => onDragStartCard(c.id, col, e) : undefined}
      onDragEnd={arrastavel ? onDragEndCard : undefined}
      style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 6, cursor: arrastavel ? 'grab' : undefined, opacity: emArraste ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: C.esp, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ color: C.gold, fontWeight: 800 }}>#{c.numero}</span> {c.titulo || c.descricao.slice(0, 60)}
        </div>
        <div style={{ flexShrink: 0, display: 'flex', gap: 6 }}>
          {onAssumir && (
            <button type="button" data-testid={`kanban-assumir-${c.numero}`}
              onClick={(e) => { e.stopPropagation(); onAssumir() }}
              title="Assumir este chamado — move para Em andamento e passa você como responsável. Não envia mensagem ao cliente."
              style={{ border: `1px solid ${C.gold}`, background: C.gold, borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: C.white, cursor: 'pointer' }}>
              Assumir
            </button>
          )}
          <button type="button" onClick={() => onAbrir(c.numero, ehArquivado(c))}
            style={{ border: `1px solid ${C.border}`, background: C.cream, borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: C.esp, cursor: 'pointer' }}>
            Abrir
          </button>
        </div>
      </div>
      {(mostrarStatus || selo || self) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {mostrarStatus && (
            <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espM, fontWeight: 700 }}>
              {ehArquivado(c) ? 'ARQUIVADA' : rotuloStatus(c.status)}
            </span>
          )}
          {self && (
            <span data-testid="kanban-selo-final" style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: '#ECFDF5', color: '#166534', fontWeight: 700 }}>{self}</span>
          )}
          {selo === 'sem_dono' && (
            <span data-testid="kanban-sem-dono" style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>Sem dono</span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Coluna (componente de módulo). Recebe os cartões já renderizados como children; quando é alvo de soltura
// (col + onDrop), trata dragover/leave/drop. flex: cresce para ocupar a largura útil, piso de 240px (rola lateral
// quando não cabe); no celular empilha (CSS .qc-col). ──────────────────────────────────────────────────────────────
function Coluna({
  titulo, count, col, destacar, vazio, onDragOverCol, onDragLeaveCol, onDropCol, children,
}: {
  titulo: string
  count: number
  col?: ColunaKanban
  destacar: boolean
  vazio: boolean
  onDragOverCol?: (col: ColunaKanban, e: React.DragEvent) => void
  onDragLeaveCol?: (col: ColunaKanban, e: React.DragEvent) => void
  onDropCol?: (col: ColunaKanban, e: React.DragEvent) => void
  children: ReactNode
}) {
  const alvo = !!col && !!onDropCol
  return (
    <section className="qc-col" data-testid={col ? `kanban-coluna-${col}` : undefined}
      onDragOver={alvo && col && onDragOverCol ? (e) => onDragOverCol(col, e) : undefined}
      onDragLeave={alvo && col && onDragLeaveCol ? (e) => onDragLeaveCol(col, e) : undefined}
      onDrop={alvo && col && onDropCol ? (e) => onDropCol(col, e) : undefined}
      style={{ minWidth: 240, maxWidth: 360, flex: '1 1 240px', background: destacar ? C.amberBg : C.cream, borderRadius: 12, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 210px)', overflow: 'hidden', outline: destacar ? `2px dashed ${C.gold}` : 'none', outlineOffset: -2, transition: 'background .12s' }}>
      {/* cabeçalho fixo ao rolar a coluna */}
      <header style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px 8px', borderBottom: `1px solid ${C.border}` }}>
        <b style={{ fontSize: 13, color: C.esp }}>{titulo}</b>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: C.espM }}>{count}</span>
      </header>
      <div className="qc-scroll" style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {vazio && <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic', padding: '4px' }}>{destacar ? 'Solte aqui' : 'Nada aqui.'}</div>}
        {children}
      </div>
    </section>
  )
}

export default function QuadroChamados({ itens, meuId, busca, onBusca, filtro, onFiltro, rotuloStatus, onAbrir, modo = 'usuario', onMover }: Props) {
  // Origem do arraste num ref (não dispara render → não remonta o cartão a meio do drag); `sobre` destaca o alvo.
  const origem = useRef<{ id: string; de: ColunaKanban } | null>(null)
  const [arrastandoId, setArrastandoId] = useState<string | null>(null)
  const [sobre, setSobre] = useState<ColunaKanban | null>(null)
  const podeArrastar = !!onMover

  const onDragStartCard = (id: string, de: ColunaKanban, e: React.DragEvent) => {
    origem.current = { id, de }
    setArrastandoId(id)
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) } catch { /* noop */ }
  }
  const onDragEndCard = () => { origem.current = null; setArrastandoId(null); setSobre(null) }
  const onDragOverCol = (col: ColunaKanban, e: React.DragEvent) => {
    if (!origem.current) return
    e.preventDefault()
    try { e.dataTransfer.dropEffect = 'move' } catch { /* noop */ }
    if (sobre !== col) setSobre(col)
  }
  const onDragLeaveCol = (col: ColunaKanban, e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSobre((s) => (s === col ? null : s))
  }
  const onDropCol = (col: ColunaKanban, e: React.DragEvent) => {
    e.preventDefault()
    const d = origem.current
    origem.current = null
    setArrastandoId(null)
    setSobre(null)
    if (!d || !onMover || d.de === col) return
    const card = itens.find((c) => c.id === d.id)
    if (card) onMover(card, d.de, col)
  }

  const buscando = busca.trim().length > 0
  const ativos = itens.filter((c) => !ehArquivado(c))

  // Busca: lista plana com status e arquivados (sem olhar a coluna)
  const resultados = buscando
    ? itens.filter((c) => casaBusca({ numero: c.numero, titulo: c.titulo, descricao: c.descricao, empresa: c.empresa, user_name: c.user_name, status: c.status }, busca, rotuloStatus))
    : []

  const daCarteira = (c: ChamadoKanban) => passaFiltro(c, 'minha', meuId)
  const porColuna = (col: ColunaKanban) => ativos.filter((c) => colunaDoChamado(c) === col && passaFiltro(c, filtro, meuId))
  const minhaCarteira = ativos.filter(daCarteira)

  // Cartão para uma coluna. col indefinido = cartão não arrastável (colunas "Todos"/"Minha carteira" e busca).
  const card = (c: ItemQuadro, mostrarStatus: boolean, col?: ColunaKanban, selo?: 'sem_dono') => (
    <Cartao key={c.id} c={c} mostrarStatus={mostrarStatus} selo={selo} col={col}
      arrastavel={podeArrastar && !!col} emArraste={arrastandoId === c.id}
      onAbrir={onAbrir} rotuloStatus={rotuloStatus}
      onDragStartCard={onDragStartCard} onDragEndCard={onDragEndCard}
      onAssumir={modo === 'operador' && col === 'pendentes' && onMover ? () => onMover(c, 'pendentes', 'andamento') : undefined} />
  )

  return (
    <div data-testid="quadro-chamados" style={{ display: 'grid', gap: 12 }}>
      {/* Rolagem lateral sempre visível (quando as colunas não cabem) e empilhamento no celular */}
      <style>{`
        .qc-scroll { scrollbar-width: thin; scrollbar-color: ${C.gold} transparent; }
        .qc-scroll::-webkit-scrollbar { height: 10px; width: 10px; }
        .qc-scroll::-webkit-scrollbar-thumb { background: ${C.gold}; border-radius: 999px; }
        .qc-scroll::-webkit-scrollbar-track { background: transparent; }
        @media (max-width: 760px) {
          .qc-board { flex-wrap: wrap; overflow-x: visible; }
          .qc-col { flex: 1 1 100% !important; max-width: none !important; min-width: 0 !important; max-height: none !important; }
        }
      `}</style>
      {/* Busca fixa no topo + filtro Minha carteira / Gerais */}
      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#FAF7F2', paddingBottom: 6, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input data-testid="kanban-busca" value={busca} onChange={(e) => onBusca(e.target.value)}
            placeholder="Buscar: número (ex.: 7050), título, descrição, empresa, quem abriu, status"
            style={{ flex: 1, minWidth: 0, padding: '9px 12px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: C.white, color: C.esp, outline: 'none' }} />
          <AjudaCampo chave="melhorias.kanban.busca" rota="/dashboard/melhorias" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {(['gerais', 'minha'] as FiltroKanban[]).map((f) => (
            <button key={f} type="button" data-testid={`kanban-filtro-${f}`} onClick={() => onFiltro(f)}
              style={{ cursor: 'pointer', padding: '5px 12px', borderRadius: 999, border: `1px solid ${filtro === f ? C.gold : C.border}`, background: filtro === f ? C.cream : 'transparent', fontSize: 12, fontWeight: 700, color: filtro === f ? C.esp : C.espM }}>
              {f === 'gerais' ? (modo === 'operador' ? 'Todos usuários' : 'Gerais') : (modo === 'operador' ? 'Meu usuário' : 'Minha carteira')}
            </button>
          ))}
          <AjudaCampo chave="melhorias.kanban.filtro" rota="/dashboard/melhorias" />
        </div>
      </div>

      {buscando ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12, color: C.espM }}>{resultados.length} resultado(s)</div>
          {resultados.map((c) => card(c, true))}
          {resultados.length === 0 && <div style={{ fontSize: 13, color: C.espL, fontStyle: 'italic' }}>Nenhum chamado encontrado.</div>}
        </div>
      ) : (
        <div className="qc-board qc-scroll" style={{ display: 'flex', gap: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch', alignItems: 'stretch', width: '100%', paddingBottom: 8 }}>
          {modo === 'usuario' && (
            <Coluna titulo="Minha carteira" count={minhaCarteira.length} destacar={false} vazio={minhaCarteira.length === 0}>
              {minhaCarteira.map((c) => card(c, false))}
            </Coluna>
          )}
          {COLUNAS.map((col) => {
            const lista = porColuna(col)
            return (
              <Coluna key={col} titulo={ROTULO_COLUNA[col]} count={lista.length} col={col}
                destacar={podeArrastar && sobre === col && origem.current?.de !== col}
                vazio={lista.length === 0}
                onDragOverCol={podeArrastar ? onDragOverCol : undefined}
                onDragLeaveCol={podeArrastar ? onDragLeaveCol : undefined}
                onDropCol={podeArrastar ? onDropCol : undefined}>
                {lista.map((c) => card(c, false, col, col === 'pendentes' && semDono(c) ? 'sem_dono' : undefined))}
              </Coluna>
            )
          })}
        </div>
      )}
      {/* #7050: dica do arraste (só quando ligado). Arrastar não envia nada ao cliente — só troca o status/atendente. */}
      {!buscando && podeArrastar && (
        <div data-testid="kanban-dica-arrastar" style={{ fontSize: 11.5, color: C.espM }}>
          Dica: arraste um cartão de <b>Pendentes</b> para <b>Em andamento</b> para assumir o chamado — ou, no celular, toque em <b>Assumir</b> no cartão. Em ambos os casos não é enviada nenhuma mensagem ao cliente.
        </div>
      )}
      {!buscando && <div style={{ fontSize: 11.5, color: C.espL }}>Arquivados não aparecem aqui — use a busca.</div>}
    </div>
  )
}
