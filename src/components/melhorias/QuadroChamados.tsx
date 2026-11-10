'use client'

// Quadro de chamados (Fase 2 do #7050, CEO 09/11). Colunas: Todos, Minha carteira, Pendentes, Em andamento,
// Aguardando usuário e Finalizados. O cartão mostra só número, título e "Abrir" (o detalhe — descrição, anexos,
// fotos, histórico e respostas — continua na lista). A etiqueta de status aparece só em "Todos" e na busca.
// A busca fica fixa no topo e acha finalizados e arquivados (estes com a etiqueta ARQUIVADA).
// Regras de coluna e de busca: src/lib/melhorias/kanban.ts (puras, com gate). Filtro Minha carteira / Gerais.

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
  // 'operador' = fila de atendimento (#7050): colunas Todos/Pendentes/Em andamento/Aguardando usuário/Finalizados e seletor
  // "Meu usuário" / "Todos usuários" (sem a coluna extra "Minha carteira"). Padrão 'usuario' = tela de melhorias.
  modo?: 'usuario' | 'operador'
}

const COLUNAS: ColunaKanban[] = ['pendentes', 'andamento', 'aguardando', 'finalizados']

export default function QuadroChamados({ itens, meuId, busca, onBusca, filtro, onFiltro, rotuloStatus, onAbrir, modo = 'usuario' }: Props) {
  const buscando = busca.trim().length > 0
  const ativos = itens.filter((c) => !ehArquivado(c))

  // Busca: lista plana com status e arquivados (sem olhar a coluna)
  const resultados = buscando
    ? itens.filter((c) => casaBusca({ numero: c.numero, titulo: c.titulo, descricao: c.descricao, empresa: c.empresa, user_name: c.user_name, status: c.status }, busca, rotuloStatus))
    : []

  const daCarteira = (c: ChamadoKanban) => passaFiltro(c, 'minha', meuId)
  const porColuna = (col: ColunaKanban) => ativos.filter((c) => colunaDoChamado(c) === col && passaFiltro(c, filtro, meuId))
  const todos = ativos.filter((c) => passaFiltro(c, filtro, meuId))
  const minhaCarteira = ativos.filter(daCarteira)

  // Finalizados (#7050): o cartão diz COMO terminou — aprovado pelo autor ou finalizado pela equipe.
  const seloFinal = (c: ItemQuadro): string | null =>
    colunaDoChamado(c) !== 'finalizados' ? null : c.confirmado_pelo_autor ? 'Aprovado pelo autor' : 'Finalizado pela equipe'

  const Cartao = ({ c, mostrarStatus, selo }: { c: ItemQuadro; mostrarStatus: boolean; selo?: 'sem_dono' }) => (
    <div data-testid="kanban-cartao" style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: C.esp, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ color: C.gold, fontWeight: 800 }}>#{c.numero}</span> {c.titulo || c.descricao.slice(0, 60)}
        </div>
        <button type="button" onClick={() => onAbrir(c.numero, ehArquivado(c))}
          style={{ flexShrink: 0, border: `1px solid ${C.border}`, background: C.cream, borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: C.esp, cursor: 'pointer' }}>
          Abrir
        </button>
      </div>
      {(mostrarStatus || selo || seloFinal(c)) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {mostrarStatus && (
            <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.cream, color: C.espM, fontWeight: 700 }}>
              {ehArquivado(c) ? 'ARQUIVADA' : rotuloStatus(c.status)}
            </span>
          )}
          {seloFinal(c) && (
            <span data-testid="kanban-selo-final" style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: '#ECFDF5', color: '#166534', fontWeight: 700 }}>{seloFinal(c)}</span>
          )}
          {selo === 'sem_dono' && (
            <span data-testid="kanban-sem-dono" style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: C.amberBg, color: C.amber, fontWeight: 700 }}>Sem dono</span>
          )}
        </div>
      )}
    </div>
  )

  const Coluna = ({ titulo, lista, mostrarStatus, selo }: { titulo: string; lista: ItemQuadro[]; mostrarStatus: boolean; selo?: boolean }) => (
    <section style={{ minWidth: 230, flex: '1 0 230px', background: C.cream, borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px' }}>
        <b style={{ fontSize: 13, color: C.esp }}>{titulo}</b>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: C.espM }}>{lista.length}</span>
      </header>
      {lista.length === 0 && <div style={{ fontSize: 12, color: C.espL, fontStyle: 'italic', padding: '4px' }}>Nada aqui.</div>}
      {lista.map((c) => <Cartao key={c.id} c={c} mostrarStatus={mostrarStatus} selo={selo && semDono(c) ? 'sem_dono' : undefined} />)}
    </section>
  )

  return (
    <div data-testid="quadro-chamados" style={{ display: 'grid', gap: 12 }}>
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
          {resultados.map((c) => <Cartao key={c.id} c={c} mostrarStatus />)}
          {resultados.length === 0 && <div style={{ fontSize: 13, color: C.espL, fontStyle: 'italic' }}>Nenhum chamado encontrado.</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', alignItems: 'flex-start', paddingBottom: 6 }}>
          <Coluna titulo="Todos" lista={todos} mostrarStatus />
          {modo === 'usuario' && <Coluna titulo="Minha carteira" lista={minhaCarteira} mostrarStatus={false} />}
          {COLUNAS.map((col) => (
            <Coluna key={col} titulo={ROTULO_COLUNA[col]} lista={porColuna(col)} mostrarStatus={false} selo={col === 'pendentes'} />
          ))}
        </div>
      )}
      {!buscando && <div style={{ fontSize: 11.5, color: C.espL }}>Arquivados não aparecem aqui — use a busca.</div>}
    </div>
  )
}
