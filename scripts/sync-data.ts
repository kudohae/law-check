import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Bill, BillDataFile, BillSource, BillStage } from "../src/types";

const outputPath = path.resolve("public/data/bills.json");
const assemblyEndpoint = "https://open.assembly.go.kr/portal/openapi/nzmimeepazxkubdpn";
const lawmakingOrigin = "https://opinion.lawmaking.go.kr";
const assemblyPageSize = readPositiveInt(process.env.ASSEMBLY_PAGE_SIZE, 100);
const assemblyMaxPages = readPositiveInt(process.env.ASSEMBLY_MAX_PAGES, 5);
const lawmakingMaxPages = readPositiveInt(process.env.LAWMAKING_MAX_PAGES, 5);
const syncSinceDate = normalizeDate(process.env.LAW_CHECK_SINCE_DATE ?? "");
const syncUntilDate = normalizeDate(process.env.LAW_CHECK_UNTIL_DATE ?? "") ?? todayDate();
const compactDateSources = new Set(["stYd", "edYd", "stDt", "edDt"]);
const failedBillSources = new Set<BillSource>();
const lawmakingChunkDays = readPositiveInt(process.env.LAWMAKING_CHUNK_DAYS, 31);
const requestDelayMs = readNonNegativeInt(process.env.LAW_CHECK_REQUEST_DELAY_MS, 1000);
const retryCount = readPositiveInt(process.env.LAW_CHECK_RETRY_COUNT, 3);
const retryDelayMs = readNonNegativeInt(process.env.LAW_CHECK_RETRY_DELAY_MS, 5000);

