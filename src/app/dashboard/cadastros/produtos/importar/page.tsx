'use client'

// IMPORT-ESTOQUE · Migração de estoque pela PLANILHA PADRÃO PS (contexto 9c43a93d).
// Baixar modelo (arquivo estático) → subir → PRÉVIA com os 8 indicadores da aba Conferência → carregar.
// RD-26: reusa fn_erp_produto_salvar (validação legal SPED 0200) + fn_movimentar_estoque (saldo).
// Contrato de colunas: src/lib/estoque/colunasImportacao.ts (linha 4 do xlsx; check-modelo-estoque quebra o build se divergir).
// Saldo: ajuste = diferença entre o informado e o atual → UMA movimentação 'inventario' (aceita NEGATIVO;
//   reimportar igual = 0 movimentações). custo_medio → preco_custo_medio + custo_medio_origem='importacao'.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Package, Download, Upload, Loader2, CheckCircle2, AlertTriangle, XCircle, History } from 'lucide-react'
import { COLUNAS_ESTOQUE, TIPOS_SPED, TIPOS_EXIGEM_NCM, ORIGENS, CODIGO_EXEMPLO } from '@/lib/estoque/colunasImportacao'

export const dynamic = 'force-dynamic'

const MODELO_URL = '/modelos/MODELO_migracao_estoque_PS.xlsx'

type Nivel = 'ok' | 'aviso' | 'erro'
interface LinhaParse { n: number; dados: Record<string, string>; nivel: Nivel; mensagens: string[]; qtd: number | null; custo: number | null }
interface ImportRow { id: string; arquivo_nome: string | null; registros_total: number | null; registros_novos: number | null; registros_erro: number | null; status: string | null; iniciado_em: string | null }

