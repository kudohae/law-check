import type { BillSource, BillStage } from "./types";

export const sourceLabels: Record<BillSource, string> = {
  assembly_member: "국회의원 발의 법률안",
  assembly_government: "정부 제출 법률안",
  government_pre_submit: "정부입법현황",
  government_notice: "정부입법예고"
};

export const stageLabels: Record<BillStage, string> = {
  drafting: "정부 준비",
  pre_announcement: "입법예고",
  submitted_to_assembly: "국회 제출",
  committee_review: "위원회 심사",
  plenary_review: "본회의 심의",
  passed: "가결",
  rejected: "부결",
  withdrawn: "철회",
  promulgated: "공포",
  unknown: "확인 필요"
};

export const stageOptions = Object.entries(stageLabels).map(([value, label]) => ({
  value,
  label
}));
