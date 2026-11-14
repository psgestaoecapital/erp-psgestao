'use client'
// Modal "Configurar a análise" (SPEC §3): escolhe quais produtos entram no preço médio e no R$/kg.
// Recalcula ao vivo (4 cards), tem presets, busca, lista agrupada por linha, escopo (só preço ou todo o painel)
// e persiste a escolha por empresa no navegador (try/catch: se o navegador bloquear, a escolha vale só nesta sessão).
import { useMemo, useState } from 'react'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { BaseV5, EstadoV5, ModeloV5 } from './motor-v5'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', bd: '#E7DED3', m: '#6B5D4F', d: '#9C8E80', bg2: '#F0ECE3' }
const ROTA = '/dashboard/comercial/meu-painel'
const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const brl0 = (v: number) => nf({ style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const brl2 = (v: number | null) => v == null ? '—' : nf({ style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)

export type EscopoAnalise = 'preco' | 'tudo'
const chaveStore = (empresa: string) => `painel-v7-analise:${empresa}`

// Lê a escolha salva (nomes de produtos fora da análise). Falha silenciosa: sem storage, vale o padrão.
export function lerEscolhaSalva(empresa: string): { fora: string[]; escopo: EscopoAnalise } | null {
  try {
    const raw = window.localStorage.getItem(chaveStore(empresa))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function salvarEscolha(empresa: string, fora: string[], escopo: EscopoAnalise) {
  try { window.localStorage.setItem(chaveStore(empresa), JSON.stringify({ fora, escopo })) } catch { /* sem storage: segue na sessão */ }
}

type Props = {
  open: boolean; onClose: () => void; empresa: string
  base: BaseV5; modelo: ModeloV5; estado: EstadoV5
  onAplicar: (excl: Record<number, boolean>, escopo: EscopoAnalise) => void
  exclusaoPadrao: Record<number, boolean>
}

export function ModalAnalise({ open, onClose, empresa, base, modelo, estado, onAplicar, exclusaoPadrao }: Props) {
  // Guardas (CEO 13/11): o modal NUNCA pode derrubar a página. Mesmo com o BlocoSeguro em volta, normalizamos aqui
  // as entradas para, no pior caso, o modal abrir VAZIO em vez de lançar (estado/base/modelo com formato inesperado,
  // ex. mudança de config de tipos de movimento que altere a forma de modelo.its).
  const [rascunho, setRascunho] = useState<Record<number, boolean>>(estado?.excl ?? {})
  const [escopo, setEscopo] = useState<EscopoAnalise>(estado?.escopo ?? 'preco')
  const [busca, setBusca] = useState('')

  // IMPORTANTE (regras dos Hooks): TODOS os hooks (useState/useMemo) vêm ANTES de qualquer return condicional.
  // Antes, o `if (!open) return null` ficava aqui, no meio — ao abrir o modal (open false→true) a quantidade de
  // hooks mudava entre renders e o React lançava "Rendered more hooks than during the previous render", o que
  // derrubava a ROTA INTEIRA (error boundary: "This page couldn't load"). O `return null` agora está após os hooks.

  // Produtos que existem no período (motor), com totais para a lista.
  const porProd = useMemo(() => {
    const m = new Map<number, { val: number; kg: number; valDentro: number; kgDentro: number }>()
    const its = Array.isArray(modelo?.its) ? modelo.its : []
    its.forEach((x) => {
      if (!Array.isArray(x) || x[4] == null) return
      let a = m.get(x[4]); if (!a) { a = { val: 0, kg: 0, valDentro: 0, kgDentro: 0 }; m.set(x[4], a) }
      a.val += Number(x[6]) || 0; a.kg += Number(x[5]) || 0
    })
    return m
  }, [modelo])

  const dentro = [...porProd.keys()].filter((pi) => !rascunho[pi])
  // Cards ao vivo: preço médio, volume e faturamento DENTRO da escolha (recalcula conforme o rascunho).
  let valD = 0; let kgD = 0
  porProd.forEach((a, pi) => { if (!rascunho[pi]) { valD += a.val; kgD += a.kg } })
  const precoD = kgD > 0 ? valD / kgD : null

  const grupos = useMemo(() => {
    const porLinha = new Map<string, number[]>()
    porProd.forEach((_, pi) => {
      const linha = base?.prod?.[pi]?.[1] ?? '—'
      let arr = porLinha.get(linha); if (!arr) { arr = []; porLinha.set(linha, arr) }
      arr.push(pi)
    })
    const q = busca.trim().toLowerCase()
    return [...porLinha].map(([linha, pis]) => ({
      linha,
      pis: pis.filter((pi) => !q || (base?.prod?.[pi]?.[0] ?? '').toLowerCase().includes(q)).sort((a, b) => (porProd.get(b)!.val - porProd.get(a)!.val)),
    })).filter((g) => g.pis.length).sort((a, b) => a.linha.localeCompare(b.linha))
  }, [porProd, base, busca])

  // Todos os hooks já rodaram — agora sim é seguro sair cedo quando o modal está fechado.
  if (!open) return null

  const presets = [
    { k: 'padrao', rot: 'Padrão: só carne', fn: () => ({ ...(exclusaoPadrao ?? {}) }) },
    { k: 'todos', rot: 'Todos os produtos', fn: () => ({}) },
    { k: 'inativos', rot: 'Tirar também os inativos', fn: () => {
      const r = { ...(exclusaoPadrao ?? {}) }
      porProd.forEach((_, pi) => { if ((base?.prod?.[pi]?.[1] ?? '').toUpperCase().startsWith('INATIVO')) r[pi] = true })
      return r
    } },
  ]

  const marcarGrupo = (pis: number[], incluir: boolean) => setRascunho((r) => {
    const n = { ...r }
    pis.forEach((pi) => { if (incluir) delete n[pi]; else n[pi] = true })
    return n
  })

  const aplicar = () => {
    onAplicar(rascunho, escopo)
    salvarEscolha(empresa, Object.keys(rascunho).filter((k) => rascunho[+k]).map((k) => base?.prod?.[+k]?.[0] ?? k), escopo)
    onClose()
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Configurar a análise" style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ background: C.off, width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', padding: 16, boxSizing: 'border-box', color: C.esp }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>Configurar a análise<AjudaCampo chave="com.painel.analise" rota={ROTA} /></div>
          <button type="button" onClick={onClose} aria-label="Fechar" style={{ minHeight: 40, minWidth: 40, background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: C.m }}>×</button>
        </div>
        <p style={{ fontSize: 13, color: C.m, margin: '6px 0 10px' }}>Despojo, couro, osso, sebo e itens inativos baixam o preço médio. Escolha o que entra; o painel recalcula na hora.</p>

        {/* Transparência da fórmula (CEO 13/11): o que entra no faturamento, o que entra só no volume, o que fica fora. */}
        <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>Como o faturamento é formado<AjudaCampo chave="com.painel.faturado" rota={ROTA} /></div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5, fontSize: 13, color: C.esp }}>
            <li><b>Faturamento (R$):</b> só a venda de mercado interno (notas de venda). É o número que bate com o relatório oficial.</li>
            <li><b>Volume (kg):</b> inclui <b>despojo e couro</b> no peso — eles entram no volume, <b>não</b> no faturamento.</li>
            <li><b>Fora de tudo:</b> a <b>venda balcão</b> (vai num indicador separado) e a <b>perda</b> (nota de perda) — não somam no faturamento.</li>
          </ul>
          <div style={{ fontSize: 12, color: C.m, marginTop: 6 }}>Abaixo você escolhe, dentro da venda, quais produtos entram no <b>preço médio</b> (o despojo costuma ficar fora).</div>
        </div>

        {/* Escopo */}
        <div role="radiogroup" aria-label="Escopo da exclusão" style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
          {([['preco', 'Só do preço médio e R$/kg (faturamento continua com tudo)'], ['tudo', 'De todo o painel (faturamento, volume, clientes e preço)']] as [EscopoAnalise, string][]).map(([k, rot]) => (
            <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, minHeight: 40, background: '#fff', border: `1px solid ${escopo === k ? C.gold : C.bd}`, borderRadius: 8, padding: '8px 10px' }}>
              <input type="radio" name="escopo" checked={escopo === k} onChange={() => setEscopo(k)} /> {rot}<AjudaCampo chave="com.painel.analise" rota={ROTA} />
            </label>
          ))}
        </div>

        {/* Cards ao vivo */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: C.m }}>Produtos dentro</div><div style={{ fontSize: 18, fontWeight: 700 }}>{dentro.length} de {porProd.size}</div></div>
          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: C.m }}>Preço médio (R$/kg)</div><div style={{ fontSize: 18, fontWeight: 700 }}>{brl2(precoD)}</div></div>
          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: C.m }}>Volume dentro</div><div style={{ fontSize: 18, fontWeight: 700 }}>{nf({ maximumFractionDigits: 1 }).format(kgD / 1000)} t</div></div>
          <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 10, padding: 10 }}><div style={{ fontSize: 11, color: C.m }}>Faturamento dentro</div><div style={{ fontSize: 18, fontWeight: 700 }}>{brl0(valD)}</div></div>
        </div>

        {/* Presets e busca */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {presets.map((p) => (
            <button key={p.k} type="button" onClick={() => setRascunho(p.fn())} style={{ padding: '8px 10px', minHeight: 40, borderRadius: 999, border: `1px solid ${C.bd}`, background: '#fff', cursor: 'pointer', fontSize: 13 }}>{p.rot}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><AjudaCampo chave="com.painel.busca" rota={ROTA} /><input aria-label="Buscar produto" placeholder="Buscar produto" value={busca} onChange={(e) => setBusca(e.target.value)}
          style={{ flex: 1, boxSizing: 'border-box', padding: '10px', borderRadius: 8, border: `1px solid ${C.bd}`, fontSize: 14, minHeight: 40 }} /></div>

        {/* Lista agrupada por linha */}
        {grupos.map((g) => (
          <div key={g.linha} style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{g.linha} <span style={{ fontSize: 12, color: C.m, fontWeight: 500 }}>· {g.pis.filter((pi) => !rascunho[pi]).length} de {g.pis.length} dentro</span></div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" onClick={() => marcarGrupo(g.pis, true)} style={{ padding: '6px 8px', minHeight: 36, borderRadius: 8, border: `1px solid ${C.bd}`, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Marcar todos</button>
                <button type="button" onClick={() => marcarGrupo(g.pis, false)} style={{ padding: '6px 8px', minHeight: 36, borderRadius: 8, border: `1px solid ${C.bd}`, background: '#fff', cursor: 'pointer', fontSize: 12 }}>Tirar todos</button>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 2 }}>
              {g.pis.map((pi) => {
                const a = porProd.get(pi)!
                return (
                  <label key={pi} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'center', fontSize: 13, minHeight: 40, padding: '4px 4px', borderTop: `1px solid ${C.bg2}` }}>
                    <input type="checkbox" aria-label={base?.prod?.[pi]?.[0]} checked={!rascunho[pi]} onChange={(e) => setRascunho((r) => { const n = { ...r }; if (e.target.checked) delete n[pi]; else n[pi] = true; return n })} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{base?.prod?.[pi]?.[0]}<AjudaCampo chave="com.painel.produtos" rota={ROTA} /></span>
                    <span style={{ color: C.m, textAlign: 'right' }}>{brl0(a.val)} · {nf({ maximumFractionDigits: 0 }).format(a.kg)} kg · {a.kg > 0 && !rascunho[pi] ? brl2(a.val / a.kg) : '—'}/kg</span>
                  </label>
                )
              })}
            </div>
          </div>
        ))}

        <button type="button" onClick={aplicar} style={{ width: '100%', minHeight: 48, marginTop: 8, borderRadius: 10, border: 'none', background: C.gold, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Pronto</button>
      </div>
    </div>
  )
}
