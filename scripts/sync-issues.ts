import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IssueArchiveIndex, IssueMindmapFile, IssueNode } from "../src/types";

const outputDir = path.resolve("public/data/issues");
const indexPath = path.join(outputDir, "index.json");
const today = process.env.ISSUE_DATE || currentKstDate();
const naverClientId = process.env.NAVER_CLIENT_ID;
const naverClientSecret = process.env.NAVER_CLIENT_SECRET;
const groqApiKey = process.env.GROQ_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const cohereApiKey = process.env.COHERE_API_KEY;
const groqModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const issueLimit = readPositiveInt(process.env.ISSUE_CANDIDATE_LIMIT, 36);
const queryDisplay = readPositiveInt(process.env.NAVER_NEWS_DISPLAY, 40);
const archiveLimit = readPositiveInt(process.env.ISSUE_ARCHIVE_LIMIT, 30);

const excludedCategoryPattern = /연예|스포츠|야구|축구|농구|배구|골프|올림픽|월드컵|아이돌|배우|가수|드라마|영화|예능|음원|콘서트/;
const seedQueries = [
  "정치",
  "경제",
  "사회",
  "외교",
  "안보",
  "노동",
  "주거",
  "교육",
  "의료",
  "산업",
  "기후",
  "재난",
  "과학기술",
  "법안"
];

async function main() {
  await mkdir(outputDir, { recursive: true });

  const articles = await collectArticles();
  const ranked = await rankArticles(articles);
  const selected = ranked.slice(0, issueLimit);
  const generated = await generateMindmap(selected);
  const mindmap = normalizeMindmap(generated, selected);

  await writeIssueMindmap(mindmap);
  await updateArchiveIndex(mindmap);
  console.log(`Saved ${mindmap.title} with ${countLeafNodes(mindmap.root)} leaf nodes.`);
}