const soDig = (s: string) => (s || '').replace(/\D/g, '')
function parseNum(s: string): number | null {
  const t = (s ?? '').trim()
  if (!t) return null
  const n = Number(t.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const numBR = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export default function ImportarEstoquePage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    const cid = localStorage.getItem('ps_empresa_sel')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cid && !cid.startsWith('group_') && cid !== 'consolidado') setCompanyId(cid)
  }, [])

  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<LinhaParse[]>([])
  const [parseErro, setParseErro] = useState<string | null>(null)
  const [soValidas, setSoValidas] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<{ criados: number; comSaldo: number; semMudanca: number; erros: { linha: number; codigo: string; motivo: string }[] } | null>(null)
  const [historico, setHistorico] = useState<ImportRow[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const contagem = useMemo(() => {
    let ok = 0, aviso = 0, erro = 0
    for (const l of linhas) { if (l.nivel === 'erro') erro++; else if (l.nivel === 'aviso') aviso++; else ok++ }
    return { ok, aviso, erro }
  }, [linhas])

  // 8 indicadores = os mesmos da aba Conferência (sobre as linhas lidas, fora EXEMPLO-001)
  const totais = useMemo(() => {
    const qs = linhas.map((l) => l.qtd ?? 0)
    const itens = linhas.length
    const positivos = linhas.filter((l) => (l.qtd ?? 0) > 0).length
    const negativos = linhas.filter((l) => (l.qtd ?? 0) < 0).length
    const codigos = linhas.map((l) => l.dados.codigo).filter(Boolean)
    const repetidos = codigos.length - new Set(codigos).size
    return {
      itens,
      soma_qtd: qs.reduce((s, q) => s + q, 0),
      positivos,
      zerados: itens - positivos - negativos,
      negativos,
      soma_custo: linhas.reduce((s, l) => s + (l.custo ?? 0), 0),
      valor_liquido: linhas.reduce((s, l) => s + (l.qtd ?? 0) * (l.custo ?? 0), 0),
      repetidos,
    }
  }, [linhas])

  const carregarHistorico = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.from('erp_importacoes')
      .select('id, arquivo_nome, registros_total, registros_novos, registros_erro, status, iniciado_em')
      .eq('company_id', companyId).eq('tipo_dado', 'estoque')
      .order('iniciado_em', { ascending: false }).limit(10)
    setHistorico((data as ImportRow[]) || [])
  }, [companyId])
  useEffect(() => { void carregarHistorico() }, [carregarHistorico])

  // ── UPLOAD + parse + prévia ──────────────────────────────────────────────────────────
  async function onArquivo(file: File) {
    setParseErro(null); setResultado(null); setLinhas([])
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const wsName = wb.SheetNames.find((n) => n.toLowerCase().startsWith('estoque')) ?? wb.SheetNames[0]
      const ws = wb.Sheets[wsName]
      const matriz = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' })
      // cabeçalho = linha que contém 'codigo' E 'nome' (chaves técnicas, linha 4 do modelo)
      const idxHeader = matriz.findIndex((row) => {
        const low = row.map((c) => String(c).trim().toLowerCase())
        return low.includes('codigo') && low.includes('nome')
      })
      if (idxHeader < 0) { setParseErro('Não achei o cabeçalho (linha com "codigo" e "nome"). Use a planilha padrão.'); return }
      const header = matriz[idxHeader].map((c) => String(c).trim().toLowerCase())
      const colIndex: Record<string, number> = {}
      for (const c of COLUNAS_ESTOQUE) colIndex[c.key] = header.indexOf(c.key)

      const parsed: LinhaParse[] = []
      const vistos = new Map<string, number>()
      for (let i = idxHeader + 1; i < matriz.length; i++) {
        const row = matriz[i]
        if (!row || row.every((c) => String(c ?? '').trim() === '')) continue
        const get = (k: string) => { const j = colIndex[k]; return j >= 0 ? String(row[j] ?? '').trim() : '' }
        const codigo = get('codigo')
        if (codigo.toUpperCase() === CODIGO_EXEMPLO) continue // linha de exemplo do modelo

        const dados: Record<string, string> = {}
        for (const c of COLUNAS_ESTOQUE) dados[c.key] = get(c.key)
        if (!dados.unidade) dados.unidade = 'UN'
        if (!dados.tipo_item_sped) dados.tipo_item_sped = '00'   // vazio = 00 (revenda)
        if (!dados.origem) dados.origem = '0'                     // vazio = 0 (nacional)

        const qtd = parseNum(dados.estoque_atual)
        const custo = parseNum(dados.custo_medio)
        const erros: string[] = []; const avisos: string[] = []
        if (!codigo) erros.push('Falta código')
        if (!dados.nome) erros.push('Falta descrição')
        if (dados.estoque_atual.trim() === '' || qtd === null) erros.push('Falta quantidade em estoque')
        if (!TIPOS_SPED.includes(dados.tipo_item_sped)) erros.push(`tipo SPED inválido (${dados.tipo_item_sped})`)
        if (!ORIGENS.includes(dados.origem)) erros.push(`origem fora de 0–8 (${dados.origem})`)
        if (TIPOS_EXIGEM_NCM.includes(dados.tipo_item_sped) && !soDig(dados.ncm))
          avisos.push('Sem NCM (item tributável 00–06) — recomendado')   // AVISO, não bloqueia
        if (codigo) {
          if (vistos.has(codigo)) erros.push(`Código repetido no arquivo (linha ${vistos.get(codigo)}) — recusado`)
          else vistos.set(codigo, i + 1)
        }
        const nivel: Nivel = erros.length ? 'erro' : avisos.length ? 'aviso' : 'ok'
        parsed.push({ n: i + 1, dados, nivel, mensagens: [...erros, ...avisos], qtd, custo })
      }
      if (parsed.length === 0) { setParseErro('Nenhuma linha de dados (fora a de exemplo).'); return }
      setLinhas(parsed); setNomeArquivo(file.name)
    } catch (e) {
      setParseErro((e as Error)?.message ?? 'Falha ao ler o arquivo')
    }
  }

  // ── CARREGAR ─────────────────────────────────────────────────────────────────────────
  async function carregar() {
    if (!companyId) return
    const grava = linhas.filter((l) => l.nivel !== 'erro')
    if (contagem.erro > 0 && !soValidas) return
    if (grava.length === 0) return
    setCarregando(true); setProgresso({ feito: 0, total: grava.length })
    let criados = 0, comSaldo = 0, semMudanca = 0
    const erros: { linha: number; codigo: string; motivo: string }[] = []
    const { data: uinfo } = await supabase.auth.getUser()
    const motivo = `Migração · planilha padrão PS · ${nomeArquivo ?? 'planilha'}`

    // histórico (RD-52 · rastro): abre a importação
    let importId: string | null = null
    {
      const { data: imp } = await supabase.from('erp_importacoes')
        .insert({ company_id: companyId, user_id: uinfo?.user?.id ?? null, sistema_origem: 'planilha_padrao',
                  tipo_dado: 'estoque', registros_total: grava.length, status: 'processando',
                  arquivo_nome: nomeArquivo, iniciado_em: new Date().toISOString() })
        .select('id').maybeSingle()
      importId = (imp as { id?: string } | null)?.id ?? null
    }

    for (let i = 0; i < grava.length; i++) {
      const l = grava[i]; const d = l.dados
      try {
        const p_dados: Record<string, unknown> = {
          codigo: d.codigo, nome: d.nome, unidade: d.unidade || 'UN',
          tipo_item_sped: d.tipo_item_sped || '00', origem: d.origem || '0',
        }
        if (soDig(d.ncm)) p_dados.ncm = soDig(d.ncm)
        if (d.cest.trim()) p_dados.cest = d.cest.trim()
        const pv = parseNum(d.preco_venda); if (pv != null) p_dados.preco_venda = pv

        const { data: rSalvar, error: eSalvar } = await supabase.rpc('fn_erp_produto_salvar', { p_company_id: companyId, p_dados })
        const j = rSalvar as { ok?: boolean; id?: string; erro?: string; campos?: string[] } | null
        if (eSalvar || !j?.ok || !j.id) {
          erros.push({ linha: l.n, codigo: d.codigo, motivo: eSalvar?.message ?? j?.erro ?? ('falha ao salvar' + (j?.campos ? ` (${j.campos.join(', ')})` : '')) })
          continue
        }
        const produtoId = j.id; criados++

        // colunas descritivas + custo médio (preco_custo_medio + custo_medio_origem='importacao')
        const extras: Record<string, unknown> = {}
        if (l.custo != null) { extras.preco_custo_medio = l.custo; extras.custo_medio_origem = 'importacao' }
        const em = parseNum(d.estoque_minimo); if (em != null) extras.estoque_minimo = em
        if (d.categoria.trim()) extras.categoria = d.categoria.trim()
        if (d.marca.trim()) extras.marca = d.marca.trim()
        if (d.fornecedor_padrao_nome.trim()) extras.fornecedor_padrao_nome = d.fornecedor_padrao_nome.trim()
        if (d.localizacao.trim()) extras.localizacao = d.localizacao.trim()
        if (d.codigo_barras.trim()) extras.codigo_barras = d.codigo_barras.trim()
        if (Object.keys(extras).length) await supabase.from('erp_produtos').update(extras).eq('id', produtoId).eq('company_id', companyId)

        // saldo por AJUSTE: fn_estoque_ajuste_migracao põe estoque_atual no valor informado (aceita
        // NEGATIVO) com UMA movimentação; se já bate, ajustado=false (0 movimentações, idempotente).
        const informado = l.qtd ?? 0
        const { data: rAj, error: eMov } = await supabase.rpc('fn_estoque_ajuste_migracao', {
          p_produto_id: produtoId, p_saldo_alvo: informado, p_custo: l.custo ?? 0, p_motivo: motivo,
        })
        const aj = rAj as { ok?: boolean; ajustado?: boolean; erro?: string } | null
        if (eMov || !aj?.ok) erros.push({ linha: l.n, codigo: d.codigo, motivo: `produto ok, saldo falhou: ${eMov?.message ?? aj?.erro ?? 'erro'}` })
        else if (aj.ajustado) comSaldo++
        else semMudanca++
      } catch (e) {
        erros.push({ linha: l.n, codigo: d.codigo, motivo: (e as Error)?.message ?? 'erro' })
      }
      setProgresso({ feito: i + 1, total: grava.length })
    }

    if (importId) {
      await supabase.from('erp_importacoes').update({
        registros_novos: criados, registros_atualizados: comSaldo, registros_erro: erros.length,
        status: erros.length && !criados ? 'falhou' : erros.length ? 'parcial' : 'concluido',
        concluido_em: new Date().toISOString(),
      }).eq('id', importId)
    }
    setResultado({ criados, comSaldo, semMudanca, erros })
    setCarregando(false)
    void carregarHistorico()
  }

  function baixarCsvErros() {
    if (!resultado?.erros.length) return
    const linhasCsv = [['linha', 'codigo', 'motivo'], ...resultado.erros.map((e) => [String(e.linha), e.codigo, e.motivo])]
    const csv = linhasCsv.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a'); a.href = url; a.download = 'erros_importacao_estoque.csv'; a.click(); URL.revokeObjectURL(url)
  }

  if (!companyId) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] text-[#3D2314]"><div className="max-w-5xl mx-auto px-4 py-6">
        <div className="p-6 text-center text-[#3D2314]/70 text-[13px]">Selecione uma empresa específica (não consolidado/grupo) para importar estoque.</div>
      </div></div>
    )
  }

  const podeCarregar = linhas.length > 0 && !carregando && (soValidas ? contagem.ok + contagem.aviso > 0 : contagem.erro === 0)
  const Card = ({ l, v, cor }: { l: string; v: string; cor?: string }) => (
    <div className="rounded-lg border border-[#3D2314]/10 bg-white px-3 py-2">
      <div className="text-[11px] text-[#3D2314]/60">{l}</div>
      <div className={`text-[16px] font-medium tabular-nums ${cor ?? 'text-[#3D2314]'}`}>{v}</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#3D2314]"><div className="max-w-5xl mx-auto px-4 py-6">
      <header className="mb-5">
        <a href="/dashboard/commerce/estoque" className="text-[12px] text-[#3D2314]/60 hover:text-[#3D2314]">← Estoque</a>
        <h1 className="text-[24px] sm:text-[28px] font-medium leading-tight flex items-center gap-2 mt-1">
          <Package size={22} className="text-[#C8941A]" /> Migrar estoque por planilha
        </h1>
        <p className="text-[13px] text-[#3D2314]/70 mt-1.5">Baixe a planilha padrão, cole seu estoque, confira e carregue. Saldos negativos são aceitos; reimportar não duplica.</p>
      </header>

      <div className="bg-white rounded-xl border border-[#3D2314]/10 p-4 mb-4 flex flex-wrap items-center gap-3">
        <a href={MODELO_URL} download
          className="px-4 py-2 text-[13px] font-medium rounded-lg border border-[#C8941A] text-[#C8941A] hover:bg-[#FFF8E7] flex items-center gap-2">
          <Download size={15} /> Baixar planilha padrão
        </a>
        <button type="button" onClick={() => inputRef.current?.click()}
          className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-2">
          <Upload size={15} /> {nomeArquivo ? 'Trocar arquivo' : 'Subir planilha'}
        </button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onArquivo(f); e.target.value = '' }} />
        {nomeArquivo && <span className="text-[12px] text-[#3D2314]/60">{nomeArquivo} · {linhas.length} linha(s)</span>}
      </div>

      {parseErro && <div className="mb-4 rounded-lg bg-[#FCEBEB] border border-[#E8A6A5] px-4 py-3 text-[13px] text-[#791F1F]">{parseErro}</div>}

      {linhas.length > 0 && (
        <>
          {/* 8 indicadores (iguais à aba Conferência) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <Card l="Itens" v={numBR(totais.itens)} />
            <Card l="Quantidade líquida" v={numBR(totais.soma_qtd)} />
            <Card l="Com saldo positivo" v={numBR(totais.positivos)} />
            <Card l="Zerados/vazios" v={numBR(totais.zerados)} />
            <Card l="NEGATIVOS" v={numBR(totais.negativos)} cor={totais.negativos > 0 ? 'text-[#A32D2D]' : undefined} />
            <Card l="Soma dos custos" v={brl(totais.soma_custo)} />
            <Card l="Valor do estoque líquido" v={brl(totais.valor_liquido)} />
            <Card l="Códigos repetidos" v={numBR(totais.repetidos)} cor={totais.repetidos > 0 ? 'text-[#A32D2D]' : undefined} />
          </div>

          <div className="bg-white rounded-xl border border-[#3D2314]/10 overflow-hidden mb-4">
            <div className="px-4 py-2.5 border-b border-[#3D2314]/10 flex items-center justify-between gap-3 flex-wrap text-[12.5px]">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-[#166534]"><CheckCircle2 size={14} /> {contagem.ok} ok</span>
                <span className="inline-flex items-center gap-1 text-[#8A5A00]"><AlertTriangle size={14} /> {contagem.aviso} aviso(s)</span>
                <span className="inline-flex items-center gap-1 text-[#A32D2D]"><XCircle size={14} /> {contagem.erro} erro(s)</span>
              </div>
              {contagem.erro > 0 && (
                <label className="flex items-center gap-1.5 text-[12px] text-[#3D2314]/75 cursor-pointer">
                  <input type="checkbox" checked={soValidas} onChange={(e) => setSoValidas(e.target.checked)} className="accent-[#C8941A]" />
                  Carregar só as válidas ({contagem.ok + contagem.aviso})
                </label>
              )}
            </div>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70 sticky top-0"><tr>
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">status</th>
                  <th className="text-left px-3 py-2 font-medium">codigo</th>
                  <th className="text-left px-3 py-2 font-medium">descrição</th>
                  <th className="text-right px-3 py-2 font-medium">qtd</th>
                  <th className="text-right px-3 py-2 font-medium">custo</th>
                  <th className="text-left px-3 py-2 font-medium">mensagens</th>
                </tr></thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={i} className="border-t border-[#3D2314]/8">
                      <td className="px-3 py-1.5 text-[#3D2314]/50">{l.n}</td>
                      <td className="px-3 py-1.5">{l.nivel === 'erro' ? '🔴' : l.nivel === 'aviso' ? '🟡' : '🟢'}</td>
                      <td className="px-3 py-1.5 font-mono">{l.dados.codigo}</td>
                      <td className="px-3 py-1.5 max-w-[220px] truncate">{l.dados.nome}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${(l.qtd ?? 0) < 0 ? 'text-[#A32D2D]' : ''}`}>{l.qtd != null ? numBR(l.qtd) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#3D2314]/70">{l.custo != null ? brl(l.custo) : '—'}</td>
                      <td className="px-3 py-1.5 text-[#3D2314]/70">{l.mensagens.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-[#3D2314]/10 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[12px] text-[#3D2314]/60">{contagem.erro > 0 && !soValidas ? 'Corrija os erros ou marque "carregar só as válidas".' : 'Pronto para carregar.'}</span>
              <button type="button" onClick={() => void carregar()} disabled={!podeCarregar}
                className="px-5 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40 flex items-center gap-2">
                {carregando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {carregando && progresso ? `Carregando ${progresso.feito}/${progresso.total}…` : 'Carregar'}
              </button>
            </div>
          </div>
        </>
      )}

      {resultado && (
        <div className="bg-white rounded-xl border border-[#3D2314]/10 p-4 mb-4">
          <div className="text-[14px] font-medium mb-2 flex items-center gap-2"><CheckCircle2 size={18} className="text-[#3F7012]" /> Migração concluída</div>
          <div className="text-[13px] text-[#3D2314]/80">
            <b>{resultado.criados}</b> produto(s) gravados · <b>{resultado.comSaldo}</b> ajuste(s) de saldo · <b>{resultado.semMudanca}</b> sem mudança (já batia)
            {resultado.erros.length > 0 && <> · <b className="text-[#A32D2D]">{resultado.erros.length}</b> com erro</>}
          </div>
          {resultado.erros.length > 0 && (
            <button type="button" onClick={baixarCsvErros}
              className="mt-3 px-4 py-2 text-[12.5px] font-medium rounded-lg border border-[#A32D2D]/40 text-[#A32D2D] hover:bg-[#FCEBEB] flex items-center gap-2">
              <Download size={14} /> Baixar CSV de erros ({resultado.erros.length})
            </button>
          )}
        </div>
      )}

      {historico.length > 0 && (
        <div className="bg-white rounded-xl border border-[#3D2314]/10 p-4">
          <div className="text-[13px] font-medium mb-2 flex items-center gap-2"><History size={15} className="text-[#C8941A]" /> Importações recentes</div>
          <div className="space-y-1.5">
            {historico.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 text-[12px] text-[#3D2314]/75 border-t border-[#3D2314]/8 pt-1.5 first:border-0 first:pt-0">
                <span className="truncate">{h.arquivo_nome || '(sem nome)'}</span>
                <span className="whitespace-nowrap">{h.registros_novos ?? 0}/{h.registros_total ?? 0} · {h.registros_erro ? `${h.registros_erro} erro(s) · ` : ''}{h.status}</span>
                <span className="whitespace-nowrap text-[#3D2314]/50">{h.iniciado_em ? new Date(h.iniciado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div></div>
  )
}
