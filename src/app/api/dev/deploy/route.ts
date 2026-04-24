import { NextRequest, NextResponse } from 'next/server';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const REPO = 'psgestaoecapital/erp-psgestao';
const BRANCH = 'main';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // === MODO BATCH: { files: [{path, content}, ...], message? } ===
    if (Array.isArray(body.files) && body.files.length > 0) {
      const results = await deployBatch(body.files, body.message);
      return NextResponse.json(results, { headers: corsHeaders });
    }

    // === MODO LEGADO: { path, content, message? } ===
    const { path, content, message } = body;
    if (!path || !content) {
      return NextResponse.json(
        { error: 'path e content obrigatorios (ou use files: [])' },
        { status: 400, headers: corsHeaders }
      );
    }
    const result = await deploySingleFile(path, content, message);
    return NextResponse.json(result, { status: result.success ? 200 : 500, headers: corsHeaders });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Erro interno' },
      { status: 500, headers: corsHeaders }
    );
  }
}

async function deploySingleFile(path: string, content: string, message?: string) {
  let sha: string | null = null;
  try {
    const getRes = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'PS-Gestao-ERP' } }
    );
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
    }
  } catch (e) {}

  const body: any = {
    message: message || 'Deploy via Dev Module: ' + path,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    branch: BRANCH
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'PS-Gestao-ERP'
    },
    body: JSON.stringify(body)
  });

  if (res.ok) {
    const data = await res.json();
    return {
      success: true,
      path,
      sha: data.content?.sha,
      commit: data.commit?.sha?.substring(0, 7),
      message: 'Arquivo deployado com sucesso'
    };
  } else {
    const err = await res.json();
    return { success: false, path, error: err.message || 'Falha no deploy' };
  }
}

async function deployBatch(files: Array<{ path: string; content: string }>, message?: string) {
  const githubHeaders = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'PS-Gestao-ERP'
  };

  const refRes = await fetch(
    `https://api.github.com/repos/${REPO}/git/ref/heads/${BRANCH}`,
    { headers: githubHeaders }
  );
  if (!refRes.ok) {
    const txt = await refRes.text();
    return { success: false, error: 'Erro ao buscar ref', detail: txt };
  }
  const ref = await refRes.json();
  const latestCommitSha = ref.object.sha;

  const commitRes = await fetch(
    `https://api.github.com/repos/${REPO}/git/commits/${latestCommitSha}`,
    { headers: githubHeaders }
  );
  const commit = await commitRes.json();
  const baseTreeSha = commit.tree.sha;

  const blobs = await Promise.all(
    files.map(async f => {
      const blobRes = await fetch(`https://api.github.com/repos/${REPO}/git/blobs`, {
        method: 'POST',
        headers: githubHeaders,
        body: JSON.stringify({
          content: Buffer.from(f.content, 'utf-8').toString('base64'),
          encoding: 'base64'
        })
      });
      const blob = await blobRes.json();
      return { path: f.path, sha: blob.sha, mode: '100644' as const, type: 'blob' as const };
    })
  );

  const treeRes = await fetch(`https://api.github.com/repos/${REPO}/git/trees`, {
    method: 'POST',
    headers: githubHeaders,
    body: JSON.stringify({ base_tree: baseTreeSha, tree: blobs })
  });
  const tree = await treeRes.json();

  const newCommitRes = await fetch(`https://api.github.com/repos/${REPO}/git/commits`, {
    method: 'POST',
    headers: githubHeaders,
    body: JSON.stringify({
      message: message || `deploy batch: ${files.length} arquivo(s)`,
      tree: tree.sha,
      parents: [latestCommitSha]
    })
  });
  const newCommit = await newCommitRes.json();

  await fetch(`https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    headers: githubHeaders,
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });

  return {
    success: true,
    mode: 'batch',
    files_count: files.length,
    commit: newCommit.sha.substring(0, 7),
    url: `https://github.com/${REPO}/commit/${newCommit.sha}`,
    message: 'Deploy batch enviado. Vercel vai processar em ~60s.'
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path') || 'src/app';
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'PS-Gestao-ERP' } }
    );
    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ error: err.message }, { status: res.status, headers: corsHeaders });
    }
    const data = await res.json();
    return NextResponse.json(
      Array.isArray(data)
        ? data.map((f: any) => ({ name: f.name, path: f.path, type: f.type, size: f.size, sha: f.sha }))
        : data,
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
}
