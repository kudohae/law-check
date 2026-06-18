import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Bill, BillDataFile } from "../src/types";

const dataPath = path.resolve("public/data/bills.json");
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const summaryLimit = readPositiveInt(process.env.GEMINI_SUMMARY_LIMIT, 5);
const delayMs = readPositiveInt(process.env.GEMINI_SUMMARY_DELAY_MS, 1200);

async function main() {
  const data = JSON.parse(await readFile(dataPath, "utf8")) as BillDataFile;
  let cleaned = false;
  for (const bill of data.bills) {
    if (bill.aiSummaryStatus === "failed" && !bill.aiSummary) {
      bill.aiSummaryStatus = "none";
      cleaned = true;
    }
  }

  if (!apiKey) {
    console.log("GEMINI_API_KEY is not set. Skipping AI summaries.");
    if (cleaned) {
      await writeData(data);
      console.log("Cleaned failed summary placeholders.");
    }
    return;
  }

  const targets = data.bills
    .filter((bill) => bill.aiSummaryStatus !== "done" || !bill.aiSummary)
    .slice(0, summaryLimit);

  console.log(`Summarizing ${targets.length} of ${data.bills.length} bills with ${model}.`);

  let done = 0;
  for (const bill of targets) {
    try {
      bill.aiSummary = await summarizeBill(bill);
      bill.aiSummaryStatus = "done";
      bill.aiSummaryUpdatedAt = new Date().toISOString();
      done += 1;
      console.log(`AI summary done: ${bill.title}`);
    } catch (error) {
      if (error instanceof StopSummariesError) {
        bill.aiSummaryStatus = "none";
        console.warn(`Stopping AI summaries: ${error.message}`);
        break;
      }
      bill.aiSummaryStatus = "none";
      console.warn(`AI summary failed: ${bill.title} - ${error instanceof Error ? error.message : String(error)}`);
    }
    await delay(delayMs);
  }

  await writeData(data);
  console.log(`Saved AI summaries. Completed ${done}/${targets.length}.`);
}

async function summarizeBill(bill: Bill): Promise<string> {
  const summarySource = await loadSummarySource(bill);
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey ?? ""
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: buildPrompt(bill, summarySource)
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 360
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 429 || response.status === 503) {
      throw new StopSummariesError(`${response.status} ${response.statusText}`);
    }
    throw new Error(`${response.status} ${response.statusText}: ${detail.slice(0, 220)}`);
  }

  const payload = (await response.json()) as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n").trim();
  if (!text) throw new Error("Gemini returned an empty response.");
  return text.replace(/\n{3,}/g, "\n\n");
}

async function loadSummarySource(bill: Bill): Promise<SummarySource> {
  const url = bill.summarySourceUrl ?? bill.officialUrl;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const html = await response.text();
    const sourceText = extractSummarySourceText(bill, html);
    if (!sourceText) throw new Error("summary source text not found");
    return {
      label: bill.summarySourceLabel ?? defaultSummarySourceLabel(bill),
      url,
      text: truncateSourceText(sourceText)
    };
  } catch (error) {
    console.warn(`Summary source fallback: ${bill.title} - ${error instanceof Error ? error.message : String(error)}`);
    return {
      label: "목록 공개 데이터 요지",
      url,
      text: bill.rawSummary ?? "상세 원문을 가져오지 못했습니다."
    };
  }
}

function extractSummarySourceText(bill: Bill, html: string) {
  const pageText = stripHtml(html);

  if (bill.source === "government_notice") {
    return extractBetween(pageText, ["⊙", `${bill.title} `, "입법예고를 하는데 있어"], ["법령안 관련 자료", "이전글", "목록"]);
  }

  if (bill.source === "government_pre_submit" || /\/lmSts\/govLm\//.test(bill.summarySourceUrl ?? "")) {
    return extractBetween(pageText, ["주요내용"], ["추진현황", "입법현황", "목록"]);
  }

  return extractBetween(pageText, ["제안이유 및 주요내용"], ["목록", "첨부파일"]);
}

function extractBetween(text: string, starts: string[], ends: string[]) {
  const startIndexes = starts
    .map((marker) => text.lastIndexOf(marker))
    .filter((index) => index >= 0);
  if (startIndexes.length === 0) return "";

  const startIndex = Math.max(...startIndexes);
  const startMarker = starts.find((marker) => text.lastIndexOf(marker) === startIndex) ?? "";
  const contentStart = startIndex + startMarker.length;
  const rest = text.slice(contentStart);
  const endIndexes = ends
    .map((marker) => rest.indexOf(marker))
    .filter((index) => index > 80);
  const content = rest.slice(0, endIndexes.length > 0 ? Math.min(...endIndexes) : 8000);
  return cleanSourceText(content);
}

function cleanSourceText(value: string) {
  return value
    .replace(/전체 보기/g, " ")
    .replace(/화면크기\s*(축소|초기화|확대)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateSourceText(value: string) {
  return value.length > 6000 ? `${value.slice(0, 6000)}...` : value;
}

function defaultSummarySourceLabel(bill: Bill) {
  if (bill.source === "government_notice") return "정부입법예고 본문";
  if (bill.source === "government_pre_submit") return "정부입법현황 주요내용";
  if (bill.source === "assembly_government") return "정부입법현황 주요내용";
  return "국회입법현황 제안이유 및 주요내용";
}

function stripHtml(value: string): string {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·");
}

function buildPrompt(bill: Bill, summarySource: SummarySource) {
  return [
    "너는 한국 입법 정보를 요약하는 보조자다.",
    "원문에 없는 내용을 추측하지 말고, 아래 제공된 공개 데이터만 사용해라.",
    "법률 자문처럼 말하지 말고, 정보 제공용 요약임을 전제로 간결하게 써라.",
    "출력은 한국어 Markdown으로 작성하되 6줄 이내로 제한해라.",
    "",
    `법률안명: ${bill.title}`,
    `출처: ${bill.source}`,
    `진행상태: ${bill.statusLabel}`,
    `소관부처: ${bill.ministry ?? "미확인"}`,
    `소관위원회: ${bill.committee ?? "미확인"}`,
    `제안/제출 주체: ${bill.proposerName ?? "미확인"}`,
    `제안일: ${bill.proposedDate ?? "미확인"}`,
    `입법예고 기간: ${bill.noticeStartDate ?? "해당 없음"} ~ ${bill.noticeEndDate ?? "해당 없음"}`,
    `공개 데이터 요지: ${bill.rawSummary ?? "없음"}`,
    `AI 요약 원문 출처: ${summarySource.label}`,
    `AI 요약 원문 URL: ${summarySource.url}`,
    `AI 요약 원문: ${summarySource.text}`,
    `공식 URL: ${bill.officialUrl}`,
    "",
    "형식:",
    "- 한줄 요약: ...",
    "- 현재 단계: ...",
    "- 확인할 점: ..."
  ].join("\n");
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeData(data: BillDataFile) {
  data.generatedAt = new Date().toISOString();
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

class StopSummariesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StopSummariesError";
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type SummarySource = {
  label: string;
  url: string;
  text: string;
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
