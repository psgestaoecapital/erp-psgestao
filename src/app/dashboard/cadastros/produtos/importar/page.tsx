'use client'

// IMPORT-ESTOQUE · Importar produtos + saldo por planilha (baixar modelo → subir → preview → carregar).
// RD-26: reusa fn_erp_produto_salvar (validação legal SPED 0200) + fn_movimentar_estoque (saldo).
// RD-52: o modelo é gerado a partir de UMA lista de colunas (fonte única, no código).
// Multi-tenant: grava sempre no company_id selecionado no topo (localStorage ps_empresa_sel).

import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Package, Download, Upload, Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'

export const dynamic = 'force-dynamic'

// ── Fonte única das colunas (ordem = ordem do modelo). obrig = obrigatória. ──────────────
const COLUNAS: { key: string; label: string; obrig?: boolean; ajuda: string }[] = [
  { key: 'codigo', label: 'codigo', obrig: true, ajuda: 'Código interno único do produto. Obrigatório.' },
  { key: 'nome', label: 'nome', obrig: true, ajuda: 'Descrição do produto. Obrigatório.' },
  { key: 'unidade', label: 'unidade', obrig: true, ajuda: 'Unidade (UN, CX, MT, KG...). Vazio = UN.' },
  { key: 'tipo_item_sped', label: 'tipo_item_sped', obrig: true, ajuda: 'SPED 0200: 00=merc. revenda, 01=matéria-prima, ... 07=serviço, 99=outros. Obrigatório.' },
  { key: 'ncm', label: 'ncm', ajuda: 'NCM (8 dígitos). Obrigatório quando tipo_item_sped for 00–06.' },
  { key: 'cest', label: 'cest', ajuda: 'CEST (se houver ST). Opcional.' },
  { key: 'origem', label: 'origem', obrig: true, ajuda: 'Origem da mercadoria 0–8 (0=nacional). Vazio = 0.' },
  { key: 'preco_custo', label: 'preco_custo', ajuda: 'Custo unitário. Opcional.' },
  { key: 'preco_venda', label: 'preco_venda', ajuda: 'Preço de venda. Opcional.' },
  { key: 'estoque_atual', label: 'estoque_atual', ajuda: 'Saldo inicial. Se > 0, gera movimentação de entrada.' },
  { key: 'estoque_minimo', label: 'estoque_minimo', ajuda: 'Estoque mínimo p/ alerta. Opcional.' },
  { key: 'categoria', label: 'categoria', ajuda: 'Categoria. Opcional.' },
  { key: 'marca', label: 'marca', ajuda: 'Marca. Opcional.' },
  { key: 'fornecedor_padrao_nome', label: 'fornecedor_padrao_nome', ajuda: 'Nome do fornecedor padrão. Opcional.' },
  { key: 'localizacao', label: 'localizacao', ajuda: 'Localização física (prateleira/rua). Opcional.' },
  { key: 'codigo_barras', label: 'codigo_barras', ajuda: 'EAN/GTIN. Opcional.' },
]

const TIPOS_SPED = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '99']
const TIPOS_EXIGEM_NCM = ['00', '01', '02', '03', '04', '05', '06']
const ORIGENS = ['0', '1', '2', '3', '4', '5', '6', '7', '8']

type Nivel = 'ok' | 'aviso' | 'erro'
interface LinhaParse {
  n: number // nº da linha na planilha (p/ mensagem)
  dados: Record<string, string>
  nivel: Nivel
  mensagens: string[]
}

