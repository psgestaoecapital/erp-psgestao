// IBPT por empresa (CEO 28/09) · consulta à API "De Olho no Imposto" com o token DA PRÓPRIA EMPRESA, com cache.
// Só servidor (usa supabaseAdmin e lê o token do Vault). O token nunca sai daqui — nem para a tela.
//
// Fonte (RD-72): especificação oficial publicada pelo IBPT em deolhonoimposto.ibpt.org.br/Site/API →
// deolhonoimposto.ibpt.org.br/Content/apideolhonoimposto.json (lida em 28/09/2026). host apidoni.ibpt.org.br, GET:
//   /api/v1/produtos  token, cnpj, codigo (NCM), uf, ex (int, 0 se não houver), codigoInterno (opcional),
//                     descricao, unidadeMedida, valor (unitário), gtin
//   /api/v1/servicos  token, cnpj, codigo (NBS ou LC116), uf, descricao, unidadeMedida, valor
//   retorno (lista ProdutoDTO/ServicoDTO): Codigo, UF, EX (produto), Descricao, Nacional, Importado, Estadual,
//   Municipal, Tipo, VigenciaInicio, VigenciaFim, Chave, Versao, Fonte
// A especificação não descreve o significado dos percentuais — por isso o uso nas notas fica DESLIGADO até o CEO
// conferir na 1ª consulta real (KGF). Guardamos a resposta crua junto no cache para essa conferência.

import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { credencialEmpresa } from '@/lib/credenciais/servidor'

export const IBPT_API = 'https://apidoni.ibpt.org.br/api/v1'
const TEMPO_LIMITE_MS = 5000

export type TipoIbpt = 'produto' | 'servico'
export interface ConsultaIbpt {
  tipo: TipoIbpt
  codigo: string          // NCM (produto) ou NBS/LC116 (serviço)
  uf: string
  ex?: number
  descricao: string
  unidadeMedida?: string
  valor: number
  gtin?: string | null
}
export interface RespostaIbpt {
  codigo: string; uf: string; ex: number | null; descricao: string | null
  nacional: number | null; importado: number | null; estadual: number | null; municipal: number | null
  tipo: string | null; versao: string | null; vigenciaInicio: string | null; vigenciaFim: string | null
  chave: string | null; fonte: string | null
}
export type ResultadoConsulta =
  | { ok: true; dado: RespostaIbpt; cru: unknown }
  | { ok: false; motivo: 'token_invalido' | 'fora_do_ar' | 'sem_dado' | 'erro'; mensagem: string; status?: number }

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

