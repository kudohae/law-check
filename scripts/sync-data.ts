import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { Bill, BillDataFile, BillStage } from "../src/types";

const outputPath = path.resolve("public/data/bills.json");
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true
});

async function main() {
  const previous = await readPreviousData();
  const fetchedBills: Bill[] = [];

  const assemblyBills = await safeFetch("국회의원 발의 법률안", fetchAssemblyMemberBills);
  fetchedBills.push(...assemblyBills);

  const governmentNotices = await safeFetch("정부입법예고", fetchGovernmentNotices);
  fetchedBills.push(...governmentNotices);

  const bills = fetchedBills.length > 0 ? dedupeBills(fetchedBills) : previous.bills;

  const nextData: BillDataFile = {
    generatedAt: new Date().toISOString(),
    sourceNote:
      fetchedBills.length > 0
        ? "공개 API에서 수집한 데이터입니다. 일부 항목은 API 응답 제한으로 누락될 수 있습니다."
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
  const key = process.env.ASSEMBLY_API_KEY;
  if (!key) return [];

  const url = new URL("https://open.assembly.go.kr/portal/openapi/ALLBILL");
  url.searchParams.set("KEY", key);
  url.searchParams.set("Type", "xml");
  url.searchParams.set("pIndex", "1");
  url.searchParams.set("pSize", "50");

  const xml = await fetchText(url);
  const parsed = parser.parse(xml);
  const rows = ensureArray(parsed?.ALLBILL?.row);
  const now = new Date().toISOString();

  return rows.map((row: Record<string, unknown>, index) => {
    const externalId = text(row.BILL_ID) || text(row.BILL_NO) || `assembly-${index}`;
    const title = text(row.BILL_NAME) || "제목 미확인 법률안";
    const proposedDate = normalizeDate(text(row.PROPOSE_DT));
    const statusLabel = text(row.PROC_RESULT) || text(row.CURR_COMMITTEE) || "상태 미확인";
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
      committee: text(row.CURR_COMMITTEE) || undefined,
      proposedDate,
      lastUpdatedAt: now,
      officialUrl,
      rawSummary: text(row.SUMMARY) || undefined,
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

async function fetchGovernmentNotices(): Promise<Bill[]> {
  const url = new URL("http://www.lawmaking.go.kr/rest/ogLmPp");
  if (process.env.LAWMAKING_API_KEY) {
    url.searchParams.set("OC", process.env.LAWMAKING_API_KEY);
  }
  url.searchParams.set("pageIndex", "1");
  url.searchParams.set("pageSize", "50");

  const xml = await fetchText(url);
  const parsed = parser.parse(xml);
  const rows = ensureArray(
    parsed?.response?.body?.items?.item ??
      parsed?.LawMakingNotice?.row ??
      parsed?.items?.item ??
      parsed?.item
  );
  const now = new Date().toISOString();

  return rows.map((row: Record<string, unknown>, index) => {
    const externalId =
      text(row.lmPpSeq) ||
      text(row.ogLmPpSeq) ||
      text(row.seq) ||
      text(row.announceNo) ||
      `government-notice-${index}`;
    const title =
      text(row.lawNm) ||
      text(row.lmPpSj) ||
      text(row.title) ||
      text(row.noticeNm) ||
      "제목 미확인 입법예고";
    const ministry = text(row.mst) || text(row.deptNm) || text(row.orgNm) || text(row.ministry);
    const noticeStartDate = normalizeDate(text(row.ppStrDt) || text(row.startDate) || text(row.bgnYmd));
    const noticeEndDate = normalizeDate(text(row.ppEndDt) || text(row.endDate) || text(row.endYmd));
    const id = `government-notice-${externalId}`;
    const officialUrl =
      text(row.detailUrl) ||
      text(row.url) ||
      "https://opinion.lawmaking.go.kr/gcom/ogLmPp";

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
      rawSummary: text(row.ppCptOfi) || text(row.summary) || text(row.mainContent) || undefined,
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

async function fetchText(url: URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
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

function inferAssemblyStage(statusLabel: string): BillStage {
  if (/철회/.test(statusLabel)) return "withdrawn";
  if (/부결|폐기|대안반영폐기/.test(statusLabel)) return "rejected";
  if (/가결|원안가결|수정가결/.test(statusLabel)) return "passed";
  if (/본회의/.test(statusLabel)) return "plenary_review";
  if (/위원회|소관위|상임위/.test(statusLabel)) return "committee_review";
  return "submitted_to_assembly";
}

function normalizeTitle(value: string) {
  return value.replace(/\s+/g, "").replace(/[()[\]{}「」『』·ㆍ.,]/g, "");
}

function normalizeDate(value: string) {
  if (!value) return undefined;
  const compact = value.replace(/[^\d]/g, "");
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  return value;
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

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
