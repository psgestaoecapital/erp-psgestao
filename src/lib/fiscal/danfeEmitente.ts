// Chamado #11234 — dados do EMITENTE para o cabeçalho do DANFE (endereço, logo), lidos do cadastro da empresa.
// Só leitura de `companies`; nenhuma regra fiscal. Servidor (usa supabaseAdmin): a logo é baixada aqui e vai em base64 para
// o gerador do PDF (que roda no navegador no espelho e no servidor no DANFE da nota autorizada).
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { DanfeDados } from './danfePdf'

type Emitente = DanfeDados['emitente']

const LOGO_MAX_BYTES = 300_000

async function baixarLogo(url: string | null | undefined): Promise<Emitente['logo']> {
  if (!url || !/^https:\/\//i.test(url)) return null
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 4000)
    const r = await fetch(url, { signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    const tipo = (r.headers.get('content-type') ?? '').toLowerCase()
    const mime = tipo.includes('png') ? 'image/png' : (tipo.includes('jpeg') || tipo.includes('jpg')) ? 'image/jpeg' : null
    if (!mime) return null // pdf-lib só embute PNG e JPEG; SVG/WebP ficam de fora (o cabeçalho sai sem logo)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length === 0 || buf.length > LOGO_MAX_BYTES) return null
    return { base64: buf.toString('base64'), mime }
  } catch {
    return null
  }
}

export type EmpresaDanfeRow = {
  razao_social: string | null; cnpj: string | null; inscricao_estadual: string | null
  logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null
  cidade: string | null; cidade_estado: string | null; uf_fiscal: string | null; cep: string | null; logo_url: string | null
}

export function emitenteDeEmpresa(e: EmpresaDanfeRow, logo: Emitente['logo']): Emitente {
  // cidade_estado costuma vir "Cidade/UF" ou "Cidade - UF": usado só quando a coluna cidade não existe/está vazia
  const [cidadeCE] = String(e.cidade_estado ?? '').split(/\s*[\/-]\s*/)
  return {
    razaoSocial: e.razao_social ?? '',
    cnpj: e.cnpj ?? null,
    ie: e.inscricao_estadual ?? null,
    endereco: [e.logradouro, e.numero, e.complemento].filter(Boolean).join(', ') || null,
    bairro: e.bairro ?? null,
    cep: e.cep ?? null,
    municipio: e.cidade || cidadeCE || null,
    uf: e.uf_fiscal ?? null,
    fone: null,
    logo,
  }
}

/** Emitente do DANFE a partir da empresa. Falha de leitura/logo nunca derruba a prévia: devolve o que houver. */
export async function carregarEmitenteDanfe(companyId: string): Promise<Partial<Emitente> | null> {
  try {
    const { data } = await supabaseAdmin
      .from('companies')
      .select('razao_social, cnpj, inscricao_estadual, logradouro, numero, complemento, bairro, cidade, cidade_estado, uf_fiscal, cep, logo_url')
      .eq('id', companyId)
      .maybeSingle()
    if (!data) return null
    const row = data as unknown as EmpresaDanfeRow
    return emitenteDeEmpresa(row, await baixarLogo(row.logo_url))
  } catch {
    return null
  }
}