async function collectArticles(): Promise<NewsArticle[]> {
  const collected: NewsArticle[] = [];

  if (naverClientId && naverClientSecret) {
    for (const query of seedQueries) {
      try {
        const rows = await fetchNaverNews(query);
        collected.push(...rows);
        console.log(`Naver news ${query}: ${rows.length}`);
      } catch (error) {
        console.warn(`Naver news failed: ${query} - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else {
    console.warn("NAVER_CLIENT_ID or NAVER_CLIENT_SECRET is not set. Skipping Naver news.");
  }

  const rssUrls = (process.env.ISSUE_RSS_URLS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const rssUrl of rssUrls) {
    try {
      const rows = await fetchRss(rssUrl);
      collected.push(...rows);
      console.log(`RSS ${rssUrl}: ${rows.length}`);
    } catch (error) {
      console.warn(`RSS failed: ${rssUrl} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const deduped = dedupeArticles(collected)
    .filter((article) => isTodayArticle(article.pubDate))
    .filter((article) => !excludedCategoryPattern.test(`${article.title} ${article.description}`))
    .filter((article) => article.title.length >= 8);

  console.log(`Collected ${collected.length}, deduped today candidates ${deduped.length}.`);
  return deduped;
}

async function fetchNaverNews(query: string): Promise<NewsArticle[]> {
  const url = new URL("https://openapi.naver.com/v1/search/news.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(Math.min(100, queryDisplay)));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "date");

  const response = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": naverClientId ?? "",
      "X-Naver-Client-Secret": naverClientSecret ?? ""
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 180)}`);
  }

  const payload = (await response.json()) as NaverNewsResponse;
  return (payload.items ?? []).map((item) => ({
    title: cleanText(item.title),
    description: cleanText(item.description),
    url: item.originallink || item.link,
    portalUrl: item.link,
    source: readHostname(item.originallink || item.link),
    pubDate: item.pubDate,
    query
  }));
}

async function fetchRss(url: string): Promise<NewsArticle[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const item = match[0];
    const link = readXmlTag(item, "link");
    return {
      title: cleanText(readXmlTag(item, "title")),
      description: cleanText(readXmlTag(item, "description")),
      url: link,
      source: readHostname(link),
      pubDate: readXmlTag(item, "pubDate") || readXmlTag(item, "dc:date"),
      query: "rss"
    };
  });
}

async function rankArticles(articles: NewsArticle[]): Promise<NewsArticle[]> {
  const heuristicRanked = scoreArticles(articles);
  if (!cohereApiKey || heuristicRanked.length === 0) return heuristicRanked;

  try {
    const top = heuristicRanked.slice(0, 120);
    const response = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cohereApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.COHERE_RERANK_MODEL || "rerank-v3.5",
        query: "오늘 한국 사회의 공공 의사결정과 생활에 영향이 큰 정치 경제 사회 시사 이슈",
        documents: top.map((article) => `${article.title}\n${article.description}`),
        top_n: Math.min(issueLimit, top.length)
      })
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 180)}`);
    const payload = (await response.json()) as CohereRerankResponse;
    const reranked = (payload.results ?? [])
      .map((result) => top[result.index])
      .filter((article): article is NewsArticle => Boolean(article));
    return mergeArticleOrder(reranked, heuristicRanked);
  } catch (error) {
    console.warn(`Cohere rerank failed. Falling back to heuristic ranking: ${error instanceof Error ? error.message : String(error)}`);
    return heuristicRanked;
  }
}

async function generateMindmap(articles: NewsArticle[]): Promise<Partial<IssueMindmapFile>> {
  if (articles.length === 0) return buildFallbackMindmap(articles);
  const prompt = buildIssuePrompt(articles);

  if (groqApiKey) {
    try {
      return parseJsonObject(await generateWithGroq(prompt));
    } catch (error) {
      console.warn(`Groq issue generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (geminiApiKey) {
    try {
      return parseJsonObject(await generateWithGemini(prompt));
    } catch (error) {
      console.warn(`Gemini issue generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.warn("No issue-generation model succeeded. Writing heuristic fallback mindmap.");
  return buildFallbackMindmap(articles);
}

async function generateWithGroq(prompt: string): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: groqModel,
      messages: [
        { role: "system", content: "You output strict JSON only. No Markdown." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_completion_tokens: 2400,
      response_format: { type: "json_object" }
    })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 220)}`);
  const payload = (await response.json()) as GroqChatResponse;
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned an empty response.");
  return text;
}

async function generateWithGemini(prompt: string): Promise<string> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": geminiApiKey ?? ""
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2400,
        responseMimeType: "application/json"
      }
    })
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 220)}`);
  const payload = (await response.json()) as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n").trim();
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

function buildIssuePrompt(articles: NewsArticle[]) {
  const articleLines = articles.map((article, index) => (
    [
      `ID: a${index + 1}`,
      `title: ${article.title}`,
      `summary: ${truncate(article.description, 140)}`,
      `source: ${article.source}`,
      `url: ${article.url}`,
      `published: ${article.pubDate}`
    ].join("\n")
  ));

  return [
    "너는 한국 시사 이슈를 구조화하는 편집 보조 엔진이다.",
    "연예와 스포츠 뉴스는 절대 주요 이슈로 선정하지 마라.",
    "오늘 한국 사회의 공공 영향도, 진행성, 출처 교차 확인 가능성, 시의성, 구조화 가능성을 기준으로 주요 이슈 3개를 선정해라.",
    "마인드맵은 반드시 4단계로 만들어라: root -> 대분류 이슈 -> 주제 노드 -> 세부 쟁점 최종 노드.",
    "대분류 이슈는 정확히 3개를 둬라.",
    "각 대분류 이슈 아래에는 주제 노드를 1~2개 둬라.",
    "각 주제 노드 아래에는 세부 쟁점 최종 노드를 2~3개 둬라.",
    "articles 배열은 세부 쟁점 최종 노드에만 둬라.",
    "각 최종 노드에는 아래 기사 후보에서 관련도 높은 기사 정확히 3개를 골라 articles 배열에 넣어라.",
    "기사 제목과 URL은 후보에 있는 값을 그대로 사용해라. 없는 기사나 URL을 만들지 마라.",
    "출력은 아래 TypeScript 구조와 호환되는 JSON 객체 하나만 반환해라.",
    "",
    "필수 구조:",
    JSON.stringify({
      serviceName: "시선(時線)",
      date: today,
      generatedAt: "ISO_DATETIME",
      title: "YYYY년 MM월 DD일의 시사 이슈 마인드맵",
      editorialPolicy: {
        excludedCategories: ["entertainment", "sports"],
        selectionCriteria: ["공공 영향도", "진행성", "출처 교차 확인 가능성", "시의성", "구조화 가능성"]
      },
      root: {
        id: "today",
        label: "오늘의 주요 시사",
        summary: "짧은 설명",
        children: [
          {
            id: "issue-1",
            label: "대분류 이슈 제목",
            summary: "짧은 설명",
            children: [
              {
                id: "issue-1-a",
                label: "주제 노드",
                summary: "짧은 설명",
                children: [
                  {
                    id: "issue-1-a-1",
                    label: "세부 쟁점 최종 노드",
                    summary: "짧은 설명",
                    articles: [
                      { title: "기사 제목", url: "https://...", outlet: "언론사 또는 호스트" },
                      { title: "기사 제목", url: "https://...", outlet: "언론사 또는 호스트" },
                      { title: "기사 제목", url: "https://...", outlet: "언론사 또는 호스트" }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }, null, 2),
    "",
    "기사 후보:",
    articleLines.join("\n\n---\n\n")
  ].join("\n");
}

function normalizeMindmap(input: Partial<IssueMindmapFile>, articles: NewsArticle[]): IssueMindmapFile {
  const fallback = buildFallbackMindmap(articles);
  const now = new Date().toISOString();
  const root = normalizeNode(input.root ?? fallback.root, articles);
  const mindmap: IssueMindmapFile = {
    serviceName: "시선(時線)",
    date: today,
    generatedAt: now,
    title: formatIssueTitle(today),
    editorialPolicy: {
      excludedCategories: ["entertainment", "sports"],
      selectionCriteria: ["공공 영향도", "진행성", "출처 교차 확인 가능성", "시의성", "구조화 가능성"]
    },
    root
  };

  if (countLeafNodes(mindmap.root) === 0) return fallback;
  return mindmap;
}

function normalizeNode(node: IssueNode, articles: NewsArticle[], pathId = "node"): IssueNode {
  const id = slugify(node.id || node.label || pathId);
  const children = node.children?.map((child, index) => normalizeNode(child, articles, `${id}-${index + 1}`));
  const normalized: IssueNode = {
    id,
    label: cleanText(node.label || "이슈"),
    summary: node.summary ? cleanText(node.summary) : undefined,
    children
  };

  if (!children || children.length === 0) {
    normalized.articles = normalizeArticles(node.articles ?? [], articles).slice(0, 3);
    while (normalized.articles.length < 3) {
      const next = articles.find((article) => !normalized.articles?.some((item) => item.url === article.url));
      if (!next) break;
      normalized.articles.push(toIssueArticle(next));
    }
  }

  return normalized;
}

function normalizeArticles(items: IssueNode["articles"], candidates: NewsArticle[]) {
  return (items ?? [])
    .map((item) => {
      const match = candidates.find((candidate) => candidate.url === item.url || candidate.portalUrl === item.url);
      return match ? toIssueArticle(match) : {
        title: cleanText(item.title),
        url: item.url,
        outlet: item.outlet ? cleanText(item.outlet) : readHostname(item.url),
        publishedAt: item.publishedAt
      };
    })
    .filter((item) => item.title && item.url && !excludedCategoryPattern.test(item.title));
}

function buildFallbackMindmap(articles: NewsArticle[]): IssueMindmapFile {
  const buckets = ["정책과 제도", "경제와 생활", "사회와 안전"];
  const selected = scoreArticles(articles).slice(0, 54);
  return {
    serviceName: "시선(時線)",
    date: today,
    generatedAt: new Date().toISOString(),
    title: formatIssueTitle(today),
    editorialPolicy: {
      excludedCategories: ["entertainment", "sports"],
      selectionCriteria: ["공공 영향도", "진행성", "출처 교차 확인 가능성", "시의성", "구조화 가능성"]
    },
    root: {
      id: "today",
      label: "오늘의 주요 시사",
      summary: "AI 구조화가 실패했거나 생략되어, 수집 기사 후보를 기준으로 보수적으로 묶었습니다.",
      children: buckets.map((bucket, bucketIndex) => {
        const slice = selected.slice(bucketIndex * 18, bucketIndex * 18 + 18);
        return {
          id: `fallback-${bucketIndex + 1}`,
          label: bucket,
          summary: "후보 기사 기반 임시 분류입니다.",
          children: [
            {
              id: `fallback-${bucketIndex + 1}-a`,
              label: `${bucket} 핵심 흐름`,
              summary: "관련도와 시의성을 기준으로 세부 쟁점을 나눴습니다.",
              children: [0, 1].map((leafIndex) => ({
                id: `fallback-${bucketIndex + 1}-a-${leafIndex + 1}`,
                label: leafIndex === 0 ? "주요 전개" : "후속 쟁점",
                summary: "관련 기사 3건을 기준으로 묶은 임시 세부 쟁점입니다.",
                articles: slice.slice(leafIndex * 3, leafIndex * 3 + 3).map(toIssueArticle)
              }))
            }
          ]
        };
      })
    }
  };
}

function scoreArticles(articles: NewsArticle[]) {
  const sourceCounts = new Map<string, number>();
  for (const article of articles) sourceCounts.set(article.source, (sourceCounts.get(article.source) ?? 0) + 1);

  return articles
    .map((article) => {
      const text = `${article.title} ${article.description}`;
      const publicScore = countMatches(text, /정부|국회|대통령|법안|정책|예산|금리|물가|의료|교육|노동|주거|안전|재난|외교|안보|산업|기후/g) * 4;
      const recencyScore = Math.max(0, 12 - hoursSince(article.pubDate));
      const sourcePenalty = Math.max(0, (sourceCounts.get(article.source) ?? 1) - 2);
      article.score = publicScore + recencyScore - sourcePenalty;
      return article;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function dedupeArticles(articles: NewsArticle[]) {
  const seen = new Set<string>();
  const result: NewsArticle[] = [];
  for (const article of articles) {
    const key = normalizeTitle(article.title) || article.url;
    if (!article.url || seen.has(key)) continue;
    seen.add(key);
    result.push(article);
  }
  return result;
}

async function writeIssueMindmap(mindmap: IssueMindmapFile) {
  await writeFile(path.join(outputDir, `${mindmap.date}.json`), `${JSON.stringify(mindmap, null, 2)}\n`, "utf8");
}

async function updateArchiveIndex(mindmap: IssueMindmapFile) {
  let index: IssueArchiveIndex = {
    latestDate: mindmap.date,
    generatedAt: mindmap.generatedAt,
    entries: []
  };
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as IssueArchiveIndex;
  } catch {
    // First run.
  }

  const entry = {
    date: mindmap.date,
    title: mindmap.title,
    path: `/data/issues/${mindmap.date}.json`
  };
  const entries = [entry, ...index.entries.filter((item) => item.date !== mindmap.date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, archiveLimit);

  await writeFile(indexPath, `${JSON.stringify({
    latestDate: mindmap.date,
    generatedAt: mindmap.generatedAt,
    entries
  }, null, 2)}\n`, "utf8");
}

function toIssueArticle(article: NewsArticle) {
  return {
    title: article.title,
    url: article.url,
    outlet: article.source,
    publishedAt: article.pubDate
  };
}

function mergeArticleOrder(primary: NewsArticle[], fallback: NewsArticle[]) {
  const seen = new Set(primary.map((item) => item.url));
  return [...primary, ...fallback.filter((item) => !seen.has(item.url))];
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object found in model response.");
  return JSON.parse(trimmed.slice(start, end + 1)) as Partial<IssueMindmapFile>;
}

function formatIssueTitle(date: string) {
  const [year, month, day] = date.split("-");
  return `${year}년 ${month}월 ${day}일의 시사 이슈 마인드맵`;
}

function currentKstDate() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function isTodayArticle(value?: string) {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  const kstDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  return kstDate === today;
}

function hoursSince(value?: string) {
  if (!value) return 24;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 24;
  return Math.max(0, (Date.now() - date.getTime()) / 36e5);
}

function countMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length;
}

function countLeafNodes(node: IssueNode): number {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, child) => sum + countLeafNodes(child), 0);
}

function cleanText(value = "") {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function normalizeTitle(value: string) {
  return cleanText(value).replace(/[^\p{Letter}\p{Number}]/gu, "").toLowerCase();
}

function slugify(value: string) {
  const slug = normalizeTitle(value).slice(0, 48);
  return slug || `node-${Math.random().toString(36).slice(2, 8)}`;
}

function readHostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function readXmlTag(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return cleanText(match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "") ?? "");
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

type NewsArticle = {
  title: string;
  description: string;
  url: string;
  portalUrl?: string;
  source: string;
  pubDate?: string;
  query: string;
  score?: number;
};

type NaverNewsResponse = {
  items?: Array<{
    title: string;
    originallink?: string;
    link: string;
    description: string;
    pubDate: string;
  }>;
};

type CohereRerankResponse = {
  results?: Array<{
    index: number;
    relevance_score: number;
  }>;
};

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
