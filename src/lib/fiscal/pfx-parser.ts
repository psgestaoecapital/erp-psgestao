import forge from 'node-forge'

export interface PfxParsedInfo {
  cnpj: string
  razaoSocial: string
  validadeInicio: Date
  validadeFim: Date
  thumbprint: string
}

export async function parsePfxFile(file: File, senha: string): Promise<PfxParsedInfo> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const binary = forge.util.binary.raw.encode(bytes)
  const asn1 = forge.asn1.fromDer(binary)

  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha)
  } catch {
    throw new Error('Senha do certificado inválida ou arquivo corrompido')
  }

  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBag = bags[forge.pki.oids.certBag]?.[0]
  if (!certBag?.cert) {
    throw new Error('Certificado não encontrado no arquivo .pfx')
  }

  const cert = certBag.cert

  let cnpj = ''
  let razaoSocial = ''

  for (const attr of cert.subject.attributes) {
    if (attr.shortName === 'CN' || attr.name === 'commonName') {
      const cn = String(attr.value)
      const match = cn.match(/:(\d{14})$/)
      if (match) {
        cnpj = match[1]
        razaoSocial = cn.replace(/:\d{14}$/, '').trim()
      } else {
        razaoSocial = cn.trim()
      }
    }
  }

  if (!cnpj) {
    const altExt = cert.getExtension('subjectAltName')
    if (altExt && 'altNames' in altExt) {
      for (const alt of (altExt as { altNames: Array<{ value?: unknown }> }).altNames) {
        const valueStr = String(alt.value ?? '')
        const m = valueStr.match(/(\d{14})/)
        if (m) {
          cnpj = m[1]
          break
        }
      }
    }
  }

  if (!cnpj) {
    throw new Error('Não foi possível extrair o CNPJ do certificado — arquivo inválido?')
  }

  const md = forge.md.sha256.create()
  md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
  const thumbprint = md.digest().toHex()

  return {
    cnpj,
    razaoSocial,
    validadeInicio: cert.validity.notBefore,
    validadeFim: cert.validity.notAfter,
    thumbprint,
  }
}