// datas do IBPT chegam como texto (dd/mm/aaaa ou ISO); guardamos ISO (aaaa-mm-dd) ou null
export function dataIbptIso(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

export function normalizarRespostaIbpt(json: unknown): RespostaIbpt | null {
  const item = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | undefined
  if (!item || typeof item !== 'object') return null
  const r: RespostaIbpt = {
    codigo: String(item.Codigo ?? ''), uf: String(item.UF ?? ''), ex: num(item.EX), descricao: str(item.Descricao),
    nacional: num(item.Nacional), importado: num(item.Importado), estadual: num(item.Estadual), municipal: num(item.Municipal),
    tipo: str(item.Tipo), versao: str(item.Versao), vigenciaInicio: dataIbptIso(item.VigenciaInicio), vigenciaFim: dataIbptIso(item.VigenciaFim),
    chave: str(item.Chave), fonte: str(item.Fonte),
  }
  return r.nacional == null && r.estadual == null && r.municipal == null && r.importado == null ? null : r
}

// Chamada crua à API (sem cache). O token é argumento e nunca é logado.
export async function consultarApiIbpt(token: string, cnpj: string, c: ConsultaIbpt): Promise<ResultadoConsulta> {
  const q = new URLSearchParams({
    token, cnpj: cnpj.replace(/\D/g, ''), codigo: c.codigo.replace(/[^\dA-Za-z.]/g, ''), uf: c.uf.toUpperCase(),
    descricao: (c.descricao || 'item').slice(0, 120), unidadeMedida: c.unidadeMedida || 'UN', valor: String(Number(c.valor) || 0),
  })
  if (c.tipo === 'produto') { q.set('ex', String(c.ex ?? 0)); q.set('gtin', c.gtin || 'SEM GTIN') }
  const url = `${IBPT_API}/${c.tipo === 'produto' ? 'produtos' : 'servicos'}?${q.toString()}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS)
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    const texto = await r.text()
    let json: unknown = null
    try { json = JSON.parse(texto) } catch { /* resposta não-JSON */ }
    if (r.status === 401 || r.status === 403) return { ok: false, motivo: 'token_invalido', mensagem: 'O IBPT recusou o token.', status: r.status }
    if (r.status >= 500) return { ok: false, motivo: 'fora_do_ar', mensagem: `O IBPT não respondeu (HTTP ${r.status}).`, status: r.status }
    if (!r.ok) {
      const msg = (json as { Message?: string } | null)?.Message
      const tokenRuim = /token/i.test(texto)
      return { ok: false, motivo: tokenRuim ? 'token_invalido' : 'erro', mensagem: msg ? `IBPT: ${msg}` : `IBPT respondeu HTTP ${r.status}.`, status: r.status }
    }
    const dado = normalizarRespostaIbpt(json)
    if (!dado) return { ok: false, motivo: 'sem_dado', mensagem: 'O IBPT não devolveu alíquotas para este código.' }
    return { ok: true, dado, cru: json }
  } catch (e) {
    const abortou = e instanceof Error && e.name === 'AbortError'
    return { ok: false, motivo: 'fora_do_ar', mensagem: abortou ? 'O IBPT não respondeu em 5 segundos.' : 'Não foi possível falar com o IBPT.' }
  } finally {
    clearTimeout(t)
  }
}

export async function registrarStatusIbpt(companyId: string, patch: Record<string, unknown>) {
  await supabaseAdmin.from('erp_ibpt_empresa_status').upsert({ company_id: companyId, atualizado_em: new Date().toISOString(), ...patch })
}

export async function gravarCacheIbpt(companyId: string, c: ConsultaIbpt, d: RespostaIbpt, cru: unknown) {
  await supabaseAdmin.from('erp_ibpt_cache').upsert({
    company_id: companyId, tipo: c.tipo, codigo: c.codigo, ex: c.ex ?? 0, uf: c.uf.toUpperCase(), descricao: d.descricao,
    nacional: d.nacional, importado: d.importado, estadual: d.estadual, municipal: d.municipal, tipo_ibpt: d.tipo,
    versao: d.versao, vigencia_inicio: d.vigenciaInicio, vigencia_fim: d.vigenciaFim, chave: d.chave, fonte: d.fonte,
    resposta: cru as object, consultado_em: new Date().toISOString(),
  }, { onConflict: 'company_id,tipo,codigo,ex,uf' })
}

// Cache → (token) API → null. null = use a tabela genérica. Nunca lança: a nota nunca trava por causa do IBPT.
export async function aliquotaIbptEmpresa(companyId: string, cnpj: string, c: ConsultaIbpt): Promise<(RespostaIbpt & { origem: 'cache' | 'api' }) | null> {
  try {
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
    const { data: cache } = await supabaseAdmin.from('erp_ibpt_cache')
      .select('codigo, uf, ex, descricao, nacional, importado, estadual, municipal, tipo_ibpt, versao, vigencia_inicio, vigencia_fim, chave, fonte')
      .eq('company_id', companyId).eq('tipo', c.tipo).eq('codigo', c.codigo).eq('ex', c.ex ?? 0).eq('uf', c.uf.toUpperCase())
      .maybeSingle()
    if (cache && (!cache.vigencia_fim || String(cache.vigencia_fim) >= hoje)) {
      return {
        codigo: cache.codigo, uf: cache.uf, ex: cache.ex, descricao: cache.descricao, nacional: num(cache.nacional), importado: num(cache.importado),
        estadual: num(cache.estadual), municipal: num(cache.municipal), tipo: cache.tipo_ibpt, versao: cache.versao,
        vigenciaInicio: cache.vigencia_inicio, vigenciaFim: cache.vigencia_fim, chave: cache.chave, fonte: cache.fonte, origem: 'cache',
      }
    }
    const token = await credencialEmpresa(companyId, 'ibpt', 'token')
    if (!token) return null
    const r = await consultarApiIbpt(token, cnpj, c)
    if (!r.ok) {
      await registrarStatusIbpt(companyId, { ultimo_erro_em: new Date().toISOString(), ultimo_erro: r.mensagem })
      return null
    }
    await gravarCacheIbpt(companyId, c, r.dado, r.cru)
    await registrarStatusIbpt(companyId, { ultima_consulta_ok: new Date().toISOString(), ultima_versao: r.dado.versao, ultima_vigencia_fim: r.dado.vigenciaFim })
    return { ...r.dado, origem: 'api' }
  } catch {
    return null
  }
}
