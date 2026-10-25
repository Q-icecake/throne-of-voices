import type { CharacterId, ClockState, PublicDocument, TestAction } from '../shared/contracts.ts';

export interface WorldState {
  schemaVersion: 1;
  scenario: 'm0-fixture-v1';
  sessionId: string;
  revision: number;
  clock: ClockState;
  player: { name: string; locationLabel: string };
  characters: {
    id: CharacterId; name: string; role: string; location: string; available: boolean;
    privatePerspective: string;
  }[];
  resources: { grain: number; treasury: number };
  diplomacy: { requests: { id: string; status: 'pending' | 'answered' }[] };
  navy: { readiness: number; engagementPolicy: 'hold' };
  documents: (PublicDocument & { readers: ('player' | CharacterId)[] })[];
  hidden: { marker: string; enemyTroops: number; enemyIntent: string };
}

export interface EventRecord {
  id: string;
  atActiveMs: number;
  kind: 'reset' | TestAction['type'];
  summary: string;
  cause: TestAction | null;
  fromRevision: number;
  toRevision: number;
}

/** Fixed synthetic fixture, not researched historical data. Never served as an asset. */
export function createInitialWorld(clock: ClockState): WorldState {
  return {
    schemaVersion: 1,
    scenario: 'm0-fixture-v1',
    sessionId: 'm0-local-session',
    revision: 0,
    clock,
    player: { name: '손권', locationLabel: '강동 · 시험용 집무실' },
    characters: [
      { id: 'zhang-hong', name: '장굉', role: '보좌', location: 'office', available: true, privatePerspective: 'PRIVATE_ADVISER_FIXTURE' },
      { id: 'zhang-zhao', name: '장조', role: '내정', location: 'residence', available: true, privatePerspective: 'PRIVATE_CIVIL_FIXTURE' },
      { id: 'zhou-yu', name: '주유', role: '군사', location: 'naval-base', available: true, privatePerspective: 'PRIVATE_NAVAL_FIXTURE' },
      { id: 'lu-su', name: '노숙', role: '외교', location: 'residence', available: true, privatePerspective: 'PRIVATE_DIPLOMATIC_FIXTURE' },
    ],
    resources: { grain: 1000, treasury: 500 },
    diplomacy: { requests: [] },
    navy: { readiness: 20, engagementPolicy: 'hold' },
    documents: [
      {
        id: 'm0-public-note', title: '시험용 집무 기록',
        claim: '집무실 화면과 보고 전달 경로를 점검하기 위한 문서입니다. 아직 명령을 실행하거나 역사 사건을 진행하지 않습니다.',
        source: 'M0 시험 자료', observedAtMs: 0, arrivedAtMs: 0,
        evidence: '실행 환경 점검용', region: '강동', provenance: 'test-reconstruction',
        readers: ['player', 'zhang-hong'],
      },
      {
        id: 'm0-private-note', title: 'PRIVATE_REPORT_FIXTURE', claim: 'UNRELEASED_NAVAL_REPORT',
        source: '서버 내부 시험 자료', observedAtMs: 0, arrivedAtMs: 0,
        evidence: '비공개 경계 점검용', region: '강동', provenance: 'test-reconstruction',
        readers: ['zhou-yu'],
      },
    ],
    hidden: { marker: 'SERVER_ONLY_M0_SENTINEL', enemyTroops: 987654, enemyIntent: 'PRIVATE_ENEMY_INTENT' },
  };
}
