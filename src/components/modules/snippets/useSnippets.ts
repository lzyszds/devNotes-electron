import { useCallback, useEffect, useMemo, useState } from 'react'

/** 一条代码片段 */
export interface Snippet {
  id: string
  title: string
  code: string
  /** 语言标识，仅用于展示 */
  language: string
  tags: string[]
  /** 收藏的排在前面 */
  starred?: boolean
  createdAt: number
  updatedAt: number
}

export const SNIPPETS_STORE_KEY = 'snippets-hub'

/** 片段里可以插的占位符，复制时提示用户替换 */
export const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g

export function createSnippetId(): string {
  return `snip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 内置片段。
 *
 * 只放那种「每次都要去搜一遍、搜到的那条还不一定对」的命令。首次打开就有
 * 内容可看，比一个空列表更能让人明白这个工具是干嘛的。
 */
export const BUILTIN_SNIPPETS: Omit<Snippet, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'builtin-docker-prune',
    title: 'Docker 全量清理（停用容器 / 悬空镜像 / 构建缓存）',
    code: `# 清掉停止的容器、未使用的网络、悬空镜像与构建缓存\n# -a 连未被引用的镜像一起清，危险但有效\ndocker system prune -a --volumes -f\n\n# 查看清理后还剩多少空间\ndocker system df`,
    language: 'bash',
    tags: ['docker', '清理'],
    starred: true,
  },
  {
    id: 'builtin-git-reset-hard',
    title: 'Git 回退到某次提交并强推（危险操作）',
    code: `# 依次确认三件事再执行：\n#   1. 目标提交确实是对的\n#   2. 已经 stash 或提交了手头要保留的改动\n#   3. 分支不是 master / main\ngit log --oneline -10\ngit reset --hard <commit>\ngit push --force-with-lease origin <branch>\n\n# 万一推错了，用 reflog 找回来\ngit reflog`,
    language: 'bash',
    tags: ['git', '危险'],
  },
  {
    id: 'builtin-nginx-proxy',
    title: 'Nginx 反向代理模板（含 WebSocket 与 SPA 回退）',
    code: `server {\n  listen 80;\n  server_name {{域名}};\n\n  location / {\n    proxy_pass http://127.0.0.1:{{后端端口}};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n\n    # WebSocket 升级必须显式放行，否则长连接会被拦成 400\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n\n    # 大文件上传 / 导出接口容易超时，按需调大\n    proxy_read_timeout 300s;\n  }\n}`,
    language: 'nginx',
    tags: ['nginx', '反代', '模板'],
    starred: true,
  },
  {
    id: 'builtin-ssh-tunnel',
    title: 'SSH 端口转发（本地连远端数据库）',
    code: `# -N 不执行远程命令，-f 后台运行，-L 本地转发\nssh -N -f -L 5433:127.0.0.1:5432 user@{{跳板机地址}}\n\n# 断开时按端口找回进程\nlsof -nP -iTCP:5433 -sTCP:LISTEN\nkill <pid>`,
    language: 'bash',
    tags: ['ssh', '隧道', '数据库'],
  },
  {
    id: 'builtin-curl-timing',
    title: 'curl 查看接口各阶段耗时',
    code: `curl -o /dev/null -s -w \\\n  'DNS:  %{time_namelookup}s\\nTCP:  %{time_connect}s\\nTLS:  %{time_appconnect}s\\nTTFB: %{time_starttransfer}s\\n总计: %{time_total}s\\n' \\\n  {{请求地址}}`,
    language: 'bash',
    tags: ['curl', '排障'],
  },
  {
    id: 'builtin-find-large-files',
    title: '找出磁盘里的大文件与占用目录',
    code: `# 当前目录下超过 100MB 的文件，按大小倒序\ndu -ah . 2>/dev/null | sort -rh | head -20\n\n# 一级子目录各自占用多少\ndu -sh ./* 2>/dev/null | sort -rh | head -20\n\n# macOS 上找系统里的大文件\nfind ~ -type f -size +500M -exec ls -lh {} \\; 2>/dev/null`,
    language: 'bash',
    tags: ['磁盘', '排障'],
  },
]

/** 校验一条从存储/导入文件里读回来的数据，形状不对就丢掉 */
function normalizeSnippet(raw: unknown): Snippet | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<Snippet>
  if (typeof item.code !== 'string') return null
  if (typeof item.id !== 'string' || !item.id) return null
  return {
    id: item.id,
    title: typeof item.title === 'string' ? item.title : '未命名片段',
    code: item.code,
    language: typeof item.language === 'string' ? item.language : 'bash',
    tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [],
    starred: Boolean(item.starred),
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
  }
}

