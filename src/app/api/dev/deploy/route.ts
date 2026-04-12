import { NextRequest, NextResponse } from 'next/server';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const REPO = 'psgestaoecapital/erp-psgestao';
const BRANCH = 'main';

export async function POST(req: NextRequest) {
  try {
    const { path, content, message } = await req.json();
    if (!path || !content) return NextResponse.json({ error: 'path e content obrigatorios' }, { status: 400 });

    // Get current SHA if file exists
    let sha: string | null = null;
    try {
      const getRes = await fetch(
        `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
        { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'PS-Gestao-ERP' } }
      );
      if (getRes.ok) {
        const getData = await getRes.json();
        sha = getData.sha;
      }
    } catch (e) {}

    // Deploy file
    const body: any = {
      message: message || 'Deploy via Dev Module: ' + path,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch: BRANCH
    };
    if (sha) body.sha = sha;

    const res = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'PS-Gestao-ERP'
        },
        body: JSON.stringify(body)
      }
    );

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({ 
        success: true, 
        path, 
        sha: data.content?.sha,
        commit: data.commit?.sha?.substring(0, 7),
        message: 'Arquivo deployado com sucesso'
      });
    } else {
      const err = await res.json();
      return NextResponse.json({ error: err.message || 'Falha no deploy' }, { status: res.status });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}

// GET: list files in a directory
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path') || 'src/app';

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
      { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'PS-Gestao-ERP' } }
    );
    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ error: err.message }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(Array.isArray(data) ? data.map((f: any) => ({ name: f.name, path: f.path, type: f.type, size: f.size, sha: f.sha })) : data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