async function main() {
  const previous = await readPreviousData();
  const fetchedBills: Bill[] = [];

  const assemblyBills = await safeFetch("국회의원 발의 법률안", fetchAssemblyMemberBills, ["assembly_member"]);
  fetchedBills.push(...assemblyBills);

  const assemblyStatusBills = await safeFetch("국회입법현황", fetchAssemblyStatusBills, ["assembly_member", "assembly_government"]);
  fetchedBills.push(...assemblyStatusBills);

  const governmentSubmittedBills = await safeFetch("정부 제출 법률안", fetchGovernmentSubmittedBills, ["assembly_government"]);
  fetchedBills.push(...governmentSubmittedBills);

  const governmentNotices = await safeFetch("정부입법예고", fetchGovernmentNotices, ["government_notice"]);
  fetchedBills.push(...governmentNotices);

  const governmentProgress = await safeFetch("정부입법현황", fetchGovernmentProgress, ["government_pre_submit"]);
  fetchedBills.push(...governmentProgress);

  const bills = fetchedBills.length > 0
    ? mergeAiSummaries(filterBillsSince(dedupeBills(preserveFailedSourceBills(fetchedBills, previous.bills))), previous.bills)
    : previous.bills;

  const nextData: BillDataFile = {
    generatedAt: new Date().toISOString(),
    sourceNote:
      fetchedBills.length > 0
        ? `공개 데이터에서 수집한 데이터입니다. 국회 API ${assemblyMaxPages}페이지, 국민참여입법센터 ${lawmakingMaxPages}페이지 범위로 갱신했습니다.${syncSinceDate ? ` 기준일 ${syncSinceDate} 이후 항목만 포함했습니다.` : ""}`
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

async function safeFetch(label: string, fetcher: () => Promise<Bill[]>, sourceHints: BillSource[]): Promise<Bill[]> {
  try {
    const bills = await fetcher();
    console.log(`${label}: ${bills.length} items`);
    return bills;
  } catch (error) {
    for (const source of sourceHints) failedBillSources.add(source);
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
    if (syncSinceDate && pageRows.every((row) => isBeforeSince(normalizeDate(text(row.PROPOSE_DT))))) break;
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
      summarySourceUrl: officialUrl,
      summarySourceLabel: "국회입법현황 제안이유 및 주요내용",
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
  const rows = await fetchLawmakingRowsSequential("/gcom/nsmLmSts/out", /data-th=["']의안명["']/, {
    pageSize: "100"
  }, readAssemblyStatusReferenceDate, true);
  const now = new Date().toISOString();

  return rows.map((row, index) => parseAssemblyStatusRow(row, index, now));
}

async function fetchGovernmentNotices(): Promise<Bill[]> {
  const rows = await fetchLawmakingRowsSequential("/gcom/ogLmPp", /data-th=["']법령 제명["']/, {
    pageSize: "100"
  }, readGovernmentNoticeReferenceDate, true);
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
      summarySourceUrl: officialUrl,
      summarySourceLabel: "정부입법예고 본문",
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
  const rows = await fetchLawmakingRowsSequential("/gcom/nsmLmSts/out", /data-th=["']의안명["']/, {
    scPpsUsr: "정부",
    pageSize: "100"
  }, readAssemblyStatusReferenceDate, true);
  const governmentSummarySources = await fetchGovernmentSubmittedSummarySources();
  const now = new Date().toISOString();

  return rows.map((row, index) => {
    const bill = parseAssemblyStatusRow(row, index, now, "assembly_government");
    const source =
      governmentSummarySources.byTitleAndMinistry.get(matchKey(bill.title, bill.ministry)) ??
      governmentSummarySources.byTitle.get(normalizeBillTitleForMatch(bill.title));
    if (!source) return bill;
    return {
      ...bill,
      governmentTrackingId: source.externalId,
      summarySourceUrl: source.url,
      summarySourceLabel: "정부입법현황 주요내용"
    };
  });
}

async function fetchGovernmentSubmittedSummarySources(): Promise<GovernmentSummarySources> {
  const rows = await fetchLawmakingRows("/lmSts/govLm", /data-th=["']법령명["']/, {
    lbPrcStsCd: "EB0109",
    pageSize: "100"
  });
  const byTitleAndMinistry = new Map<string, GovernmentSummarySource>();
  const byTitleAndMinistryCandidates = new Map<string, GovernmentSummarySource[]>();
  const byTitleCandidates = new Map<string, GovernmentSummarySource[]>();

  for (const row of rows) {
    const link = findHref(row, /\/lmSts\/govLm\/\d+/);
    const externalId = link.match(/\d+/)?.[0];
    const title = findLinkText(row, /\/lmSts\/govLm\/\d+/);
    const ministry = readCellText(row, "소관부처");
    const lawType = readCellText(row, "법령종류");
    if (!externalId || !title || (lawType && !/법률/.test(lawType))) continue;

    const source = {
      externalId,
      title,
      ministry,
      url: new URL(link, lawmakingOrigin).toString()
    } satisfies GovernmentSummarySource;
    const titleAndMinistryKey = matchKey(title, ministry);
    byTitleAndMinistryCandidates.set(titleAndMinistryKey, [
      ...(byTitleAndMinistryCandidates.get(titleAndMinistryKey) ?? []),
      source
    ]);

    const titleKey = normalizeBillTitleForMatch(title);
    byTitleCandidates.set(titleKey, [...(byTitleCandidates.get(titleKey) ?? []), source]);
  }

  const byTitle = new Map<string, GovernmentSummarySource>();
  for (const [key, candidates] of byTitleAndMinistryCandidates) {
    if (candidates.length === 1) byTitleAndMinistry.set(key, candidates[0]);
  }
  for (const [key, candidates] of byTitleCandidates) {
    if (candidates.length === 1) byTitle.set(key, candidates[0]);
  }

  return { byTitleAndMinistry, byTitle };
}

async function fetchGovernmentProgress(): Promise<Bill[]> {
  const rows = await fetchLawmakingRowsSequential("/lmSts/govLm", /data-th=["']법령명["']/, {
    pageSize: "100"
  });
  const now = new Date().toISOString();

  const bills = await Promise.all(rows.map(async (row, index): Promise<Bill | null> => {
    const link = findHref(row, /\/lmSts\/govLm\/\d+/);
    const externalId = link.match(/\d+/)?.[0] || `government-progress-${index}`;
    const title = findLinkText(row, /\/lmSts\/govLm\/\d+/) || "제목 미확인 정부입법현황";
    const statusLabel = readCellText(row, "추진현황") || "정부입법현황";
    const ministry = readCellText(row, "소관부처");
    const lawType = readCellText(row, "법령종류");
    const revisionType = readCellText(row, "제 · 개정구분");
    const id = `government-progress-${externalId}`;
    const officialUrl = new URL(link || "/lmSts/govLm", lawmakingOrigin).toString();
    const noticePeriod = await loadGovernmentProgressNoticePeriod(officialUrl);

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
      noticeStartDate: noticePeriod.startDate,
      noticeEndDate: noticePeriod.endDate,
      lastUpdatedAt: now,
      officialUrl,
      summarySourceUrl: officialUrl,
      summarySourceLabel: "정부입법현황 주요내용",
      rawSummary: [
        lawType ? `법령종류: ${lawType}` : "",
        revisionType ? `제·개정구분: ${revisionType}` : "",
        noticePeriod.startDate ? `입법예고 기간: ${noticePeriod.startDate} ~ ${noticePeriod.endDate ?? ""}` : ""
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
          eventDate: noticePeriod.startDate,
          sourceUrl: officialUrl
        }
      ],
      createdAt: now,
      updatedAt: now
    } satisfies Bill;
  }));

  return bills.filter((bill): bill is Bill => bill !== null);
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
    summarySourceUrl: officialUrl,
    summarySourceLabel: isGovernment
      ? "정부입법현황 주요내용 또는 국회입법현황 제안이유 및 주요내용"
      : "국회입법현황 제안이유 및 주요내용",
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
  return withRetry(async () => {
    await delay(requestDelayMs);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.text();
  }, url.toString());
}

async function fetchJson<T>(url: URL): Promise<T> {
  return withRetry(async () => {
    await delay(requestDelayMs);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }, url.toString());
}

async function fetchLawmakingRowsByDateRanges(
  pathname: string,
  rowPattern: RegExp,
  query: Record<string, string> & { dateStartKey?: string; dateEndKey?: string } = {},
  readReferenceDate?: (row: string) => string | undefined
): Promise<string[]> {
  if (!syncSinceDate) {
    return fetchLawmakingRows(pathname, rowPattern, sinceDateQuery(query), readReferenceDate);
  }

  const rows: string[] = [];
  const seen = new Set<string>();
  for (const range of buildDateRanges(syncSinceDate, syncUntilDate, lawmakingChunkDays)) {
    const rangeRows = await fetchLawmakingRows(
      pathname,
      rowPattern,
      dateRangeQuery(query, range),
      readReferenceDate
    );
    for (const row of rangeRows) {
      const key = findHref(row, /\d+/) || stripHtml(row).slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    console.log(`${pathname} ${range.startDate}~${range.endDate}: ${rangeRows.length} rows`);
  }
  return rows;
}

async function fetchLawmakingRowsSequential(
  pathname: string,
  rowPattern: RegExp,
  query: Record<string, string> = {},
  readReferenceDate?: (row: string) => string | undefined,
  stopWhenPageBeforeSince = false
): Promise<string[]> {
  const rows: string[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= lawmakingMaxPages; page += 1) {
    const pageRows = await fetchLawmakingRowsPage(pathname, rowPattern, query, page);
    if (pageRows.length === 0) break;

    let newRows = 0;
    for (const row of pageRows) {
      const key = findHref(row, /\d+/) || stripHtml(row).slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      newRows += 1;
    }

    const pageDates = readReferenceDate ? pageRows.map(readReferenceDate).filter((date): date is string => Boolean(date)) : [];
    const pageIsBeforeSince = Boolean(
      syncSinceDate &&
      stopWhenPageBeforeSince &&
      pageDates.length > 0 &&
      pageDates.every((date) => isBeforeSince(date))
    );

    console.log(`${pathname} page ${page}: ${pageRows.length} rows${pageDates.length > 0 ? `, ${pageDates[0]}~${pageDates.at(-1)}` : ""}`);
    if (newRows === 0 || pageIsBeforeSince) break;
  }

  return rows;
}

async function fetchLawmakingRows(
  pathname: string,
  rowPattern: RegExp,
  query: Record<string, string> = {},
  readReferenceDate?: (row: string) => string | undefined
): Promise<string[]> {
  const rows: string[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= lawmakingMaxPages; page += 1) {
    const pageRows = await fetchLawmakingRowsPage(pathname, rowPattern, query, page);
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
    if (
      syncSinceDate &&
      readReferenceDate &&
      pageRows.every((row) => {
        const rowDate = readReferenceDate(row);
        return rowDate ? isBeforeSince(rowDate) : false;
      })
    ) break;
  }

  return rows;
}

async function fetchLawmakingRowsPage(
  pathname: string,
  rowPattern: RegExp,
  query: Record<string, string>,
  page: number
) {
  const url = new URL(pathname, lawmakingOrigin);
  url.searchParams.set("pageIndex", String(page));
  url.searchParams.set("blockStartPage", String(Math.floor((page - 1) / 10) * 10 + 1));
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const html = await fetchLawmakingPageHtml(url);
  return parseHtmlRows(html).filter((row) => rowPattern.test(row));
}

async function fetchLawmakingPageHtml(url: URL) {
  return withRetry(async () => {
    const html = await fetchText(url);
    if (/404 \(페이지 없음\)|요청페이지가 없습니다/.test(html)) {
      throw new Error(`${url.pathname} 목록 페이지가 404 안내를 반환했습니다.`);
    }
    return html;
  }, `${url.pathname}${url.search}`);
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

function filterBillsSince(bills: Bill[]) {
  if (!syncSinceDate) return bills;
  return bills.filter((bill) => isInSyncRange(referenceDate(bill)));
}

function preserveFailedSourceBills(fetchedBills: Bill[], previousBills: Bill[]) {
  if (failedBillSources.size === 0) return fetchedBills;
  const previousToKeep = previousBills.filter((bill) =>
    failedBillSources.has(bill.source) &&
    (!syncSinceDate || isInSyncRange(referenceDate(bill)))
  );
  if (previousToKeep.length > 0) {
    console.warn(`수집 실패한 출처의 기존 데이터 ${previousToKeep.length}건을 유지했습니다.`);
  }
  return [...previousToKeep, ...fetchedBills];
}

function referenceDate(bill: Bill) {
  if (bill.source === "government_notice" || bill.source === "government_pre_submit") {
    return bill.noticeStartDate;
  }
  return bill.proposedDate;
}

function readAssemblyStatusReferenceDate(row: string) {
  return readDates(readCellText(row, "제안자(제안일자)"))[0];
}

function readGovernmentNoticeReferenceDate(row: string) {
  return readDates(readCellText(row, "입법의견 접수기간"))[0];
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

function normalizeBillTitleForMatch(value: string) {
  return normalizeTitle(value)
    .replace(/일부개정법률안$/, "")
    .replace(/전부개정법률안$/, "")
    .replace(/제정법률안$/, "")
    .replace(/개정법률안$/, "")
    .replace(/법률안$/, "법률")
    .replace(/안$/, "");
}

function matchKey(title: string, ministry?: string) {
  return `${normalizeBillTitleForMatch(title)}:${normalizeTitle(ministry ?? "")}`;
}

async function loadGovernmentProgressNoticePeriod(officialUrl: string): Promise<{ startDate?: string; endDate?: string }> {
  try {
    const detailUrl = officialUrl.endsWith("/detailRP") ? officialUrl : `${officialUrl.replace(/\/$/, "")}/detailRP`;
    const html = await fetchText(new URL(detailUrl));
    const pageText = stripHtml(html);
    const match = pageText.match(/입법현황\s*입법예고\s*\(([^)]+)\)/);
    const dates = readDates(match?.[1] ?? "");
    return {
      startDate: dates[0],
      endDate: dates[1]
    };
  } catch (error) {
    console.warn(`정부입법현황 입법예고 기간 확인 실패: ${officialUrl} - ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

function sinceDateQuery<T extends Record<string, string> & { dateStartKey?: string; dateEndKey?: string }>(
  query: T
): Record<string, string> {
  if (!syncSinceDate) return withoutDateKeys(query);
  return dateRangeQuery(query, { startDate: syncSinceDate, endDate: syncUntilDate });
}

function dateRangeQuery<T extends Record<string, string> & { dateStartKey?: string; dateEndKey?: string }>(
  query: T,
  range: DateRange
): Record<string, string> {
  const { dateStartKey, dateEndKey, ...rest } = query;
  const next: Record<string, string> = { ...rest };
  if (dateStartKey) next[dateStartKey] = formatDateQuery(dateStartKey, range.startDate);
  if (dateEndKey) next[dateEndKey] = formatDateQuery(dateEndKey, range.endDate);
  return next;
}

function withoutDateKeys<T extends Record<string, string> & { dateStartKey?: string; dateEndKey?: string }>(
  query: T
): Record<string, string> {
  const { dateStartKey: _dateStartKey, dateEndKey: _dateEndKey, ...rest } = query;
  return rest;
}

function isBeforeSince(value?: string) {
  return Boolean(syncSinceDate && value && Date.parse(value) < Date.parse(syncSinceDate));
}

function isOnOrAfterSince(value?: string) {
  return Boolean(value && syncSinceDate && Date.parse(value) >= Date.parse(syncSinceDate));
}

function isInSyncRange(value?: string) {
  return Boolean(
    value &&
    syncSinceDate &&
    Date.parse(value) >= Date.parse(syncSinceDate) &&
    Date.parse(value) <= Date.parse(syncUntilDate)
  );
}

function formatDateQuery(key: string, value: string) {
  return compactDateSources.has(key) ? value.replace(/[^\d]/g, "") : value;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildDateRanges(startDate: string, endDate: string, chunkDays: number): DateRange[] {
  const ranges: DateRange[] = [];
  let cursor = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  while (cursor.getTime() <= end.getTime()) {
    const rangeStart = cursor;
    const rangeEnd = minDate(addDays(rangeStart, chunkDays - 1), end);
    ranges.push({
      startDate: formatDateOnly(rangeStart),
      endDate: formatDateOnly(rangeEnd)
    });
    cursor = addDays(rangeEnd, 1);
  }

  return ranges;
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function minDate(left: Date, right: Date) {
  return left.getTime() < right.getTime() ? left : right;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

async function withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount) break;
      console.warn(`${label} 요청 실패, ${attempt}/${retryCount} 재시도 예정: ${error instanceof Error ? error.message : String(error)}`);
      await delay(retryDelayMs);
    }
  }
  throw lastError;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function readNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

type DateRange = {
  startDate: string;
  endDate: string;
};

type GovernmentSummarySource = {
  externalId: string;
  title: string;
  ministry: string;
  url: string;
};

type GovernmentSummarySources = {
  byTitleAndMinistry: Map<string, GovernmentSummarySource>;
  byTitle: Map<string, GovernmentSummarySource>;
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
