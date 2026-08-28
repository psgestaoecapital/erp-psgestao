'use client'

// IMPORT-FINANCEIRO · bloco "Importar em massa" da migração financeira (implantação de empresa nova).
// Modelo padrão PS unificado (receitas + despesas na mesma planilha, coluna Tipo separa).
// Reusa parseNumBR/parseDataBR (@/lib/num · FIX-PESAGEM-VÍRGULA) e a RPC pronta fn_import_financeiro_v3.
// Preview mostra o valor JÁ parseado (RD-51). Multi-tenant: grava na empresa do contexto.

import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { parseNumBR, parseDataBR } from '@/lib/num'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.65)'
const GREEN = '#3B6D11', RED = '#A32D2D'

type Nivel = 'ok' | 'aviso' | 'erro'
interface Linha {
  n: number
  tipo: string           // pagar | receber (normalizado) ou cru se inválido
  valor: number | null   // JÁ parseado
  vencimento: string | null // ISO
  nome_pessoa: string
  descricao: string
  categoria: string
  centro_custo: string
  forma_pagamento: string
  emissao: string | null
  pagamento: string | null
  situacao: string
  valor_pago: number | null
  nivel: Nivel
  exemplo: boolean       // IMP-1 · linha de exemplo do modelo — não é importada por padrão
  msgs: string[]
}
interface Resultado {
  total?: number; inseridos?: number; duplicados?: number; erros?: number
  lista_erros?: Array<{ linha?: number; descricao?: string; erro: string }>
  importacao_id?: string
}

