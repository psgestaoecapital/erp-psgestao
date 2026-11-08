'use client'

// Importar quadro por planilha (decisão do CEO 08/11, c1e941c5). Um TEMPLATE padrão (.xlsx) que o RH baixa já
// pré-preenchido com um exemplo FICTÍCIO (DEMO, RD-69), edita e sobe — abastecendo setor + posto + pessoa + custo
// de uma vez pela RPC JÁ publicada e guardada fn_rh_importar_postos (RD-26: NÃO altera a RPC). Genérico (qualquer
// indústria). O dado real sobe pela tela, nunca pelo repo.
//
// Casamento da pessoa: a RPC casa o NOME da planilha com o PONTO (ind_ponto_colaborador) para achar o CPF; onde não
// casa, a linha vira EXCEÇÃO para conciliar (o salário fica guardado na exceção). Linha com "VAGA" (ou nome vazio) =
// vaga aberta, sem pessoa.

import { useCallback, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/produtividade/importar'

const C = {
  esp: '#3D2314', espM: '#6B5D4F', espL: '#9C8E80', bg: '#FAF7F2', white: '#FFFFFF', cream: '#F0ECE3', border: '#E0D8CC',
  gold: '#C8941A', green: '#166534', greenBg: '#ECFDF5', amber: '#BA7517', amberBg: '#FAEEDA', red: '#B42318', redBg: '#FCEBEB', blue: '#2F5AA8',
}

// Colunas do template = as chaves que a RPC fn_rh_importar_postos realmente lê. Header humano + aliases tolerantes.
const COLS: { key: string; header: string; aliases: string[]; exemplo: string; num?: boolean; int?: boolean }[] = [
  { key: 'setor_nome', header: 'Setor', aliases: ['setor', 'area', 'departamento'], exemplo: 'Abate' },
  { key: 'codigo_po', header: 'Código do posto', aliases: ['codigo', 'cod posto', 'codigo posto', 'po'], exemplo: 'ABA-01' },
  { key: 'atividade', header: 'Atividade', aliases: ['atividade', 'descricao', 'funcao do posto'], exemplo: 'Insensibilização' },
  { key: 'cargo', header: 'Cargo', aliases: ['cargo', 'funcao'], exemplo: 'Operador de produção' },
  { key: 'centro_custo', header: 'Centro de custo', aliases: ['centro de custo', 'cc', 'centro custo'], exemplo: 'Abate' },
  { key: 'categoria_produto', header: 'Categoria de produto', aliases: ['categoria', 'categoria produto'], exemplo: 'Carne' },
  { key: 'tipo', header: 'Tipo', aliases: ['tipo', 'tipo do posto'], exemplo: 'Produção' },
  { key: 'supervisao', header: 'Supervisão', aliases: ['supervisao', 'supervisor'], exemplo: 'Encarregado de Abate' },
  { key: 'qtd_proj_t1', header: 'Qtd turno 1', aliases: ['qtd t1', 'turno 1', 'qtd turno 1', 'projetado t1'], exemplo: '1', int: true },
  { key: 'qtd_proj_t2', header: 'Qtd turno 2', aliases: ['qtd t2', 'turno 2', 'qtd turno 2', 'projetado t2'], exemplo: '0', int: true },
  { key: 'qtd_proj_t3', header: 'Qtd turno 3', aliases: ['qtd t3', 'turno 3', 'qtd turno 3', 'projetado t3'], exemplo: '0', int: true },
  { key: 'nome', header: 'Pessoa (nome) — ou VAGA', aliases: ['pessoa', 'nome', 'colaborador', 'funcionario'], exemplo: 'Maria Fictícia da Silva' },
  { key: 'funcao_real', header: 'Função real', aliases: ['funcao real', 'funcao exercida'], exemplo: 'Operadora' },
  { key: 'salario_base', header: 'Salário base', aliases: ['salario', 'salario base', 'base'], exemplo: '2200', num: true },
  { key: 'insalubridade', header: 'Insalubridade', aliases: ['insalubridade', 'adicional insalubridade'], exemplo: '264', num: true },
  { key: 'vale', header: 'Vale', aliases: ['vale', 'vale transporte', 'va vt'], exemplo: '0', num: true },
  { key: 'outros', header: 'Outros', aliases: ['outros', 'outros valores'], exemplo: '0', num: true },
  { key: 'encargos_valor', header: 'Encargos (R$)', aliases: ['encargos', 'encargos valor', 'encargos reais'], exemplo: '1100', num: true },
]

// Exemplo FICTÍCIO de abatedouro (RD-69). Nomes e salários FAKE; estrutura de setores/postos como referência.
const DEMO: Record<string, string>[] = [
  { setor_nome: 'Abate', codigo_po: 'ABA-01', atividade: 'Insensibilização', cargo: 'Operador de produção', centro_custo: 'Abate', categoria_produto: 'Carne', tipo: 'Produção', supervisao: 'Encarregado de Abate', qtd_proj_t1: '1', qtd_proj_t2: '0', qtd_proj_t3: '0', nome: 'Maria Fictícia da Silva', funcao_real: 'Operadora', salario_base: '2200', insalubridade: '264', vale: '0', outros: '0', encargos_valor: '1100' },
  { setor_nome: 'Abate', codigo_po: 'ABA-02', atividade: 'Sangria', cargo: 'Operador de produção', centro_custo: 'Abate', categoria_produto: 'Carne', tipo: 'Produção', supervisao: 'Encarregado de Abate', qtd_proj_t1: '1', qtd_proj_t2: '0', qtd_proj_t3: '0', nome: 'VAGA', funcao_real: '', salario_base: '', insalubridade: '', vale: '', outros: '', encargos_valor: '' },
  { setor_nome: 'Desossa', codigo_po: 'DES-01', atividade: 'Quarteamento', cargo: 'Desossador', centro_custo: 'Desossa', categoria_produto: 'Carne', tipo: 'Produção', supervisao: 'Encarregado de Desossa', qtd_proj_t1: '1', qtd_proj_t2: '0', qtd_proj_t3: '0', nome: 'João Fictício de Souza', funcao_real: 'Desossador', salario_base: '2600', insalubridade: '312', vale: '0', outros: '0', encargos_valor: '1300' },
]

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const toNum = (s: string): number => {
  const t = String(s ?? '').trim(); if (!t) return 0
  const n = Number(t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

type Resultado = {
  ok: boolean; erro?: string
  criados?: { postos: number; vagas: number; alocacoes: number; remuneracoes: number; excecoes: number; ja_existiam: number }
  antes?: { postos: number; alocacoes: number; remuneracoes: number }
  depois?: { postos: number; alocacoes: number; remuneracoes: number }
  soma_base_total?: number
}

export function ImportarPostosView() {
  const { selInfo, sel } = useCompanyIds()
  const companyId = selInfo.tipo === 'empresa' && sel ? sel : null
  const inputRef = useRef<HTMLInputElement>(null)
  const [linhas, setLinhas] = useState<Record<string, unknown>[]>([])
  const [nomeArquivo, setNomeArquivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const baixarModelo = useCallback(() => {
    const header = COLS.map((c) => c.header)
    const corpo = DEMO.map((r) => COLS.map((c) => r[c.key] ?? ''))
    const ws = XLSX.utils.aoa_to_sheet([header, ...corpo])
    ws['!cols'] = COLS.map((c) => ({ wch: Math.max(12, c.header.length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Quadro')
    XLSX.writeFile(wb, 'modelo-quadro-postos.xlsx')
  }, [])

  const casar = (headerRow: string[]): Record<string, number> => {
    const idx: Record<string, number> = {}
    const normed = headerRow.map((h) => norm(String(h ?? '')))
    for (const c of COLS) {
      const alvos = new Set([norm(c.header), norm(c.key), ...c.aliases.map(norm)])
      idx[c.key] = normed.findIndex((h) => h && alvos.has(h))
    }
    return idx
  }

  async function onArquivo(file: File) {
    setErro(null); setResultado(null); setLinhas([]); setNomeArquivo('')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const wsName = wb.SheetNames.find((n) => n.toLowerCase().startsWith('quadro')) ?? wb.SheetNames[0]
      const matriz = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wsName], { header: 1, raw: false, defval: '' })
      let idxHeader = -1, colIndex: Record<string, number> = {}
      for (let r = 0; r < Math.min(matriz.length, 12); r++) {
        const cand = casar((matriz[r] ?? []).map((c) => String(c ?? '')))
        const reconhecidas = COLS.filter((c) => cand[c.key] >= 0).length
        if (cand['setor_nome'] >= 0 && cand['atividade'] >= 0 && reconhecidas >= 4) { idxHeader = r; colIndex = cand; break }
      }
      if (idxHeader < 0) { setErro('Não reconheci o cabeçalho. Use o modelo (botão "Baixar modelo") com a linha de cabeçalho: Setor, Atividade, Pessoa…'); return }

      const parsed: Record<string, unknown>[] = []
      for (let i = idxHeader + 1; i < matriz.length; i++) {
        const row = matriz[i]
        if (!row || row.every((c) => String(c ?? '').trim() === '')) continue
        const get = (k: string) => { const j = colIndex[k]; return j >= 0 ? String(row[j] ?? '').trim() : '' }
        const l: Record<string, unknown> = {}
        for (const c of COLS) {
          const v = get(c.key)
          if (c.int) l[c.key] = Math.trunc(toNum(v))
          else if (c.num) l[c.key] = toNum(v)
          else l[c.key] = v
        }
        l['qtd_proj_total'] = (Number(l['qtd_proj_t1']) || 0) + (Number(l['qtd_proj_t2']) || 0) + (Number(l['qtd_proj_t3']) || 0)
        // ignora a linha de exemplo do próprio modelo
        if (l['codigo_po'] === 'ABA-01' && l['nome'] === 'Maria Fictícia da Silva') continue
        if (String(l['setor_nome'] ?? '').trim() === '' && String(l['atividade'] ?? '').trim() === '') continue
        parsed.push(l)
      }
      if (parsed.length === 0) { setErro('Nenhuma linha de dados (fora o exemplo do modelo).'); return }
      setLinhas(parsed); setNomeArquivo(file.name)
    } catch (e) {
      setErro((e as Error)?.message ?? 'Falha ao ler o arquivo.')
    }
  }

  async function importar() {
    if (!companyId || linhas.length === 0) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_rh_importar_postos', { p_company_id: companyId, p_linhas: linhas })
    setBusy(false)
    if (error) { setErro(error.message); return }
    const r = data as Resultado
    if (!r?.ok) { setErro(r?.erro === 'sem_permissao' ? 'Sem permissão: só RH, sócio ou admin importam o quadro.' : (r?.erro ?? 'Falha na importação.')); return }
    setResultado(r); setLinhas([]); setNomeArquivo('')
  }

  if (!companyId) {
    return <div style={{ padding: 24, color: C.espM, background: C.bg, minHeight: '100vh' }}>Selecione uma empresa para importar o quadro de postos.</div>
  }

  const vagas = linhas.filter((l) => { const n = String(l['nome'] ?? '').trim(); return !n || n.toUpperCase().includes('VAGA') }).length

  return (
    <div style={{ padding: '22px 18px', background: C.bg, minHeight: '100vh', color: C.esp }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <a href="/dashboard/produtividade" style={{ fontSize: 12.5, color: C.blue, textDecoration: 'none' }}>← Voltar ao quadro de postos</a>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '8px 0 4px' }}>Importar quadro por planilha</h1>
        <p style={{ fontSize: 13.5, color: C.espM, margin: '0 0 18px', lineHeight: 1.5 }}>
          Baixe o modelo já com um exemplo, edite com o seu quadro (setor, posto, pessoa e custo) e suba. Abastece tudo de
          uma vez. A pessoa é casada pelo <b>nome</b> com o ponto; onde não casa, a linha vira <b>exceção</b> para conciliar.
          Deixe <b>“VAGA”</b> no nome para registrar uma vaga aberta.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button type="button" data-testid="import-postos-baixar" onClick={baixarModelo}
              style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, borderRadius: 9, border: `1px solid ${C.border}`, background: C.white, color: C.esp, cursor: 'pointer' }}>
              ⬇️ Baixar modelo (.xlsx)
            </button>
            <AjudaCampo chave="prod.import.modelo" rota={ROTA} />
          </span>
          <label data-testid="import-postos-arquivo-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 13, fontWeight: 700, borderRadius: 9, border: 'none', background: C.gold, color: C.white, cursor: 'pointer' }}>
            📄 Escolher planilha <AjudaCampo chave="prod.import.arquivo" rota={ROTA} />
            <input ref={inputRef} data-testid="import-postos-arquivo" type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onArquivo(f); e.target.value = '' }} />
          </label>
        </div>

        {erro && <div style={{ fontSize: 13, color: C.red, background: C.redBg, borderRadius: 9, padding: '10px 12px', marginBottom: 14 }}>{erro}</div>}

        {linhas.length > 0 && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 11, background: C.white, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{nomeArquivo}</div>
            <div style={{ fontSize: 13, color: C.espM, marginBottom: 12 }}>
              {linhas.length} linha{linhas.length === 1 ? '' : 's'} lida{linhas.length === 1 ? '' : 's'} · {vagas} vaga{vagas === 1 ? '' : 's'} (sem pessoa).
              Confira e importe — a carga é idempotente (não duplica posto com o mesmo código, nem pessoa já alocada).
            </div>
            <button type="button" disabled={busy} data-testid="import-postos-importar" onClick={() => void importar()}
              style={{ padding: '10px 18px', fontSize: 13.5, fontWeight: 800, borderRadius: 9, border: 'none', background: busy ? C.espL : C.gold, color: C.white, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Importando…' : 'Importar quadro'}
            </button>
          </div>
        )}

        {resultado?.ok && resultado.criados && (
          <div data-testid="import-postos-resultado" style={{ border: `1px solid ${C.border}`, borderRadius: 11, background: C.greenBg, padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.green, marginBottom: 8 }}>✓ Quadro importado</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: C.esp, lineHeight: 1.7 }}>
              <li>{resultado.criados.postos} posto(s) novo(s) · {resultado.criados.vagas} vaga(s)</li>
              <li>{resultado.criados.alocacoes} pessoa(s) alocada(s) · {resultado.criados.remuneracoes} com custo</li>
              <li>{resultado.criados.excecoes} exceção(ões) para conciliar (nome não casou com o ponto) · {resultado.criados.ja_existiam} já existia(m)</li>
              {typeof resultado.soma_base_total === 'number' && <li>Soma dos salários-base da planilha: {resultado.soma_base_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</li>}
            </ul>
            <a href="/dashboard/produtividade" style={{ display: 'inline-block', marginTop: 12, fontSize: 13, fontWeight: 700, color: C.blue, textDecoration: 'none' }}>Ver o quadro de postos →</a>
          </div>
        )}
      </div>
    </div>
  )
}
