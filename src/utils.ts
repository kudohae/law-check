import type { Bill } from "./types";

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}「」『』·ㆍ.,]/g, "");
}

export function formatDate(value?: string) {
  if (!value) return "날짜 미확인";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function getBillDate(bill: Bill) {
  return bill.proposedDate ?? bill.noticeStartDate ?? bill.lastUpdatedAt ?? bill.updatedAt;
}

export function getBillOwner(bill: Bill) {
  return bill.proposerName ?? bill.ministry ?? bill.committee ?? "주체 미확인";
}
