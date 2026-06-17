import type { BillDataFile } from "./types";

export async function loadBillData(): Promise<BillDataFile> {
  const response = await fetch("/data/bills.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("법률안 데이터 파일을 불러오지 못했습니다.");
  }
  return response.json() as Promise<BillDataFile>;
}
