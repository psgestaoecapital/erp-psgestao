'use client'
// RD-41 · Odonto O2 — Odontograma SVG (FDI, premium). Componente reutilizável (RD-26).
// Cada dente = 5 faces clicáveis (O oclusal/incisal · V vestibular · L lingual/palatina ·
// M mesial · D distal). Cor por estado (semáforo só de status). Seleção em massa por grupo.
// Controlado: o pai passa as cores e recebe os cliques (IA/estado vivem fora — aqui é só a arcada).

import { useState } from 'react'
import { TOK } from './ui'

export type Face = 'O' | 'V' | 'L' | 'M' | 'D'
export const FACES: Face[] = ['O', 'V', 'L', 'M', 'D']
export const FACE_LABEL: Record<Face, string> = {
  O: 'Oclusal/incisal', V: 'Vestibular', L: 'Lingual/palatina', M: 'Mesial', D: 'Distal',
}

// Arcadas FDI (superior dir→esq | esq→dir · inferior)
const PERM_SUP = [['18', '17', '16', '15', '14', '13', '12', '11'], ['21', '22', '23', '24', '25', '26', '27', '28']]
const PERM_INF = [['48', '47', '46', '45', '44', '43', '42', '41'], ['31', '32', '33', '34', '35', '36', '37', '38']]
const DEC_SUP = [['55', '54', '53', '52', '51'], ['61', '62', '63', '64', '65']]
const DEC_INF = [['85', '84', '83', '82', '81'], ['71', '72', '73', '74', '75']]

export function dentesPermanentes(): string[] { return [...PERM_SUP.flat(), ...PERM_INF.flat()] }
export function dentesDeciduos(): string[] { return [...DEC_SUP.flat(), ...DEC_INF.flat()] }

// Grupos p/ seleção em massa
export function grupoDentes(g: 'maxila' | 'mandibula' | 'arc_sup' | 'arc_inf' | 'todos', deciduos: boolean): string[] {
  const sup = deciduos ? DEC_SUP : PERM_SUP
  const inf = deciduos ? DEC_INF : PERM_INF
  switch (g) {
    case 'maxila': case 'arc_sup': return sup.flat()
    case 'mandibula': case 'arc_inf': return inf.flat()
    case 'todos': return [...sup.flat(), ...inf.flat()]
  }
}

// Geometria das 5 faces num box 30×30 (quadrado central O + 4 triângulos)
const PATHS: Record<Face, string> = {
  V: 'M0,0 L30,0 L20,10 L10,10 Z',
  D: 'M30,0 L30,30 L20,20 L20,10 Z',
  L: 'M30,30 L0,30 L10,20 L20,20 Z',
  M: 'M0,30 L0,0 L10,10 L10,20 Z',
  O: '', // renderizado como <rect>
}

