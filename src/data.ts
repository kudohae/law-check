import type { BillDataFile, IssueArchiveIndex, IssueMindmapFile } from "./types";

export async function loadBillData(): Promise<BillDataFile> {
  const response = await fetch("/data/bills.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("법률안 데이터 파일을 불러오지 못했습니다.");
  }
  return response.json() as Promise<BillDataFile>;
}

export async function loadIssueArchiveIndex(): Promise<IssueArchiveIndex> {
  const response = await fetch("/data/issues/index.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("시사 이슈 아카이브를 불러오지 못했습니다.");
  }
  return response.json() as Promise<IssueArchiveIndex>;
}

export async function loadIssueMindmap(path: string): Promise<IssueMindmapFile> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("시사 이슈 마인드맵을 불러오지 못했습니다.");
  }
  return response.json() as Promise<IssueMindmapFile>;
}
