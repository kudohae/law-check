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
              text: buildPrompt(bill)
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

function buildPrompt(bill: Bill) {
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

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
