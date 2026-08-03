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

function Dente({ num, cor, selecionado, onFace, onNum }: {
  num: string
  cor: (face: Face) => string | null
  selecionado: boolean
  onFace: (dente: string, face: Face) => void
  onNum: (dente: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={30} height={30} viewBox="0 0 30 30" style={{ borderRadius: 4, overflow: 'visible' }}>
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
      <button type="button" onClick={() => onNum(num)}
        style={{ fontSize: 10, fontWeight: 700, lineHeight: 1, padding: '2px 4px', borderRadius: 4, cursor: 'pointer',
          border: `0.5px solid ${selecionado ? TOK.gold : TOK.line}`,
          background: selecionado ? TOK.gold : '#fff', color: selecionado ? '#fff' : TOK.mut }}>
        {num}
      </button>
    </div>
  )
}

function Arcada({ linhas, cor, selecionados, onFace, onNum }: {
  linhas: string[][]
  cor: (dente: string, face: Face) => string | null
  selecionados: Set<string>
  onFace: (dente: string, face: Face) => void
  onNum: (dente: string) => void
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'nowrap', overflowX: 'auto', padding: '2px 0' }}>
      {linhas.map((linha, i) => (
        <div key={i} style={{ display: 'flex', gap: 3 }}>
          {linha.map((num) => (
            <Dente key={num} num={num} selecionado={selecionados.has(num)}
              cor={(f) => cor(num, f)} onFace={onFace} onNum={onNum} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function Odontograma({
  deciduos, onToggleDecidua, cor, selecionados, onFace, onNum,
}: {
  deciduos: boolean
  onToggleDecidua: (v: boolean) => void
  cor: (dente: string, face: Face) => string | null   // cor da face (null = branco)
  selecionados: Set<string>
  onFace: (dente: string, face: Face) => void
  onNum: (dente: string) => void
}) {
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Arcada linhas={sup} cor={cor} selecionados={selecionados} onFace={onFace} onNum={onNum} />
          <div style={{ height: 1, background: TOK.line, margin: '2px 0' }} />
          <Arcada linhas={inf} cor={cor} selecionados={selecionados} onFace={onFace} onNum={onNum} />
        </div>
      )}
    </div>
  )
}
