import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Bill, BillDataFile, BillStage } from "../src/types";

const outputPath = path.resolve("public/data/bills.json");
const assemblyEndpoint = "https://open.assembly.go.kr/portal/openapi/nzmimeepazxkubdpn";
const lawmakingOrigin = "https://opinion.lawmaking.go.kr";
const assemblyPageSize = readPositiveInt(process.env.ASSEMBLY_PAGE_SIZE, 100);
const assemblyMaxPages = readPositiveInt(process.env.ASSEMBLY_MAX_PAGES, 5);
const lawmakingMaxPages = readPositiveInt(process.env.LAWMAKING_MAX_PAGES, 5);

async function main() {
  const previous = await readPreviousData();
  const fetchedBills: Bill[] = [];

  const assemblyBills = await safeFetch("국회의원 발의 법률안", fetchAssemblyMemberBills);
  fetchedBills.push(...assemblyBills);

  const assemblyStatusBills = await safeFetch("국회입법현황", fetchAssemblyStatusBills);
  fetchedBills.push(...assemblyStatusBills);

  const governmentSubmittedBills = await safeFetch("정부 제출 법률안", fetchGovernmentSubmittedBills);
  fetchedBills.push(...governmentSubmittedBills);

  const governmentNotices = await safeFetch("정부입법예고", fetchGovernmentNotices);
  fetchedBills.push(...governmentNotices);

  const governmentProgress = await safeFetch("정부입법현황", fetchGovernmentProgress);
  fetchedBills.push(...governmentProgress);

  const bills = fetchedBills.length > 0 ? mergeAiSummaries(dedupeBills(fetchedBills), previous.bills) : previous.bills;

  const nextData: BillDataFile = {
    generatedAt: new Date().toISOString(),
    sourceNote:
      fetchedBills.length > 0
        ? `공개 데이터에서 수집한 데이터입니다. 국회 API ${assemblyMaxPages}페이지, 국민참여입법센터 ${lawmakingMaxPages}페이지 범위로 갱신했습니다.`
        : "공개 API 수집에 실패해 기존 데이터를 유지했습니다.",
    bills
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(nextData, null, 2)}\n`, "utf8");
  console.log(`Saved ${bills.length} bills to ${outputPath}`);
}

async function readPreviousData(): Promise<BillDataFile> {
  try {
    return JSON.parse(await readFile(outputPath, "utf8")) as BillDataFile;
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      sourceNote: "초기 데이터가 없습니다.",
      bills: []
    };
  }
}

async function safeFetch(label: string, fetcher: () => Promise<Bill[]>): Promise<Bill[]> {
  try {
    const bills = await fetcher();
    console.log(`${label}: ${bills.length} items`);
    return bills;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${label} 수집 실패: ${message}`);
    return [];
  }
}

async function fetchAssemblyMemberBills(): Promise<Bill[]> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= assemblyMaxPages; page += 1) {
    const url = new URL(assemblyEndpoint);
    if (process.env.ASSEMBLY_API_KEY) {
      url.searchParams.set("KEY", process.env.ASSEMBLY_API_KEY);
    }
    url.searchParams.set("Type", "json");
    url.searchParams.set("pIndex", String(page));
    url.searchParams.set("pSize", String(assemblyPageSize));
    url.searchParams.set("AGE", "22");

    const parsed = await fetchJson<Record<string, unknown>>(url);
    const pageRows = readAssemblyRows(parsed, "nzmimeepazxkubdpn");
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
  }

  const now = new Date().toISOString();

  return rows.map((row: Record<string, unknown>, index) => {
    const externalId = text(row.BILL_NO) || text(row.BILL_ID) || `assembly-${index}`;
    const title = text(row.BILL_NAME) || "제목 미확인 법률안";
    const proposedDate = normalizeDate(text(row.PROPOSE_DT));
    const statusLabel = text(row.PROC_RESULT) || text(row.COMMITTEE) || "국회 접수";
    const id = `assembly-member-${externalId}`;
    const officialUrl = text(row.DETAIL_LINK) || "https://likms.assembly.go.kr/bill/main.do";

    return {
      id,
      externalId,
      source: "assembly_member",
      title,
      normalizedTitle: normalizeTitle(title),
      stage: inferAssemblyStage(statusLabel),
      statusLabel,
      proposerName: text(row.PROPOSER) || text(row.RST_PROPOSER) || undefined,
      proposerType: "member",
      committee: text(row.COMMITTEE) || undefined,
      proposedDate,
      lastUpdatedAt: now,
      officialUrl,
      rawSummary: text(row.PUBL_PROPOSER)
        ? `공동발의자: ${text(row.PUBL_PROPOSER)}`
        : undefined,
      aiSummaryStatus: "none",
      needsReview: false,
      events: [
        {
          id: `${id}-event-proposed`,
          billId: id,
          eventType: "proposed",
          eventLabel: "국회 발의",
          eventDate: proposedDate,
          sourceUrl: officialUrl
        }
      ],
      createdAt: now,
      updatedAt: now
    } satisfies Bill;
  });
}

