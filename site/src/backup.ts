// 이 브라우저에 쌓인 것을 파일 한 장으로 옮기는 층.
//
// 이 계산기는 **서버에 아무것도 안 남긴다.** 편성도 육성도 프리셋도 전부 브라우저
// 저장소에 있고, 그래서 브라우저를 갈아타거나 저장소를 지우면 그대로 사라진다 —
// 되찾을 길이 없었다. 그 길을 낸다.
//
// 담는 것은 **사람이 손으로 쌓은 것**이다. 다시 계산하면 나오는 것(결과 캐시)과
// 이 브라우저에서만 뜻이 있는 것(접속 표식·공지를 봤는지)은 담지 않는다 — 남의
// 기계에 부으면 틀린 뜻이 되거나 파일만 키운다.

/** 백업에 담는 저장 열쇠. **새 열쇠를 만들면 여기에 더한다** — 안 더하면 조용히 안 실린다. */
export const BACKUP_KEYS = [
  'nikke-state-v1',                  // 편성·개별 설정·전투 조건
  'nikke-roster-v1',                 // 불러온 육성(블라블라링크·CSV)
  'nikke-roster-source-v1',          // 그 육성을 어디서 불러왔나
  'nikke-custom-v1',                 // 직접 추가한 니케
  'nikke-presets-v1',                // 이름 붙여 저장한 편성
  'nikke-history-v1',                // 계산 기록
  'nikke-compare-decks-v1',          // 덱끼리 견주기에 담아 둔 것
  'nikke-boss-library-v1',           // 보스 메이커 서랍
  'nikke-boss-design-v1',            // 보스 메이커 작업본
  'nikke-abbrev-book-v1',            // 약어 사전
  'nikke-abbrev-mine-v1',            // 내가 등록한 약어
  'nikke-enikk-v2',                  // ENIKK 조합 가져오기
  'nikke-enikk-excluded-v1',
  'nikke-blabla-profile-v1',         // 지난번 블라블라링크 주소
  'nikke-lang-v1',                   // 고른 언어
  'nikke-parallel-v1',               // 병렬 계산 설정
  'nikke-vision-pack',               // 재미용 기능 토글
  'nikke-portrait-badges-v1',
  'nikke-detail-damage-v1',
] as const;

/**
 * 일부러 **안** 담는 열쇠와 그 까닭. 목록으로 남겨 두는 것은, 다음에 볼 사람이
 * 「빠뜨렸나?」를 다시 따지지 않게 하기 위함이다.
 *
 * * `nikke-calc-results` — 결과 캐시. 다시 돌리면 나온다. 제일 큰 덩어리다.
 * * `nikke-presence-tag` — 이 탭 하나의 접속 표식. 옮기면 접속자 수가 겹쳐 세어진다.
 * * `nikke-notice-seen` · `nikke-announcement-seen` · `nikke-overload-lines-notice-v1`
 *   · `nikke-boss-callout-hidden` — 「이 안내를 봤나」. 새 기계에서는 새로 보는 게 맞다.
 * * `nikke-feedback-admin` — 관리자 열쇠. 파일에 담아 돌릴 것이 아니다.
 */
export const BACKUP_SKIPPED = [
  'nikke-calc-results', 'nikke-presence-tag', 'nikke-notice-seen',
  'nikke-announcement-seen', 'nikke-overload-lines-notice-v1',
  'nikke-boss-callout-hidden', 'nikke-feedback-admin',
] as const;

/** 파일 맨 앞에 적는 표식. 남의 JSON을 잘못 부었을 때 이걸로 걸러 낸다. */
export const BACKUP_KIND = 'nikke-calc-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: number;
  /** 언제 뜬 것인가. 파일이 여러 장 쌓였을 때 사람이 고르는 기준이다. */
  savedAt: string;
  /** 저장 열쇠 → 그때의 값(문자열 그대로). 해석하지 않는다 — 판본이 바뀌어도 그대로 옮긴다. */
  data: Record<string, string>;
}

/**
 * 지금 저장소를 파일 한 장으로. 비어 있는 열쇠는 담지 않는다 — 「없음」을 옮겨 봐야
 * 받는 쪽에서 지우는 일밖에 안 된다.
 */
export function buildBackup(
  read: (key: string) => string | null,
  now: Date = new Date(),
): BackupFile {
  const data: Record<string, string> = {};
  for (const key of BACKUP_KEYS) {
    let value: string | null = null;
    try {
      value = read(key);
    } catch {
      // 못 읽는 열쇠는 건너뛴다 — 한 칸 때문에 백업 전체를 잃지 않는다.
    }
    if (value !== null && value !== '') data[key] = value;
  }
  return { kind: BACKUP_KIND, version: BACKUP_VERSION, savedAt: now.toISOString(), data };
}

/** 백업 파일 이름. 날짜가 들어가야 여러 장을 구분한다. */
export const backupFileName = (at: Date = new Date()): string => {
  const stamp = [at.getFullYear(), at.getMonth() + 1, at.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0'))).join('');
  return `니케계산기_백업_${stamp}.json`;
};

/**
 * 받은 파일을 읽는다. 모양이 아니면 **왜 아닌지** 적어 던진다 — 「불러오기 실패」
 * 한 줄로는 사람이 다음에 무엇을 할지 알 수 없다.
 *
 * 모르는 열쇠는 **버린다.** 이 파일은 남이 준 것일 수도 있어서, 저장소에 아무 열쇠나
 * 쓰게 두지 않는다.
 */
export function readBackup(text: string): { data: Record<string, string>; skipped: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('백업 파일을 읽지 못했습니다. 내려받은 JSON 파일을 그대로 골라 주세요.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('백업 파일의 모양이 아닙니다.');
  }
  const file = parsed as Partial<BackupFile>;
  if (file.kind !== BACKUP_KIND) {
    throw new Error('이 계산기의 백업 파일이 아닙니다. 조합 코드(NK2-…)나 CSV는 각자 제자리에서 불러와 주세요.');
  }
  if (!file.data || typeof file.data !== 'object') {
    throw new Error('백업 파일에 담긴 내용이 없습니다.');
  }
  const allowed = new Set<string>(BACKUP_KEYS);
  const data: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(file.data)) {
    if (typeof value !== 'string') continue;
    if (allowed.has(key)) data[key] = value;
    else skipped.push(key);
  }
  if (Object.keys(data).length === 0) {
    throw new Error('백업 파일에서 되살릴 것을 찾지 못했습니다.');
  }
  return { data, skipped };
}

/** 백업 한 장을 저장소에 붓는다. 담긴 열쇠만 덮어쓰고 나머지는 건드리지 않는다. */
export function applyBackup(
  data: Record<string, string>,
  write: (key: string, value: string) => void,
): number {
  let done = 0;
  for (const [key, value] of Object.entries(data)) {
    try {
      write(key, value);
      done += 1;
    } catch {
      // 저장소가 꽉 찼으면 그 열쇠만 못 들어간다 — 나머지는 계속 붓는다.
    }
  }
  return done;
}