/**
 * 片段库的数据层。
 *
 * 主区（SnippetsTool）与二级侧边栏（SnippetsSidebar）都要读写同一份数据，
 * 但它们是两棵互不相识的组件树 —— 靠 props 传会绕一大圈。
 * 用模块级的订阅把两份状态绑在一起：任何一处改动，另一处当场跟着刷新。
 */
type Listener = (snippets: Snippet[]) => void
const listeners = new Set<Listener>()
let cached: Snippet[] | null = null

function broadcast(next: Snippet[]) {
  cached = next
  listeners.forEach((listener) => listener(next))
}

async function persist(next: Snippet[]) {
  broadcast(next)
  await window.electronAPI?.storeSet(SNIPPETS_STORE_KEY, next).catch(() => {})
}

/** 首次读取。存储为空时播下内置片段 */
async function loadOnce(): Promise<Snippet[]> {
  if (cached) return cached
  const saved = await window.electronAPI?.storeGet(SNIPPETS_STORE_KEY).catch(() => null)
  if (Array.isArray(saved) && saved.length) {
    const clean = saved.map(normalizeSnippet).filter((item): item is Snippet => Boolean(item))
    broadcast(clean)
    return clean
  }
  const seeded = BUILTIN_SNIPPETS.map((item) => {
    const now = Date.now()
    return { ...item, createdAt: now, updatedAt: now } as Snippet
  })
  await persist(seeded)
  return seeded
}

export function useSnippets() {
  const [snippets, setSnippets] = useState<Snippet[]>(() => cached ?? [])
  const [loaded, setLoaded] = useState(() => Boolean(cached))

  useEffect(() => {
    let alive = true
    listeners.add(setSnippets)
    void loadOnce().then(() => {
      if (alive) setLoaded(true)
    })
    return () => {
      alive = false
      listeners.delete(setSnippets)
    }
  }, [])

  /** 整份替换。增删改都表达成一次替换，省得每处各写一遍持久化 */
  const replaceAll = useCallback(async (next: Snippet[]) => {
    await persist(next)
  }, [])

  const upsert = useCallback(
    async (draft: Snippet) => {
      const now = Date.now()
      const list = cached ?? []
      const exists = list.some((item) => item.id === draft.id)
      const next = exists
        ? list.map((item) => (item.id === draft.id ? { ...draft, updatedAt: now } : item))
        : [{ ...draft, id: draft.id || createSnippetId(), createdAt: now, updatedAt: now }, ...list]
      await persist(next)
      return next
    },
    [],
  )

  const remove = useCallback(
    async (id: string) => {
      await persist((cached ?? []).filter((item) => item.id !== id))
    },
    [],
  )

  const toggleStar = useCallback(
    async (id: string) => {
      await persist(
        (cached ?? []).map((item) => (item.id === id ? { ...item, starred: !item.starred } : item)),
      )
    },
    [],
  )

  /** 导入：按 id 去重合并，同 id 以导入的为准 */
  const importFrom = useCallback(async (raw: unknown) => {
    const incoming = Array.isArray(raw) ? raw : (raw as { snippets?: unknown })?.snippets
    if (!Array.isArray(incoming)) throw new Error('格式不对')
    const byId = new Map((cached ?? []).map((item) => [item.id, item]))
    let added = 0
    for (const item of incoming) {
      const snippet = normalizeSnippet(item)
      if (!snippet) continue
      if (!byId.has(snippet.id)) added++
      byId.set(snippet.id, snippet)
    }
    await persist(Array.from(byId.values()))
    return { added }
  }, [])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    snippets.forEach((item) => item.tags.forEach((tag) => set.add(tag)))
    return ['全部', ...Array.from(set).sort()]
  }, [snippets])

  return { snippets, loaded, allTags, replaceAll, upsert, remove, toggleStar, importFrom }
}

/** 过滤与排序：收藏在前，其后按更新时间倒序 */
export function filterSnippets(
  snippets: Snippet[],
  keyword: string,
  activeTag: string,
): Snippet[] {
  const query = keyword.trim().toLowerCase()
  return snippets
    .filter((item) => activeTag === '全部' || item.tags.includes(activeTag))
    .filter((item) => {
      if (!query) return true
      // 搜索覆盖标题、正文与标签 —— 记命令时往往只记得「里面有 --force」
      return (
        item.title.toLowerCase().includes(query) ||
        item.code.toLowerCase().includes(query) ||
        item.tags.some((tag) => tag.toLowerCase().includes(query))
      )
    })
    .sort((a, b) => {
      if (Boolean(a.starred) !== Boolean(b.starred)) return a.starred ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
}