async function fetchAssemblyStatusBills(): Promise<Bill[]> {
  const rows = await fetchLawmakingRows("/gcom/nsmLmSts/out", /data-th=["']의안명["']/);
  const now = new Date().toISOString();

  return rows.map((row, index) => parseAssemblyStatusRow(row, index, now));
}

async function fetchGovernmentNotices(): Promise<Bill[]> {
  const rows = await fetchLawmakingRows("/gcom/ogLmPp", /data-th=["']법령 제명["']/);
  const now = new Date().toISOString();

  return rows.map((row, index) => {
    const link = findHref(row, /\/gcom\/ogLmPp\/\d+/);
    const externalId = link.match(/\d+/)?.[0] || `government-notice-${index}`;
    const title = findLinkText(row, /\/gcom\/ogLmPp\/\d+/) || "제목 미확인 입법예고";
    const ministryAndType = readCellText(row, "소관부처 (법령종류)");
    const [ministry, lawType] = splitMinistryAndType(ministryAndType);
    const dates = readDates(readCellText(row, "입법의견 접수기간"));
    const noticeStartDate = dates[0];
    const noticeEndDate = dates[1];
    const id = `government-notice-${externalId}`;
    const officialUrl = new URL(link || "/gcom/ogLmPp", lawmakingOrigin).toString();

    return {
      id,
      externalId,
      source: "government_notice",
      title,
      normalizedTitle: normalizeTitle(title),
      stage: "pre_announcement",
      statusLabel: "입법예고",
      proposerName: ministry || undefined,
      proposerType: "ministry",
      ministry: ministry || undefined,
      noticeStartDate,
      noticeEndDate,
      lastUpdatedAt: now,
      officialUrl,
      rawSummary: [
        lawType ? `법령종류: ${lawType}` : "",
        readCellText(row, "법령분야 (주요적용대상)")
          ? `법령분야: ${readCellText(row, "법령분야 (주요적용대상)")}`
          : "",
        readCellText(row, "입법의견 남은 기간")
          ? `의견 제출 남은 기간: ${readCellText(row, "입법의견 남은 기간")}`
          : ""
      ]
        .filter(Boolean)
        .join(" / "),
      aiSummaryStatus: "none",
      needsReview: false,
      events: [
        {
          id: `${id}-event-notice-start`,
          billId: id,
          eventType: "notice_start",
          eventLabel: "입법예고 시작",
          eventDate: noticeStartDate,
          sourceUrl: officialUrl
        },
        {
          id: `${id}-event-notice-end`,
          billId: id,
          eventType: "notice_end",
          eventLabel: "입법예고 종료 예정",
          eventDate: noticeEndDate,
          sourceUrl: officialUrl
        }
      ].filter((event) => event.eventDate),
      createdAt: now,
      updatedAt: now
    } satisfies Bill;
  });
}

async function fetchGovernmentSubmittedBills(): Promise<Bill[]> {
  const rows = await fetchLawmakingRows("/gcom/nsmLmSts/out", /data-th=["']의안명["']/, {
    scPpsUsr: "정부",
    pageSize: "100"
  });
  const now = new Date().toISOString();

  return rows.map((row, index) => parseAssemblyStatusRow(row, index, now, "assembly_government"));
}

async function fetchGovernmentProgress(): Promise<Bill[]> {
  const rows = await fetchLawmakingRows("/lmSts/govLm", /data-th=["']법령명["']/);
  const now = new Date().toISOString();

  return rows.map((row, index): Bill | null => {
    const link = findHref(row, /\/lmSts\/govLm\/\d+/);
    const externalId = link.match(/\d+/)?.[0] || `government-progress-${index}`;
    const title = findLinkText(row, /\/lmSts\/govLm\/\d+/) || "제목 미확인 정부입법현황";
    const statusLabel = readCellText(row, "추진현황") || "정부입법현황";
    const ministry = readCellText(row, "소관부처");
    const lawType = readCellText(row, "법령종류");
    const revisionType = readCellText(row, "제 · 개정구분");
    const id = `government-progress-${externalId}`;
    const officialUrl = new URL(link || "/lmSts/govLm", lawmakingOrigin).toString();

    if (/국회제출/.test(statusLabel)) return null;

    return {
      id,
      externalId,
      source: "government_pre_submit",
      title,
      normalizedTitle: normalizeTitle(title),
      stage: inferGovernmentStage(statusLabel),
      statusLabel,
      proposerName: ministry || undefined,
      proposerType: "ministry",
      ministry: ministry || undefined,
      lastUpdatedAt: now,
      officialUrl,
      rawSummary: [
        lawType ? `법령종류: ${lawType}` : "",
        revisionType ? `제·개정구분: ${revisionType}` : ""
      ]
        .filter(Boolean)
        .join(" / "),
      aiSummaryStatus: "none",
      needsReview: true,
      events: [
        {
          id: `${id}-event-current`,
          billId: id,
          eventType: "government_progress",
          eventLabel: statusLabel,
          sourceUrl: officialUrl
        }
      ],
      createdAt: now,
      updatedAt: now
    } satisfies Bill;
  }).filter((bill): bill is Bill => bill !== null);
}

function parseAssemblyStatusRow(
  row: string,
  index: number,
  now: string,
  forcedSource?: "assembly_government" | "assembly_member"
): Bill {
  const link = findHref(row, /\/gcom\/nsmLmSts\/out\/\d+/);
  const billNo =
    readCellText(row, "의안번호 (대안번호)").match(/\d+/)?.[0] ||
    link.match(/\d+/)?.[0] ||
    `assembly-status-${index}`;
  const title = findLinkText(row, /\/gcom\/nsmLmSts\/out\/\d+/) || "제목 미확인 국회입법현황";
  const proposerAndDate = readCellText(row, "제안자(제안일자)");
  const proposerName = proposerAndDate.replace(/\(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\)/, "").trim();
  const proposedDate = readDates(proposerAndDate)[0];
  const committeeAndMinistry = readCellText(row, "상임위원회(소관부처)");
  const statusAndDate = readCellText(row, "국회현황(추진일자)");
  const decision = readCellText(row, "의결현황(의결일자)");
  const statusLabel = statusAndDate.replace(/\(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\)/, "").trim() || "국회 현황";
  const statusDate = readDates(statusAndDate)[0];
  const source = forcedSource ?? (/정부/.test(proposerName) ? "assembly_government" : "assembly_member");
  const isGovernment = source === "assembly_government";
  const idPrefix = isGovernment ? "government-submitted" : "assembly-status";
  const id = `${idPrefix}-${billNo}`;
  const officialUrl = new URL(link || "/gcom/nsmLmSts/out", lawmakingOrigin).toString();

  return {
    id,
    externalId: billNo,
    assemblyBillNo: billNo,
    source,
    title,
    normalizedTitle: normalizeTitle(title),
    stage: inferAssemblyStage(statusLabel || decision),
    statusLabel,
    proposerName: isGovernment ? "정부" : proposerName || undefined,
    proposerType: isGovernment ? "government" : "member",
    ministry: extractParenthesized(committeeAndMinistry) || undefined,
    committee: extractNonParenthesized(committeeAndMinistry) || undefined,
    proposedDate,
    lastUpdatedAt: now,
    officialUrl,
    rawSummary: decision ? `의결현황: ${decision}` : undefined,
    aiSummaryStatus: "none",
    needsReview: false,
    events: [
      {
        id: `${id}-event-proposed`,
        billId: id,
        eventType: isGovernment ? "government_submitted" : "assembly_status",
        eventLabel: statusLabel,
        eventDate: statusDate ?? proposedDate,
        sourceUrl: officialUrl
      }
    ],
    createdAt: now,
    updatedAt: now
  } satisfies Bill;
}

async function fetchText(url: URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchLawmakingRows(pathname: string, rowPattern: RegExp, query: Record<string, string> = {}): Promise<string[]> {
  const rows: string[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= lawmakingMaxPages; page += 1) {
    const url = new URL(pathname, lawmakingOrigin);
    url.searchParams.set("pageIndex", String(page));
    url.searchParams.set("blockStartPage", String(Math.floor((page - 1) / 10) * 10 + 1));
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const html = await fetchText(url);
    const pageRows = parseHtmlRows(html).filter((row) => rowPattern.test(row));
    if (pageRows.length === 0) break;

    let newRows = 0;
    for (const row of pageRows) {
      const key = findHref(row, /\d+/) || stripHtml(row).slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      newRows += 1;
    }

    if (newRows === 0) break;
  }

  return rows;
}

function dedupeBills(bills: Bill[]) {
  const map = new Map<string, Bill>();
  for (const bill of bills) {
    const key = `${bill.source}:${bill.externalId}`;
    map.set(key, bill);
  }
  return [...map.values()].sort((a, b) => {
    const left = Date.parse(b.proposedDate ?? b.noticeStartDate ?? b.updatedAt);
    const right = Date.parse(a.proposedDate ?? a.noticeStartDate ?? a.updatedAt);
    return left - right;
  });
}

function mergeAiSummaries(nextBills: Bill[], previousBills: Bill[]) {
  const previousByKey = new Map<string, Bill>();
  for (const bill of previousBills) {
    previousByKey.set(summaryKey(bill), bill);
  }

  return nextBills.map((bill) => {
    const previous = previousByKey.get(summaryKey(bill));
    if (!previous?.aiSummary) return bill;
    return {
      ...bill,
      aiSummary: previous.aiSummary,
      aiSummaryStatus: previous.aiSummaryStatus,
      aiSummaryUpdatedAt: previous.aiSummaryUpdatedAt
    };
  });
}

function summaryKey(bill: Pick<Bill, "source" | "externalId" | "normalizedTitle">) {
  return `${bill.source}:${bill.externalId}:${bill.normalizedTitle}`;
}

function readAssemblyRows(parsed: Record<string, unknown>, rootKey: string): Record<string, unknown>[] {
  const root = parsed[rootKey];
  if (!Array.isArray(root)) return [];
  const body = root.find((item) => {
    return typeof item === "object" && item !== null && "row" in item;
  }) as { row?: unknown } | undefined;
  return ensureArray(body?.row);
}

function inferAssemblyStage(statusLabel: string): BillStage {
  if (/발의|접수/.test(statusLabel)) return "submitted_to_assembly";
  if (/철회/.test(statusLabel)) return "withdrawn";
  if (/부결|폐기|대안반영폐기/.test(statusLabel)) return "rejected";
  if (/가결|원안가결|수정가결/.test(statusLabel)) return "passed";
  if (/본회의/.test(statusLabel)) return "plenary_review";
  if (/위원회|소관위|상임위/.test(statusLabel)) return "committee_review";
  return "submitted_to_assembly";
}

function inferGovernmentStage(statusLabel: string): BillStage {
  if (/공포/.test(statusLabel)) return "promulgated";
  if (/국회|제출/.test(statusLabel)) return "submitted_to_assembly";
  if (/입법예고/.test(statusLabel)) return "pre_announcement";
  if (/심사|검토|협의|차관|국무/.test(statusLabel)) return "drafting";
  return "drafting";
}

function normalizeTitle(value: string) {
  return value.replace(/\s+/g, "").replace(/[()[\]{}「」『』·ㆍ.,]/g, "");
}

function normalizeDate(value: string) {
  if (!value) return undefined;
  const dotDate = value.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
  if (dotDate) {
    const [, year, month, day] = dotDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const compact = value.replace(/[^\d]/g, "");
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  return value;
}

function parseHtmlRows(html: string): string[] {
  const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? "";
  return [...tbody.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
}

function readCellText(rowHtml: string, dataTh: string): string {
  const escaped = escapeRegExp(dataTh);
  const match = rowHtml.match(
    new RegExp(`<td[^>]*data-th=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/td>`, "i")
  );
  return stripHtml(match?.[1] ?? "");
}

function findHref(rowHtml: string, hrefPattern: RegExp): string {
  const links = [...rowHtml.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)].map((match) =>
    decodeHtml(match[1])
  );
  return links.find((href) => hrefPattern.test(href)) ?? "";
}

function findLinkText(rowHtml: string, hrefPattern: RegExp): string {
  const links = [...rowHtml.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const match = links.find((link) => hrefPattern.test(decodeHtml(link[1])));
  return stripHtml(match?.[2] ?? "");
}

function splitMinistryAndType(value: string): [string, string] {
  const match = value.match(/^(.+?)\s*\((.+)\)$/);
  if (!match) return [value, ""];
  return [match[1].trim(), match[2].trim()];
}

function readDates(value: string): string[] {
  return [...value.matchAll(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\./g)].map((match) =>
    normalizeDate(match[0])
  ).filter((date): date is string => Boolean(date));
}

function extractParenthesized(value: string): string {
  return value.match(/\(([^)]+)\)/)?.[1]?.trim() ?? "";
}

function extractNonParenthesized(value: string): string {
  return value.replace(/\([^)]+\)/g, "").trim();
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
    .replace(/&nbsp;/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function text(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function ensureArray(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return [value as Record<string, unknown>];
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