// ── Silhueta ANATÔMICA (coroa + raiz) · reconhecimento clínico imediato ──────────────
// A arcada vem do 1º dígito FDI (1,2,5,6 = superior); o grupo dentário do 2º dígito.
// Formas canônicas com a COROA em cima (orientação inferior: coroa pra oclusão/centro).
// Superior → flip vertical (raiz pra cima, coroa pra baixo/centro).
type Grupo = 'incisivo' | 'canino' | 'premolar' | 'molar'
export function arcadaSuperior(num: string): boolean { return ['1', '2', '5', '6'].includes(num[0]) }
export function grupoDentario(num: string): Grupo {
  const deciduo = ['5', '6', '7', '8'].includes(num[0])
  const p = num[1]
  if (p === '1' || p === '2') return 'incisivo'
  if (p === '3') return 'canino'
  if (p === '4' || p === '5') return deciduo ? 'molar' : 'premolar'
  return 'molar' // 6,7,8
}
// paths num box 22×30 (coroa y≈0–14 · raiz y≈14–30)
const SHAPES: Record<Grupo, string[]> = {
  incisivo: ['M4,3 Q11,0.5 18,3 L16.5,13 Q11,15 5.5,13 Z', 'M8,13 Q11,14 14,13 L12.5,28.5 Q11,30 9.5,28.5 Z'],
  canino: ['M6.5,2.5 L11,0 L15.5,2.5 L15,13 Q11,15 7,13 Z', 'M8,13 L14,13 L12.5,29.5 Q11,30 9.5,29.5 Z'],
  premolar: ['M5,3.5 Q11,1.5 17,3.5 Q18.5,8 16.5,13.5 Q11,15.5 5.5,13.5 Q3.5,8 5,3.5 Z', 'M8.5,13.5 L13.5,13.5 L12,28.5 Q11,29.5 10,28.5 Z'],
  molar: ['M3,4.5 Q11,1.5 19,4.5 Q20.5,9 18.5,14 Q11,16 3.5,14 Q1.5,9 3,4.5 Z', 'M5.5,14 L9.5,14 L8.5,28 Q7.5,29 6.5,28 Z', 'M12.5,14 L16.5,14 L15.5,28 Q14.5,29 13.5,28 Z'],
}
function Silhueta({ num, fill, ausente, menor, onClick }: { num: string; fill: string | null; ausente: boolean; menor: boolean; onClick: () => void }) {
  const sup = arcadaSuperior(num)
  const shapes = SHAPES[grupoDentario(num)]
  const paintFill = ausente ? '#EDE7DA' : (fill ?? '#FDFBF7')
  return (
    <svg width={menor ? 24 : 32} height={menor ? 32 : 42} viewBox="0 0 22 30" style={{ cursor: 'pointer', overflow: 'visible' }} onClick={onClick}>
      <title>{`Dente ${num}${ausente ? ' · ausente' : ''} — toque para adicionar tratamento`}</title>
      <g transform={sup ? 'translate(0,30) scale(1,-1)' : undefined} opacity={ausente ? 0.4 : 1}>
        {shapes.map((d, i) => <path key={i} d={d} fill={paintFill} stroke={TOK.line} strokeWidth={0.7} strokeLinejoin="round" />)}
      </g>
      {ausente && <line x1={3} y1={27} x2={19} y2={3} stroke={TOK.gray} strokeWidth={1.6} strokeLinecap="round" />}
    </svg>
  )
}