const STATUS_OK = new Set(['', 'aberto', 'pago', 'quitado', 'liquidado', 'parcial', 'vencido', 'atrasado', 'cancelado'])
const FORMAS_OK = new Set(['', 'pix', 'boleto', 'dinheiro', 'transferencia', 'cartao', 'cartao_credito', 'cartao_debito', 'cheque', 'ted', 'doc', 'especie'])
// Linhas de exemplo do modelo PS (assinatura tipo|valor|vencimento) — avisa se não apagadas.
const EXEMPLOS = new Set([
  'pagar|2.000,00|14/08/2026', 'receber|33.754,90|05/08/2026',
  'pagar|850,00|20/09/2026', 'receber|1.200,00|30/09/2026',
])

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\*/g, '').trim()
const fmtBRL = (n: number | null) => 'R$ ' + Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ImportMigracaoFinanceiraCard({ companyId, empresaNome }: { companyId: string; empresaNome?: string | null }) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [parseErro, setParseErro] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const cont = useMemo(() => {
    let ok = 0, aviso = 0, erro = 0, pagar = 0, receber = 0, total = 0, exemplos = 0, importaveis = 0
    for (const l of linhas) {
      if (l.exemplo) { exemplos++; continue }          // exemplos: contados à parte, não importados
      if (l.nivel === 'erro') { erro++; continue }
      if (l.nivel === 'aviso') aviso++; else ok++
      importaveis++
      if (l.tipo === 'pagar') pagar++; else if (l.tipo === 'receber') receber++
      total += l.valor ?? 0
    }
    return { ok, aviso, erro, pagar, receber, total, exemplos, importaveis }
  }, [linhas])

  async function onArquivo(file: File) {
    setParseErro(null); setResultado(null); setLinhas([])
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const wsName = wb.SheetNames.find((n) => norm(n).startsWith('financ')) ?? wb.SheetNames[0]
      const matriz = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wsName], { header: 1, raw: false, defval: '' })

      const idxHeader = matriz.findIndex((row) => {
        const hs = row.map((c) => norm(c))
        return hs.some((h) => h.includes('tipo')) && hs.some((h) => h.includes('valor')) && hs.some((h) => h.includes('venciment'))
      })
      if (idxHeader < 0) { setParseErro('Não achei o cabeçalho (linha com Tipo, Valor e Vencimento). Use o modelo PS.'); return }
      const header = matriz[idxHeader].map((c) => norm(c))
      const idxOf = (pred: (h: string) => boolean) => header.findIndex(pred)
      const ci = {
        tipo: idxOf((h) => h.includes('tipo')),
        valor: idxOf((h) => h.includes('valor') && !h.includes('pago')),
        vencimento: idxOf((h) => h.includes('venciment')),
        pessoa: idxOf((h) => h.includes('cliente') || h.includes('fornecedor')),
        descricao: idxOf((h) => h.includes('descri')),
        categoria: idxOf((h) => h.includes('categoria')),
        centro: idxOf((h) => h.includes('centro')),
        forma: idxOf((h) => h.includes('forma')),
        emissao: idxOf((h) => h.includes('emiss')),
        pagamento: idxOf((h) => h.includes('pagamento') && !h.includes('forma')),
        situacao: idxOf((h) => h.includes('situac') || h.includes('status')),
        valorPago: idxOf((h) => h.includes('valor') && h.includes('pago')),
      }
      const get = (row: string[], j: number) => (j >= 0 ? String(row[j] ?? '').trim() : '')

      const parsed: Linha[] = []
      for (let i = idxHeader + 1; i < matriz.length; i++) {
        const row = matriz[i]
        if (!row || row.every((c) => String(c ?? '').trim() === '')) continue
        const tipoRaw = get(row, ci.tipo)
        const tipo = norm(tipoRaw)
        const valorRaw = get(row, ci.valor)
        const vencRaw = get(row, ci.vencimento)

        // Pula a linha de DICAS (logo após o cabeçalho): tipo não é pagar/receber e valor não é número.
        if (i === idxHeader + 1 && tipo !== 'pagar' && tipo !== 'receber' && parseNumBR(valorRaw) == null) continue

        const situacao = norm(get(row, ci.situacao))
        const forma = norm(get(row, ci.forma))
        const descricao = get(row, ci.descricao)
        const valor = parseNumBR(valorRaw)
        const vencimento = parseDataBR(vencRaw)

        const erros: string[] = []; const avisos: string[] = []
        if (tipo !== 'pagar' && tipo !== 'receber') erros.push(`Tipo inválido (${tipoRaw || 'vazio'}) — use pagar ou receber`)
        if (valor == null || valor <= 0) erros.push('Valor vazio, zero ou não numérico')
        if (!vencimento) erros.push('Vencimento vazio ou inválido (use dd/mm/aaaa)')
        if (!descricao) avisos.push('Descrição vazia — vira "Lançamento importado"')
        if (!STATUS_OK.has(situacao)) avisos.push(`Situação "${situacao}" não reconhecida — grava como aberto`)
        if (!FORMAS_OK.has(forma)) avisos.push(`Forma "${forma}" não reconhecida — grava assim mesmo`)
        // IMP-1 · linhas de exemplo do modelo: avisa e NÃO importa direto (apague antes de subir)
        const ehExemplo = EXEMPLOS.has(`${tipo}|${valorRaw}|${vencRaw}`)
        if (ehExemplo) avisos.push('Linha de exemplo do modelo — não será importada (apague antes de subir)')

        parsed.push({
          n: i + 1, tipo: (tipo === 'pagar' || tipo === 'receber') ? tipo : tipoRaw,
          valor, vencimento, nome_pessoa: get(row, ci.pessoa), descricao,
          categoria: get(row, ci.categoria), centro_custo: get(row, ci.centro),
          forma_pagamento: get(row, ci.forma), emissao: parseDataBR(get(row, ci.emissao)),
          pagamento: parseDataBR(get(row, ci.pagamento)), situacao: get(row, ci.situacao),
          valor_pago: parseNumBR(get(row, ci.valorPago)),
          nivel: erros.length ? 'erro' : avisos.length ? 'aviso' : 'ok', exemplo: ehExemplo, msgs: [...erros, ...avisos],
        })
      }
      if (parsed.length === 0) { setParseErro('Nenhuma linha de dados (fora as de instrução).'); return }
      setLinhas(parsed); setNomeArquivo(file.name)
    } catch (e) {
      setParseErro((e as Error)?.message ?? 'Falha ao ler o arquivo')
    }
  }

  async function importar() {
    const grava = linhas.filter((l) => l.nivel !== 'erro' && !l.exemplo)   // IMP-1 · exemplos não entram
    if (grava.length === 0) return
    setImportando(true); setResultado(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const records = grava.map((l) => ({
        tipo: l.tipo,
        valor_documento: l.valor,
        data_vencimento: l.vencimento,
        descricao: l.descricao || null,
        nome_pessoa: l.nome_pessoa || null,
        categoria: l.categoria || null,
        centro_custo: l.centro_custo || null,
        forma_pagamento: l.forma_pagamento || null,
        data_emissao: l.emissao,
        data_pagamento: l.pagamento,
        status: l.situacao || null,
        valor_pago: l.valor_pago,
      }))
      const { data, error } = await supabase.rpc('fn_import_financeiro_v3', {
        p_company_id: companyId,
        p_user_id: userData?.user?.id ?? null,
        p_arquivo_nome: nomeArquivo || 'migracao_financeira.xlsx',
        p_records: records,
      })
      if (error) { setParseErro(error.message); return }
      setResultado((data ?? {}) as Resultado)
    } catch (e) {
      setParseErro((e as Error)?.message ?? 'Falha ao importar')
    } finally {
      setImportando(false)
    }
  }

  const podeImportar = linhas.length > 0 && !importando && cont.importaveis > 0

  return (
    <section className="rounded-2xl p-4 space-y-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: GOLD }}>📥 Importar em massa · migração financeira</div>
          <div className="text-[13px] mt-1" style={{ color: ESP60 }}>
            Receitas e despesas na mesma planilha (coluna Tipo). Baixe o modelo, preencha e suba.
          </div>
        </div>
        {empresaNome && (
          <div className="text-[12px] rounded-lg px-3 py-1.5" style={{ background: BG, color: ESP, border: `1px solid ${LINE}` }}>
            Empresa: <b>{empresaNome}</b>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a href="/modelos/MODELO_migracao_financeira_PS.xlsx" download="MODELO_migracao_financeira_PS.xlsx"
          className="rounded-xl px-3 py-2 text-sm font-semibold border inline-block" style={{ borderColor: GOLD, color: GOLD }}>
          Baixar modelo
        </a>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onArquivo(f); e.target.value = '' }} />
        <button type="button" onClick={() => inputRef.current?.click()}
          className="rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: GOLD, color: '#fff' }}>
          Subir planilha
        </button>
        {nomeArquivo && <span className="text-xs" style={{ color: ESP60 }}>{nomeArquivo}</span>}
      </div>

      {parseErro && <div className="rounded-xl p-3 text-xs" style={{ background: '#FCEBEB', color: RED }}>{parseErro}</div>}

      {linhas.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2 text-xs" style={{ color: ESP60 }}>
            <span>🟢 {cont.ok} ok · 🟡 {cont.aviso} aviso(s) · 🔴 {cont.erro} erro(s){cont.exemplos > 0 ? ` · ⚪ ${cont.exemplos} exemplo(s) do modelo (não importados)` : ''} · {cont.pagar} a pagar · {cont.receber} a receber · total {fmtBRL(cont.total)}</span>
          </div>
          <div className="rounded-xl overflow-auto max-h-80" style={{ border: `1px solid ${LINE}` }}>
            <table className="w-full text-xs">
              <thead style={{ background: BG, color: ESP60 }}>
                <tr>
                  <th className="text-left px-2 py-1.5">#</th><th className="text-left px-2 py-1.5">st</th>
                  <th className="text-left px-2 py-1.5">tipo</th><th className="text-left px-2 py-1.5">descrição</th>
                  <th className="text-right px-2 py-1.5">valor</th><th className="text-left px-2 py-1.5">vencimento</th>
                  <th className="text-left px-2 py-1.5">pessoa</th><th className="text-left px-2 py-1.5">situação</th>
                  <th className="text-left px-2 py-1.5">mensagens</th>
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, 200).map((l, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${LINE}`, background: l.nivel === 'erro' ? 'rgba(252,235,235,0.5)' : 'transparent' }}>
                    <td className="px-2 py-1 opacity-50">{l.n}</td>
                    <td className="px-2 py-1">{l.exemplo ? '⚪' : l.nivel === 'erro' ? '🔴' : l.nivel === 'aviso' ? '🟡' : '🟢'}</td>
                    <td className="px-2 py-1">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                        style={{ background: l.tipo === 'pagar' ? '#FCEBEB' : l.tipo === 'receber' ? '#EAF3DE' : BG, color: l.tipo === 'pagar' ? RED : l.tipo === 'receber' ? GREEN : ESP60 }}>
                        {l.tipo || '—'}
                      </span>
                    </td>
                    <td className="px-2 py-1" style={{ color: ESP }}>{l.descricao || <span style={{ color: ESP60 }}>—</span>}</td>
                    <td className="px-2 py-1 text-right tabular-nums" style={{ color: ESP }}>{l.valor != null ? fmtBRL(l.valor) : '—'}</td>
                    <td className="px-2 py-1">{l.vencimento || '—'}</td>
                    <td className="px-2 py-1" style={{ color: ESP60 }}>{l.nome_pessoa || '—'}</td>
                    <td className="px-2 py-1" style={{ color: ESP60 }}>{l.situacao || '—'}</td>
                    <td className="px-2 py-1" style={{ color: ESP60 }}>{l.msgs.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {linhas.length > 200 && (
              <div className="px-3 py-2 text-[11px]" style={{ color: ESP60, background: BG }}>Mostrando 200 de {linhas.length} — todas as válidas serão importadas.</div>
            )}
          </div>
          <button type="button" onClick={() => void importar()} disabled={!podeImportar}
            className="w-full rounded-xl py-3 text-sm font-semibold" style={{ background: GOLD, color: '#fff', opacity: podeImportar ? 1 : 0.5 }}>
            {importando ? 'Importando…' : `Importar ${cont.importaveis} lançamento(s) para ${empresaNome ?? 'a empresa'}`}
          </button>
        </>
      )}

      {resultado && (
        <div className="rounded-xl p-3 text-sm space-y-1" style={{ background: '#EAF5DC', color: ESP }}>
          <div>
            <b>{resultado.inseridos ?? 0}</b> criado(s)
            {(resultado.duplicados ?? 0) > 0 && <> · <b>{resultado.duplicados}</b> já existia(m) (ignorados)</>}
            {(resultado.erros ?? 0) > 0 && <> · <b style={{ color: RED }}>{resultado.erros}</b> com erro</>}
          </div>
          {(resultado.lista_erros?.length ?? 0) > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs" style={{ color: RED }}>
              {resultado.lista_erros!.slice(0, 8).map((e, i) => <li key={i}>linha {e.linha ?? '?'}: {e.erro}{e.descricao ? ` (${e.descricao})` : ''}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
