import { NextRequest, NextResponse } from 'next/server'
import { exigirUsuario, exigirEmpresas, negar } from '@/lib/auth/guardaApi'
import { credencialEmpresa } from '@/lib/credenciais/servidor'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { mapearNfseOmie, extrairLista, type NfseOmie } from '@/lib/omie/nfse'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BUCKET = 'fiscal-xmls'
const POR_PAGINA = 50
const LIMITE_PAGINAS = 200

// Importa as NFS-e EMITIDAS do OMIE (todo o histórico) e os XMLs para erp_nfse_emitidas + Storage (#2712).
// Idempotente: chave (company_id, provider='omie', provider_reference=nCodNF). Só lê do OMIE; não emite nada.
// dry_run=true: não grava, devolve contagem e o formato da 1ª nota (prova no dado antes de gravar).
// pagina_inicial/max_paginas: retomada em lotes (cada chamada cabe nos 300 s).
async function omieNfse(appKey: string, appSecret: string, call: string, param: Record<string, unknown>) {
  const res = await fetch('https://app.omie.com.br/api/v1/servicos/nfse/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
  })
  return (await res.json()) as Record<string, unknown>
}

function falha(r: Record<string, unknown>): string | null {
  const c = r.faultcode ?? r.fault_code
  const s = r.faultstring ?? r.fault_string
  return c || s ? [c, s].filter(Boolean).join(' · ') : null
}

async function baixarXml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const t = await r.text()
    return t.trimStart().startsWith('<') ? t : null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const guarda = await exigirUsuario(req, { admin: true })
  if (guarda instanceof NextResponse) return guarda
  const body = (await req.json().catch(() => ({}))) as {
    company_id?: string
    dry_run?: boolean
    pagina_inicial?: number
    max_paginas?: number
  }
  const companyId = body.company_id
  const negado = await exigirEmpresas(guarda, [companyId])
  if (negado) return negado
  const appKey = await credencialEmpresa(companyId!, 'omie', 'app_key')
  const appSecret = await credencialEmpresa(companyId!, 'omie', 'app_secret')
  if (!appKey || !appSecret) return negar(400, 'Credenciais do Omie não cadastradas para esta empresa.')

  const { data: emp } = await supabaseAdmin
    .from('companies')
    .select('cnpj, razao_social, inscricao_municipal')
    .eq('id', companyId!)
    .maybeSingle()
  if (!emp?.cnpj) return negar(400, 'Empresa sem CNPJ cadastrado.')

  const dry = body.dry_run === true
  const inicio = Math.max(1, Number(body.pagina_inicial) || 1)
  const fim = inicio + Math.min(Number(body.max_paginas) || 20, LIMITE_PAGINAS) - 1
  const r = { paginas: 0, total_omie: 0, lidas: 0, inseridas: 0, atualizadas: 0, xml_ok: 0, xml_sem: 0, puladas: 0, erros: [] as string[] }
  let amostra: unknown = null
  let proxima: number | null = null

  for (let pag = inicio; pag <= fim; pag++) {
    const resp = await omieNfse(appKey, appSecret, 'ListarNFSEs', { nPagina: pag, nRegPorPagina: POR_PAGINA })
    const f = falha(resp)
    if (f) { r.erros.push(`pagina ${pag}: ${f}`); break }
    r.paginas++
    r.total_omie = Number(resp.nTotRegistros ?? resp.total_de_registros) || r.total_omie
    const lista = extrairLista(resp)
    if (!amostra && lista[0]) amostra = lista[0]
    r.lidas += lista.length

    if (!dry) {
      for (const item of lista as NfseOmie[]) {
        const m = mapearNfseOmie(item, { cnpj: emp.cnpj, razao: emp.razao_social ?? '', im: emp.inscricao_municipal ?? null })
        if (!m) { r.puladas++; continue }
        const { data: ja } = await supabaseAdmin
          .from('erp_nfse_emitidas')
          .select('id, xml_storage_path')
          .eq('company_id', companyId!)
          .eq('provider', 'omie')
          .eq('provider_reference', m.row.provider_reference)
          .maybeSingle()
        let xmlPath: string | null = ja?.xml_storage_path ?? null
        if (!xmlPath && m.xmlUrl) {
          const xml = await baixarXml(m.xmlUrl)
          if (xml) {
            const path = `${companyId}/nfse/omie/${m.row.provider_reference}.xml`
            const up = await supabaseAdmin.storage.from(BUCKET).upload(path, new Blob([xml], { type: 'application/xml' }), { contentType: 'application/xml', upsert: true })
            if (!up.error) { xmlPath = path; r.xml_ok++ } else r.erros.push(`xml ${m.row.provider_reference}: ${up.error.message}`)
          } else r.xml_sem++
        } else if (!xmlPath) r.xml_sem++
        const linha = { ...m.row, company_id: companyId, provider: 'omie', xml_storage_path: xmlPath }
        const { error } = ja
          ? await supabaseAdmin.from('erp_nfse_emitidas').update(linha).eq('id', ja.id)
          : await supabaseAdmin.from('erp_nfse_emitidas').insert(linha)
        if (error) r.erros.push(`nota ${m.row.provider_reference}: ${error.message}`)
        else if (ja) r.atualizadas++
        else r.inseridas++
      }
    }
    const totPag = Number(resp.nTotPaginas ?? resp.total_de_paginas) || 1
    if (pag >= totPag) { proxima = null; break }
    proxima = pag + 1
  }

  return NextResponse.json({ ok: r.erros.length === 0, dry_run: dry, ...r, proxima_pagina: proxima, amostra: dry ? amostra : undefined })
}