function Dente({ num, cor, corDente, selecionado, menor, badge, onFace, onNum, onDente }: {
  num: string
  cor: (face: Face) => string | null
  corDente: { fill: string | null; ausente: boolean }
  selecionado: boolean
  menor: boolean
  badge: number   // nº de lançamentos neste dente (>1 mostra contador — vários tratamentos)
  onFace: (dente: string, face: Face) => void
  onNum: (dente: string) => void
  onDente: (dente: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {/* silhueta anatômica (coroa+raiz) — clique = seleciona o dente inteiro (prefill tratamento) */}
      <Silhueta num={num} fill={corDente.fill} ausente={corDente.ausente} menor={menor} onClick={() => onDente(num)} />
      {/* diagrama de faces (marcação precisa por face) */}
      <svg width={menor ? 34 : 40} height={menor ? 34 : 40} viewBox="0 0 30 30" style={{ borderRadius: 4, overflow: 'visible' }}>
        {(['V', 'D', 'L', 'M'] as Face[]).map((f) => (
          <path key={f} d={PATHS[f]} fill={cor(f) ?? '#FFFFFF'} stroke={TOK.line} strokeWidth={0.5}
            style={{ cursor: 'pointer' }} onClick={() => onFace(num, f)}>
            <title>{`Dente ${num} · ${FACE_LABEL[f]}`}</title>
          </path>
        ))}
        <rect x={10} y={10} width={10} height={10} fill={cor('O') ?? '#FFFFFF'} stroke={TOK.line} strokeWidth={0.5}
          style={{ cursor: 'pointer' }} onClick={() => onFace(num, 'O')}>
          <title>{`Dente ${num} · ${FACE_LABEL.O}`}</title>
        </rect>
      </svg>
      <div style={{ position: 'relative' }}>
        <button type="button" onClick={() => onNum(num)} title="Selecionar (seleção em massa)"
          style={{ fontSize: 11, fontWeight: 700, lineHeight: 1, padding: '3px 7px', borderRadius: 5, cursor: 'pointer',
            border: `0.5px solid ${selecionado ? TOK.gold : TOK.line}`,
            background: selecionado ? TOK.gold : '#fff', color: selecionado ? '#fff' : TOK.mut }}>
          {num}
        </button>
        {badge > 1 && (
          <span title={`${badge} lançamentos neste dente`} onClick={() => onDente(num)}
            style={{ position: 'absolute', top: -7, right: -7, minWidth: 15, height: 15, padding: '0 3px', borderRadius: 999,
              background: TOK.esp, color: '#fff', fontSize: 9.5, fontWeight: 800, lineHeight: '15px', textAlign: 'center',
              cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,.25)' }}>
            {badge}
          </span>
        )}
      </div>
    </div>
  )
}

const semEstado = { fill: null, ausente: false }
function Arcada({ linhas, cor, corDente, selecionados, menor, badge, onFace, onNum, onDente }: {
  linhas: string[][]
  cor: (dente: string, face: Face) => string | null
  corDente?: (dente: string) => { fill: string | null; ausente: boolean }
  selecionados: Set<string>
  menor: boolean
  badge?: (dente: string) => number
  onFace: (dente: string, face: Face) => void
  onNum: (dente: string) => void
  onDente: (dente: string) => void
}) {
  return (
    // gap 36 entre os dois quadrantes (linha média) · scroll horizontal no mobile (não espreme)
    <div style={{ display: 'flex', justifyContent: 'center', gap: 36, flexWrap: 'nowrap', overflowX: 'auto', padding: '4px 2px' }}>
      {linhas.map((linha, i) => (
        <div key={i} style={{ display: 'flex', gap: 8 }}>
          {linha.map((num) => (
            <Dente key={num} num={num} selecionado={selecionados.has(num)} menor={menor}
              badge={badge ? badge(num) : 0}
              cor={(f) => cor(num, f)} corDente={corDente ? corDente(num) : semEstado}
              onFace={onFace} onNum={onNum} onDente={onDente} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function Odontograma({
  deciduos, onToggleDecidua, cor, corDente, selecionados, badge, onFace, onNum, onDente,
}: {
  deciduos: boolean
  onToggleDecidua: (v: boolean) => void
  cor: (dente: string, face: Face) => string | null   // cor da face (null = branco)
  corDente?: (dente: string) => { fill: string | null; ausente: boolean }   // estado da silhueta (opcional)
  selecionados: Set<string>
  badge?: (dente: string) => number   // nº de lançamentos por dente (>1 mostra contador)
  onFace: (dente: string, face: Face) => void
  onNum: (dente: string) => void
  onDente?: (dente: string) => void   // clicar a silhueta (dente inteiro); fallback = onNum
}) {
  const clickDente = onDente ?? onNum
  const [aberto, setAberto] = useState(true)
  const sup = deciduos ? DEC_SUP : PERM_SUP
  const inf = deciduos ? DEC_INF : PERM_INF
  return (
    <div style={{ background: '#fff', border: `0.5px solid ${TOK.line}`, borderRadius: TOK.rCard, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: aberto ? 10 : 0 }}>
        <button type="button" onClick={() => setAberto((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: TOK.esp, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {aberto ? '▾' : '▸'} 🦷 Odontograma
        </button>
        <div style={{ display: 'inline-flex', gap: 4, background: TOK.bg, borderRadius: 999, padding: 2 }}>
          {[['Permanentes', false], ['Decíduos', true]].map(([lbl, val]) => (
            <button key={String(val)} type="button" onClick={() => onToggleDecidua(val as boolean)}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 999, cursor: 'pointer', border: 'none',
                background: deciduos === val ? TOK.gold : 'transparent', color: deciduos === val ? '#fff' : TOK.mut }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      {aberto && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Arcada linhas={sup} cor={cor} corDente={corDente} selecionados={selecionados} menor={deciduos} badge={badge} onFace={onFace} onNum={onNum} onDente={clickDente} />
          <div style={{ height: 1, background: TOK.line, margin: '6px 0' }} />
          <Arcada linhas={inf} cor={cor} corDente={corDente} selecionados={selecionados} menor={deciduos} badge={badge} onFace={onFace} onNum={onNum} onDente={clickDente} />
        </div>
      )}
    </div>
  )
}
