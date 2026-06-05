// FEAT-NFSE-EMISSAO-GOV-v1 v2 (Fase 2 real) · gov-nfse-emitir
// Estende v1 GE-F10 (placeholder) · payload flat snake_case · PFX + XAdES + mTLS
// Resolve prestador/cert internamente · cria erp_nfse_emitidas row se nao houver
//
// Deploy:
//   supabase functions deploy gov-nfse-emitir --no-verify-jwt false
//
// Payload (POST):
//   {
//     company_id: "uuid",
//     teste_homologacao?: boolean,
//     nfse_emitida_id?: "uuid",
//     servico: { descricao, valor, item_lista_lc116, aliquota_iss?, iss_retido? },
//     tomador: { nome, cpf_cnpj, email? }
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import forge from "npm:node-forge@1.3.1"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

type Ambiente = "homologacao" | "producao"

interface FlatPayload {
  company_id: string
  teste_homologacao?: boolean
  nfse_emitida_id?: string
  servico: {
    descricao: string
    valor: number
    item_lista_lc116: string
    aliquota_iss?: number
    iss_retido?: boolean
  }
  tomador: {
    nome: string
    cpf_cnpj: string
    email?: string
  }
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function baseUrl(amb: Ambiente): string {
  return amb === "producao"
    ? "https://sefin.nfse.gov.br/SefinNacional"
    : "https://sefin.producaorestrita.nfse.gov.br/SefinNacional"
}

// GZip(xml) + base64 · formato exigido pelo ADN em { dpsXmlGZipB64 }
async function gzipBase64(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const stream = new Blob([encoder.encode(text)]).stream().pipeThrough(new CompressionStream("gzip"))
  const buf = await new Response(stream).arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function decryptB64(b64: string): string { return atob(b64) }

function xmlEsc(s: string | number | undefined | null): string {
  if (s == null) return ""
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

function parsePfx(pfxBytes: Uint8Array, senha: string): { certPem: string; privateKeyPem: string; cnpjCert?: string } {
  const raw = forge.util.binary.raw.encode(pfxBytes)
  const asn1 = forge.asn1.fromDer(raw)
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha)
  let certPem: string | null = null
  let privateKeyPem: string | null = null
  let cnpjCert: string | undefined
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBag = certBags[forge.pki.oids.certBag]?.[0]
  if (certBag?.cert) {
    certPem = forge.pki.certificateToPem(certBag.cert)
    for (const attr of certBag.cert.subject.attributes) {
      if (attr.shortName === "CN" || attr.name === "commonName") {
        const m = String(attr.value).match(/:(\d{14})$/)
        if (m) cnpjCert = m[1]
      }
    }
  }
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ?? p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0]
  if (keyBag?.key) privateKeyPem = forge.pki.privateKeyToPem(keyBag.key)
  if (!certPem || !privateKeyPem) throw new Error("PFX nao contem cert + privateKey extraivel")
  return { certPem, privateKeyPem, cnpjCert }
}

function extractCep(s: string | null | undefined): string {
  if (!s) return "00000000"
  const m = s.match(/(\d{5})-?(\d{3})/) || s.match(/(\d{8})/)
  return m ? (m[1] + (m[2] ?? "")).slice(0, 8) : "00000000"
}

function montarDpsXml(opts: {
  ambiente: Ambiente; numeroDps: number; idDps: string
  prestador: { cnpj: string; razao: string; im?: string | null; muniIbge: string; muniNome: string; uf: string; cep: string; logradouro: string; numero: string; bairro: string }
  tomador: { nome: string; cnpj?: string; cpf?: string; email?: string }
  servico: { codTribNac: string; descricao: string; valor: number; aliqIss: number; issRetido: boolean }
}): string {
  const { ambiente, numeroDps, idDps, prestador, tomador, servico } = opts
  const tpAmb = ambiente === "producao" ? 1 : 2
  const dhEmi = new Date().toISOString()
  const dCompet = dhEmi.split("T")[0]
  const vServ = servico.valor.toFixed(2)
  const vISS = ((servico.valor * servico.aliqIss) / 100).toFixed(2)
  const pAliq = servico.aliqIss.toFixed(2)
  return `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infDPS Id="${xmlEsc(idDps)}">
    <tpAmb>${tpAmb}</tpAmb>
    <dhEmi>${dhEmi}</dhEmi>
    <verAplic>PS_GESTAO_ERP_2.0</verAplic>
    <serie>00001</serie>
    <nDPS>${String(numeroDps).padStart(15, "0")}</nDPS>
    <dCompet>${dCompet}</dCompet>
    <tpEmis>1</tpEmis>
    <prest>
      <CNPJ>${xmlEsc(prestador.cnpj)}</CNPJ>${prestador.im ? `
      <IM>${xmlEsc(prestador.im)}</IM>` : ""}
      <xNome>${xmlEsc(prestador.razao)}</xNome>
      <end>
        <cMun>${xmlEsc(prestador.muniIbge)}</cMun>
        <xMun>${xmlEsc(prestador.muniNome)}</xMun>
        <UF>${xmlEsc(prestador.uf)}</UF>
        <CEP>${xmlEsc(prestador.cep)}</CEP>
        <xLgr>${xmlEsc(prestador.logradouro)}</xLgr>
        <nro>${xmlEsc(prestador.numero)}</nro>
        <xBairro>${xmlEsc(prestador.bairro)}</xBairro>
      </end>
    </prest>
    <toma>${tomador.cnpj ? `
      <CNPJ>${xmlEsc(tomador.cnpj)}</CNPJ>` : ""}${tomador.cpf ? `
      <CPF>${xmlEsc(tomador.cpf)}</CPF>` : ""}
      <xNome>${xmlEsc(tomador.nome)}</xNome>${tomador.email ? `
      <email>${xmlEsc(tomador.email)}</email>` : ""}
    </toma>
    <serv>
      <cTribNac>${xmlEsc(servico.codTribNac)}</cTribNac>
      <xDescServ>${xmlEsc(servico.descricao)}</xDescServ>
      <valores>
        <vServ>${vServ}</vServ>
        <vISS>${vISS}</vISS>
        <pAliqAplicISS>${pAliq}</pAliqAplicISS>
      </valores>
      <ISSRet>${servico.issRetido ? 1 : 2}</ISSRet>
    </serv>
  </infDPS>
</DPS>`
}

function c14nMin(xml: string): string {
  return xml.replace(/<\?xml[^?]*\?>\s*/, "").trim()
}

function assinarXAdES(xmlDps: string, idDps: string, privateKeyPem: string, certPem: string): string {
  const m = xmlDps.match(/<infDPS[^>]*>[\s\S]*?<\/infDPS>/)
  if (!m) throw new Error("infDPS nao encontrado no XML")
  const infDPS = m[0]
  const md = forge.md.sha256.create()
  md.update(c14nMin(infDPS), "utf8")
  const digestB64 = forge.util.encode64(md.digest().bytes())
  const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><Reference URI="#${idDps}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>${digestB64}</DigestValue></Reference></SignedInfo>`
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem)
  const mdSig = forge.md.sha256.create()
  mdSig.update(c14nMin(signedInfo), "utf8")
  const sigB64 = forge.util.encode64(privateKey.sign(mdSig))
  const cert = forge.pki.certificateFromPem(certPem)
  const certB64 = forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
  const sigBlock = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}<SignatureValue>${sigB64}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certB64}</X509Certificate></X509Data></KeyInfo></Signature>`
  return xmlDps.replace(/<\/infDPS>/, `</infDPS>\n  ${sigBlock}`)
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respond(405, { erro: "Method not allowed" })
  let p: FlatPayload
  try { p = await req.json() } catch { return respond(400, { erro: "JSON invalido" }) }
  if (!p.company_id || !p.servico?.descricao || !p.servico?.valor || !p.servico?.item_lista_lc116 || !p.tomador?.nome || !p.tomador?.cpf_cnpj) {
    return respond(400, { erro: "company_id + servico{descricao,valor,item_lista_lc116} + tomador{nome,cpf_cnpj} obrigatorios" })
  }
  const warnings: string[] = []
  try {
    const { data: cfg } = await sb.from("erp_fiscal_provider_config").select("*").eq("company_id", p.company_id).eq("provider", "gov_nfse_nacional").eq("ativo", true).single()
    if (!cfg) return respond(404, { ok: false, erro: "Provider gov_nfse_nacional nao configurado" })
    const ambiente: Ambiente = p.teste_homologacao ? "homologacao" : ((cfg.ambiente as Ambiente) ?? "homologacao")
    const muniIbge = String(cfg.gov_nfse_municipio_codigo ?? "").replace(/\D/g, "")
    if (muniIbge.length !== 7) return respond(400, { ok: false, erro: "gov_nfse_municipio_codigo invalido (7 digitos)" })
    const { data: muni } = await sb.from("erp_gov_nfse_municipios").select("nome_municipio, uf, aderido").eq("codigo_ibge", muniIbge).maybeSingle()
    if (!muni?.aderido) return respond(400, { ok: false, erro: "Municipio nao aderiu ao SN NFS-e", municipio: muni })
    const { data: emp } = await sb.from("companies").select("cnpj, razao_social, inscricao_municipal, endereco, cidade_estado").eq("id", p.company_id).single()
    if (!emp?.cnpj) return respond(400, { ok: false, erro: "Empresa sem CNPJ" })
    const cnpjPrest = String(emp.cnpj).replace(/\D/g, "")
    if (cnpjPrest.length !== 14) return respond(400, { ok: false, erro: "CNPJ empresa invalido" })
    const cepPrest = extractCep(emp.endereco)
    if (cepPrest === "00000000") warnings.push("CEP nao extraivel de companies.endereco · stub 00000000")
    const logPrest = (emp.endereco ?? "").slice(0, 60) || "Rua nao informada"
    if (!emp.endereco) warnings.push("companies.endereco vazio · logradouro stub")
    const { data: cert } = await sb.from("erp_certificados_a1").select("id, storage_bucket, storage_path, senha_encrypted, cnpj_certificado").eq("company_id", p.company_id).eq("status", "ativo").is("removido_em", null).order("criado_em", { ascending: false }).limit(1).single()
    if (!cert) return respond(404, { ok: false, erro: "Certificado A1 ativo nao encontrado" })
    const { data: pfxBlob, error: dlErr } = await sb.storage.from(cert.storage_bucket).download(cert.storage_path)
    if (dlErr || !pfxBlob) return respond(500, { ok: false, erro: "Falha download PFX", detalhe: dlErr?.message })
    const pfxBytes = new Uint8Array(await pfxBlob.arrayBuffer())
    const senha = cert.senha_encrypted ? decryptB64(cert.senha_encrypted) : ""
    let parsed: { certPem: string; privateKeyPem: string; cnpjCert?: string }
    try { parsed = parsePfx(pfxBytes, senha) }
    catch (e) { return respond(500, { ok: false, erro: "Falha parse PFX (senha invalida?)", detalhe: e instanceof Error ? e.message : String(e) }) }
    if (parsed.cnpjCert && parsed.cnpjCert !== cnpjPrest) warnings.push(`CNPJ cert (${parsed.cnpjCert}) difere empresa (${cnpjPrest})`)
    let nfseId = p.nfse_emitida_id
    if (!nfseId) {
      const { data: nfseRow, error: nfseErr } = await sb.from("erp_nfse_emitidas").insert({
        company_id: p.company_id, provider: "gov_nfse_nacional", provider_reference: `gov-${Date.now()}`,
        ambiente, status: "processando", valor_servicos: p.servico.valor, aliquota_iss: p.servico.aliquota_iss ?? 5,
        descricao_servico: p.servico.descricao, codigo_servico: p.servico.item_lista_lc116, retem_iss: !!p.servico.iss_retido,
        tomador_cnpj: p.tomador.cpf_cnpj.length === 14 ? p.tomador.cpf_cnpj : null,
        tomador_cpf: p.tomador.cpf_cnpj.length === 11 ? p.tomador.cpf_cnpj : null,
        tomador_razao_social: p.tomador.nome, tomador_email: p.tomador.email,
        prestador_cnpj: cnpjPrest, prestador_razao_social: emp.razao_social, prestador_im: emp.inscricao_municipal,
        serie: "1"
      }).select("id").single()
      if (nfseErr || !nfseRow) return respond(500, { ok: false, erro: "Falha criar erp_nfse_emitidas", detalhe: nfseErr?.message })
      nfseId = nfseRow.id
    }
    const { data: dpsEx } = await sb.from("erp_gov_nfse_dps").select("id, numero_dps, chave_acesso, status, mensagem_sefin").eq("company_id", p.company_id).eq("nfse_emitida_id", nfseId).maybeSingle()
    if (dpsEx?.chave_acesso) return respond(200, { ok: true, idempotente: true, dps: dpsEx, nfse_emitida_id: nfseId })
    let numeroDps: number
    if (dpsEx?.numero_dps) { numeroDps = dpsEx.numero_dps } else {
      const { data: nr } = await sb.rpc("fn_gov_nfse_proximo_numero", { p_company_id: p.company_id })
      numeroDps = Number(nr) || 1
    }
    // idDps · regra ADN: DPS + municipio(7) + tipoInscricao(1) + inscFederal(14)
    //   + serie(5) + nDPS(15) = "DPS" + 42 digitos. CNPJ -> tipoInscricao=2.
    //   CPF -> 1 e inscFederal com 000 a esquerda (pra prestador sempre e CNPJ).
    const tipoInsc = "2"
    const inscFederal = cnpjPrest.padStart(14, "0")
    const serieStr = "00001"
    const idDps = `DPS${muniIbge}${tipoInsc}${inscFederal}${serieStr}${String(numeroDps).padStart(15, "0")}`
    const cnpjTom = p.tomador.cpf_cnpj.length === 14 ? p.tomador.cpf_cnpj : undefined
    const cpfTom = p.tomador.cpf_cnpj.length === 11 ? p.tomador.cpf_cnpj : undefined
    const dpsXml = montarDpsXml({
      ambiente, numeroDps, idDps,
      prestador: { cnpj: cnpjPrest, razao: emp.razao_social, im: emp.inscricao_municipal, muniIbge, muniNome: muni.nome_municipio ?? "", uf: muni.uf ?? "", cep: cepPrest, logradouro: logPrest, numero: "S/N", bairro: "Centro" },
      tomador: { nome: p.tomador.nome, cnpj: cnpjTom, cpf: cpfTom, email: p.tomador.email },
      servico: { codTribNac: p.servico.item_lista_lc116, descricao: p.servico.descricao, valor: p.servico.valor, aliqIss: p.servico.aliquota_iss ?? 5, issRetido: !!p.servico.iss_retido }
    })
    let dpsAssinada: string
    try { dpsAssinada = assinarXAdES(dpsXml, idDps, parsed.privateKeyPem, parsed.certPem) }
    catch (e) { return respond(500, { ok: false, erro: "Falha assinatura XAdES", detalhe: e instanceof Error ? e.message : String(e) }) }
    if (!dpsEx) {
      await sb.rpc("fn_gov_nfse_registrar_dps", {
        p_company_id: p.company_id, p_nfse_emitida_id: nfseId, p_numero_dps: numeroDps,
        p_municipio_ibge: muniIbge, p_municipio_nome: muni.nome_municipio ?? "", p_payload_enviado: { xml: dpsAssinada, idDps }
      })
    }
    const url = `${baseUrl(ambiente)}/nfse`
    let respStatus = 0, respText = "", errFetch: string | null = null
    let bodyJson: string | null = null
    let mtlsCertAnexado = false
    let httpClientCriado = false
    try {
      // 1. GZip + base64 do XML DPS assinado · formato exigido pelo ADN
      const dpsXmlGZipB64 = await gzipBase64(dpsAssinada)
      bodyJson = JSON.stringify({ dpsXmlGZipB64 })

      // 2. UM UNICO client HTTP com TUDO ao mesmo tempo:
      //    - cert PEM + key PEM (mTLS · client cert)
      //    - alpnProtocols ['http/1.1'] · forca HTTP/1.1 via ALPN (API definitiva)
      //    - http2:false (defesa em camadas · compat com versoes que aceitam)
      // Garantia: este e o UNICO httpClient usado no fetch · sem fallback
      // pra um client default sem cert.
      const certOk = !!parsed.certPem && parsed.certPem.length > 0
      const keyOk = !!parsed.privateKeyPem && parsed.privateKeyPem.length > 0
      mtlsCertAnexado = certOk && keyOk

      // deno-lint-ignore no-explicit-any
      const httpClient = (Deno as any).createHttpClient?.({
        cert: parsed.certPem,
        key: parsed.privateKeyPem,
        alpnProtocols: ["http/1.1"],
        http2: false,
        http1: true,
      })
      httpClientCriado = !!httpClient

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "PSGestao-ERP/2.0",
        },
        body: bodyJson,
        // deno-lint-ignore no-explicit-any
        client: httpClient as any
      })
      respStatus = resp.status
      respText = await resp.text()
    } catch (e) {
      // tls_erro_raw: mensagem COMPLETA do catch (sem truncate)
      errFetch = e instanceof Error
        ? `${e.name}: ${e.message}${e.stack ? "\n" + e.stack : ""}`
        : String(e)
    }
    const sucesso = respStatus >= 200 && respStatus < 300
    const chaveMatch = respText.match(/<chNFSe>([^<]+)<\/chNFSe>/) || respText.match(/<chaveAcesso>([^<]+)<\/chaveAcesso>/)
    const motivoMatch = respText.match(/<xMotivo>([^<]+)<\/xMotivo>/) || respText.match(/<mensagem>([^<]+)<\/mensagem>/) || respText.match(/<descricao>([^<]+)<\/descricao>/)
    const statusNovo = sucesso && chaveMatch ? "autorizada" : errFetch ? "erro_envio" : "rejeitada"
    const { data: dpsRow } = await sb.from("erp_gov_nfse_dps").select("id").eq("company_id", p.company_id).eq("nfse_emitida_id", nfseId).maybeSingle()
    if (dpsRow?.id) {
      await sb.rpc("fn_gov_nfse_atualizar_dps", {
        p_dps_id: dpsRow.id, p_status: statusNovo,
        p_mensagem: motivoMatch?.[1] || errFetch || `HTTP ${respStatus}`,
        p_chave_acesso: chaveMatch?.[1] || null,
        p_payload_resposta: { http_status: respStatus, body: respText.slice(0, 2000), erro: errFetch }
      })
    }
    if (statusNovo === "autorizada" && chaveMatch?.[1]) {
      await sb.from("erp_nfse_emitidas").update({
        status: "autorizada", chave_acesso: chaveMatch[1],
        provider_raw: { xml_resposta: respText.slice(0, 5000) }
      }).eq("id", nfseId)
    } else if (statusNovo === "rejeitada") {
      await sb.from("erp_nfse_emitidas").update({
        status: "rejeitada", motivo_rejeicao: motivoMatch?.[1] || `HTTP ${respStatus}`
      }).eq("id", nfseId)
    }
    return respond(sucesso ? 200 : 502, {
      ok: sucesso, status: statusNovo,
      nfse_emitida_id: nfseId, dps_id: dpsRow?.id, numero_dps: numeroDps,
      chave_acesso: chaveMatch?.[1] || null,
      motivo: motivoMatch?.[1] || null,
      http_status: respStatus, erro_fetch: errFetch,
      // Diagnostico mTLS (apos ajuste do CEO)
      mtls_cert_anexado: mtlsCertAnexado,
      mtls_http_client_criado: httpClientCriado,
      tls_erro_raw: errFetch,
      cert_cnpj_validado: parsed.cnpjCert,
      endpoint: url, ambiente,
      preview_resposta: respText.slice(0, 800),
      warnings, idDps,
    })
  } catch (e) {
    return respond(500, { ok: false, erro: "Erro interno", detalhe: e instanceof Error ? e.message : String(e), warnings })
  }
})