const soDig = (s: string) => (s || '').replace(/\D/g, '')
// aceita "1.234,56" (pt-BR) ou "1234.56" → número; null se vazio/invál.
function parseNum(s: string): number | null {
  const t = (s ?? '').trim()
  if (!t) return null
  const n = Number(t.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export default function ImportarEstoquePage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  useEffect(() => {
    // pós-mount (evita mismatch de hidratação com localStorage) — mesmo padrão da tela de Produtos.
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
  const [resultado, setResultado] = useState<{
    criados: number; comSaldo: number; ignorados: number
    erros: { linha: number; codigo: string; motivo: string }[]
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const contagem = useMemo(() => {
    let ok = 0, aviso = 0, erro = 0
    for (const l of linhas) { if (l.nivel === 'erro') erro++; else if (l.nivel === 'aviso') aviso++; else ok++ }
    return { ok, aviso, erro }
  }, [linhas])

  // ── DOWNLOAD do modelo (gerado do COLUNAS — fonte única) ─────────────────────────────
  function baixarModelo() {
    const header = COLUNAS.map((c) => c.label)
    // 2 linhas de exemplo (codigo começa com EX- → ignoradas no upload)
    const ex1 = ['EX-001', 'PRODUTO EXEMPLO REVENDA', 'UN', '00', '39269090', '', '0', '10,00', '25,00', '100', '5', 'Categoria A', 'Marca X', 'Fornecedor Y', 'Prateleira A1', '7891234567890']
    const ex2 = ['EX-002', 'SERVICO EXEMPLO', 'UN', '99', '', '', '0', '', '150,00', '0', '', '', '', '', '', '']
    const wsProd = XLSX.utils.aoa_to_sheet([header, ex1, ex2])
    const instr: string[][] = [
      ['MODELO DE IMPORTAÇÃO DE ESTOQUE · PS Gestão'],
      ['Preencha a aba "Produtos". As linhas de exemplo (código começando com EX-) são ignoradas na importação.'],
      ['Obrigatórios: codigo, nome, unidade, tipo_item_sped, origem. NCM é obrigatório quando tipo_item_sped for 00–06.'],
      ['Unidade vazia vira UN. Origem vazia vira 0.'],
      [''],
      ['Coluna', 'Obrigatória', 'Descrição'],
      ...COLUNAS.map((c) => [c.label, c.obrig ? 'SIM' : 'não', c.ajuda]),
      [''],
      ['tipo_item_sped', '', '00=Mercadoria p/ revenda · 01=Matéria-prima · 02=Embalagem · 03=Produto em processo · 04=Produto acabado · 05=Subproduto · 06=Produto intermediário · 07=Material de uso e consumo · 08=Ativo imobilizado · 09=Serviços · 10=Outros insumos · 99=Outras'],
      ['origem', '', '0=Nacional · 1=Estrangeira import. direta · 2=Estrangeira merc. interno · 3..8=demais (conf. tabela ICMS)'],
    ]
    const wsInstr = XLSX.utils.aoa_to_sheet(instr)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsProd, 'Produtos')
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instruções')
    XLSX.writeFile(wb, 'MODELO_importacao_estoque_PS.xlsx')
  }

  // ── UPLOAD + parse + dry-run ─────────────────────────────────────────────────────────
  async function onArquivo(file: File) {
    setParseErro(null); setResultado(null); setLinhas([])
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const wsName = wb.SheetNames.find((n) => n.toLowerCase().startsWith('produto')) ?? wb.SheetNames[0]
      const ws = wb.Sheets[wsName]
      const matriz = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' })
      // detecta a linha de cabeçalho (contém 'codigo' e 'nome')
      const idxHeader = matriz.findIndex((row) =>
        row.map((c) => String(c).trim().toLowerCase()).includes('codigo') &&
        row.map((c) => String(c).trim().toLowerCase()).includes('nome'))
      if (idxHeader < 0) { setParseErro('Não achei o cabeçalho (linha com "codigo" e "nome"). Use o modelo.'); return }
      const header = matriz[idxHeader].map((c) => String(c).trim().toLowerCase())
      const colIndex: Record<string, number> = {}
      for (const c of COLUNAS) colIndex[c.key] = header.indexOf(c.label)

      const parsed: LinhaParse[] = []
      const codigosVistos = new Map<string, number>() // codigo → 1ª linha
      for (let i = idxHeader + 1; i < matriz.length; i++) {
        const row = matriz[i]
        if (!row || row.every((c) => String(c ?? '').trim() === '')) continue // linha vazia
        const get = (k: string) => { const j = colIndex[k]; return j >= 0 ? String(row[j] ?? '').trim() : '' }
        const codigo = get('codigo')
        if (codigo.toUpperCase().startsWith('EX-')) continue // linha de exemplo do modelo

        const dados: Record<string, string> = {}
        for (const c of COLUNAS) dados[c.key] = get(c.key)
        // normalizações (RD-51): unidade vazia → UN; origem vazia → 0
        if (!dados.unidade) dados.unidade = 'UN'
        if (!dados.origem) dados.origem = '0'

        const erros: string[] = []
        const avisos: string[] = []
        if (!codigo) erros.push('Falta código')
        if (!dados.nome) erros.push('Falta nome')
        if (!dados.tipo_item_sped) erros.push('Falta tipo_item_sped')
        else if (!TIPOS_SPED.includes(dados.tipo_item_sped)) erros.push(`tipo_item_sped inválido (${dados.tipo_item_sped})`)
        const ncm = soDig(dados.ncm)
        if (TIPOS_EXIGEM_NCM.includes(dados.tipo_item_sped) && !ncm) erros.push('Informe NCM ou use Tipo SPED 99')
        if (!ORIGENS.includes(dados.origem)) erros.push(`origem fora de 0–8 (${dados.origem})`)
        if (codigo) {
          if (codigosVistos.has(codigo)) erros.push(`Código duplicado no arquivo (linha ${codigosVistos.get(codigo)})`)
          else codigosVistos.set(codigo, i + 1)
        }
        // avisos (não bloqueiam)
        if (!dados.preco_custo) avisos.push('Sem custo')
        if (!dados.categoria) avisos.push('Sem categoria')

        const nivel: Nivel = erros.length ? 'erro' : avisos.length ? 'aviso' : 'ok'
        parsed.push({ n: i + 1, dados, nivel, mensagens: [...erros, ...avisos] })
      }
      if (parsed.length === 0) { setParseErro('Nenhuma linha de dados encontrada (fora as de exemplo).'); return }
      setLinhas(parsed)
      setNomeArquivo(file.name)
    } catch (e) {
      setParseErro((e as Error)?.message ?? 'Falha ao ler o arquivo')
    }
  }

  // ── CARREGAR (gravação autenticada) ──────────────────────────────────────────────────
  async function carregar() {
    if (!companyId) return
    const alvo = linhas.filter((l) => (soValidas ? l.nivel !== 'erro' : true))
    if (contagem.erro > 0 && !soValidas) return // botão desabilitado; guarda extra
    const grava = alvo.filter((l) => l.nivel !== 'erro')
    setCarregando(true)
    setProgresso({ feito: 0, total: grava.length })
    let criados = 0, comSaldo = 0, ignorados = 0
    const erros: { linha: number; codigo: string; motivo: string }[] = []

    for (let i = 0; i < grava.length; i++) {
      const l = grava[i]
      const d = l.dados
      try {
        // 1) produto (validação legal na RPC) — ON CONFLICT(company_id,codigo) atualiza, não duplica
        const p_dados: Record<string, unknown> = {
          codigo: d.codigo, nome: d.nome, unidade: d.unidade || 'UN',
          tipo_item_sped: d.tipo_item_sped, origem: d.origem || '0',
        }
        if (soDig(d.ncm)) p_dados.ncm = soDig(d.ncm)
        if (d.cest.trim()) p_dados.cest = d.cest.trim()
        const pv = parseNum(d.preco_venda); if (pv != null) p_dados.preco_venda = pv

        const { data: rSalvar, error: eSalvar } = await supabase.rpc('fn_erp_produto_salvar', {
          p_company_id: companyId, p_dados,
        })
        const j = rSalvar as { ok?: boolean; id?: string; erro?: string; campos?: string[] } | null
        if (eSalvar || !j?.ok || !j.id) {
          erros.push({ linha: l.n, codigo: d.codigo, motivo: eSalvar?.message ?? j?.erro ?? 'falha ao salvar' + (j?.campos ? ` (${j.campos.join(', ')})` : '') })
          ignorados++; setProgresso({ feito: i + 1, total: grava.length }); continue
        }
        const produtoId = j.id
        criados++

        // 2) colunas descritivas que a RPC não grava → update direto (RLS: dono da empresa)
        const extras: Record<string, unknown> = {}
        const pc = parseNum(d.preco_custo); if (pc != null) extras.preco_custo = pc
        const em = parseNum(d.estoque_minimo); if (em != null) extras.estoque_minimo = em
        if (d.categoria.trim()) extras.categoria = d.categoria.trim()
        if (d.marca.trim()) extras.marca = d.marca.trim()
        if (d.fornecedor_padrao_nome.trim()) extras.fornecedor_padrao_nome = d.fornecedor_padrao_nome.trim()
        if (d.localizacao.trim()) extras.localizacao = d.localizacao.trim()
        if (d.codigo_barras.trim()) extras.codigo_barras = d.codigo_barras.trim()
        if (Object.keys(extras).length > 0) {
          await supabase.from('erp_produtos').update(extras).eq('id', produtoId).eq('company_id', companyId)
        }

        // 3) saldo inicial (se > 0) via movimentação — idempotente por ref_tipo
        const saldo = parseNum(d.estoque_atual)
        if (saldo != null && saldo > 0) {
          const { data: movExist } = await supabase
            .from('erp_estoque_movimentacoes')
            .select('id').eq('produto_id', produtoId).eq('ref_tipo', 'importacao_planilha').limit(1)
          if (!movExist || movExist.length === 0) {
            const { error: eMov } = await supabase.rpc('fn_movimentar_estoque', {
              p_produto_id: produtoId, p_local_id: null, p_tipo: 'entrada',
              p_quantidade: saldo, p_custo_unitario: pc ?? 0,
              p_motivo: 'Saldo inicial (importação planilha)', p_ref_tipo: 'importacao_planilha',
            })
            if (eMov) erros.push({ linha: l.n, codigo: d.codigo, motivo: `produto ok, saldo falhou: ${eMov.message}` })
            else comSaldo++
          }
        }
      } catch (e) {
        erros.push({ linha: l.n, codigo: d.codigo, motivo: (e as Error)?.message ?? 'erro' })
        ignorados++
      }
      setProgresso({ feito: i + 1, total: grava.length })
    }

    setResultado({ criados, comSaldo, ignorados, erros })
    setCarregando(false)
  }

  function baixarCsvErros() {
    if (!resultado?.erros.length) return
    const linhasCsv = [['linha', 'codigo', 'motivo'], ...resultado.erros.map((e) => [String(e.linha), e.codigo, e.motivo])]
    const csv = linhasCsv.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'erros_importacao.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  if (!companyId) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] text-[#3D2314]">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="p-6 text-center text-[#3D2314]/70 text-[13px]">
            Selecione uma empresa específica (não consolidado ou grupo) pra importar estoque.
          </div>
        </div>
      </div>
    )
  }

  const podeCarregar = linhas.length > 0 && !carregando && (soValidas ? contagem.ok + contagem.aviso > 0 : contagem.erro === 0)

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#3D2314]">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <header className="mb-5">
          <a href="/dashboard/cadastros/produtos" className="text-[12px] text-[#3D2314]/60 hover:text-[#3D2314]">← Produtos</a>
          <h1 className="text-[24px] sm:text-[28px] font-medium leading-tight flex items-center gap-2 mt-1">
            <Package size={22} className="text-[#C8941A]" /> Importar estoque por planilha
          </h1>
          <p className="text-[13px] text-[#3D2314]/70 mt-1.5">Baixe o modelo, preencha, suba e confira antes de carregar.</p>
        </header>

        {/* Passo 1: modelo + upload */}
        <div className="bg-white rounded-xl border border-[#3D2314]/10 p-4 mb-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={baixarModelo}
            className="px-4 py-2 text-[13px] font-medium rounded-lg border border-[#C8941A] text-[#C8941A] hover:bg-[#FFF8E7] flex items-center gap-2">
            <Download size={15} /> Baixar planilha modelo
          </button>
          <button type="button" onClick={() => inputRef.current?.click()}
            className="px-4 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] flex items-center gap-2">
            <Upload size={15} /> {nomeArquivo ? 'Trocar arquivo' : 'Subir planilha'}
          </button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onArquivo(f); e.target.value = '' }} />
          {nomeArquivo && <span className="text-[12px] text-[#3D2314]/60">{nomeArquivo} · {linhas.length} linha(s)</span>}
        </div>

        {parseErro && (
          <div className="mb-4 rounded-lg bg-[#FCEBEB] border border-[#E8A6A5] px-4 py-3 text-[13px] text-[#791F1F]">{parseErro}</div>
        )}

        {/* Passo 2: preview / dry-run */}
        {linhas.length > 0 && (
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
                <thead className="bg-[#3D2314]/5 text-[11px] text-[#3D2314]/70 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">#</th>
                    <th className="text-left px-3 py-2 font-medium">status</th>
                    <th className="text-left px-3 py-2 font-medium">codigo</th>
                    <th className="text-left px-3 py-2 font-medium">nome</th>
                    <th className="text-left px-3 py-2 font-medium">tipo</th>
                    <th className="text-left px-3 py-2 font-medium">ncm</th>
                    <th className="text-right px-3 py-2 font-medium">saldo</th>
                    <th className="text-left px-3 py-2 font-medium">mensagens</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={i} className="border-t border-[#3D2314]/8">
                      <td className="px-3 py-1.5 text-[#3D2314]/50">{l.n}</td>
                      <td className="px-3 py-1.5">
                        {l.nivel === 'erro' ? '🔴' : l.nivel === 'aviso' ? '🟡' : '🟢'}
                      </td>
                      <td className="px-3 py-1.5 font-mono">{l.dados.codigo}</td>
                      <td className="px-3 py-1.5 max-w-[220px] truncate">{l.dados.nome}</td>
                      <td className="px-3 py-1.5">{l.dados.tipo_item_sped}</td>
                      <td className="px-3 py-1.5 font-mono text-[#3D2314]/70">{l.dados.ncm || '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.dados.estoque_atual || '—'}</td>
                      <td className="px-3 py-1.5 text-[#3D2314]/70">{l.mensagens.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-[#3D2314]/10 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[12px] text-[#3D2314]/60">
                {contagem.ok} ok · {contagem.aviso} aviso(s) · {contagem.erro} erro(s)
                {contagem.erro > 0 && !soValidas && ' — corrija os erros ou marque "carregar só as válidas"'}
              </span>
              <button type="button" onClick={() => void carregar()} disabled={!podeCarregar}
                className="px-5 py-2 text-[13px] font-medium rounded-lg bg-[#C8941A] text-white hover:bg-[#A87810] disabled:opacity-40 flex items-center gap-2">
                {carregando ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {carregando && progresso ? `Carregando ${progresso.feito}/${progresso.total}…` : 'Carregar'}
              </button>
            </div>
          </div>
        )}

        {/* Passo 3: resultado */}
        {resultado && (
          <div className="bg-white rounded-xl border border-[#3D2314]/10 p-4">
            <div className="text-[14px] font-medium text-[#3D2314] mb-2 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-[#3F7012]" /> Importação concluída
            </div>
            <div className="text-[13px] text-[#3D2314]/80">
              <b>{resultado.criados}</b> produto(s) criados/atualizados · <b>{resultado.comSaldo}</b> com saldo inicial
              {resultado.ignorados > 0 && <> · <b>{resultado.ignorados}</b> ignorado(s)</>}
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
      </div>
    </div>
  )
}
