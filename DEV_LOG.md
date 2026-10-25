# Development Log

## 2026-10-25 — J04 / 004 M1 보완

- 범위: 독립 리뷰 1~5번. 손권과 좌석의 카메라를 공유하고, 지도 패널을 1000:300 콘텐츠 높이에 맞췄다. 1366 명령 카드의 간격을 줄여 확인·수정·취소와 보존 안내를 함께 표시한다. 장굉의 왼쪽 전경 위치를 유지하며 CSS 대비·그림자와 이름표 간격만 조정했다.
- 검증 강화: 실제 패널 사각형을 제외한 노출 영역에서 장면 버튼을 검사한다. HUD/패널/합집합 화면 점유율을 분리 기록한다. 공개 문서 ID·본문·작업 ID·완료 시각을 비교하고 두 번째 작업의 최신 완료 보고까지 확인한다.
- 첫 실행에서 이전 전경 이동이 문서 버튼을 화면 밖으로 밀어내는 문제와 1366 지도 설명의 미세 스크롤을 발견했다. 전경 확대를 1.03으로 제한하고 지도 설명 기본 여백을 제거한 뒤 재검증했다. 기존 테스트는 삭제·완화하지 않았다.
- 실제 통과: `node node_modules/typescript/bin/tsc --noEmit`; `node --test tests/*.test.ts` 32/32; `node node_modules/vite/bin/vite.js build`; `node scripts/screenshots.ts --out artifacts/m1-fixes` 12/12; `node scripts/verify-visual.ts --out artifacts/m1-fixes` 16개 검사 묶음; `git -c safe.directory=C:/Users/q_ice/dispatch-work/throne-integrate diff --check`.
- Edge 155.0.4283.62 headless, 1920×1080·1366×768. 입력→확인 2회→60초 진행→보고에서 작업 1건·군량 -100·준비도 +15. 수군 표식은 report-0002/task-0001 이후 report-0004/task-0002를 연다. 전체 패널과 접견에서 좌석 기준 오차 <0.01px. 실패 이미지 대체 표시도 통과.
- 스크린샷 12장과 실패 자산/보고 캡처 4장, `metrics.json`, `browser-checks.json`, `build.log`: `artifacts/m1-fixes/`. 새 12장 모두 시각 확인. 이전 `artifacts/m1-integrated/`와 비교해 1920 지도 하단 빈 공간이 제거되고 1366 명령 보존 안내가 노출됨을 확인했다.
- 측정: S0 상시 HUD 4.2%/8.4%; S4 패널 27.6%/54.6%, HUD 포함 화면 가림 31.9%/62.8% (1920/1366 순). 합집합 면적은 뷰포트 밖과 중복을 제외하며 투명도·그림자는 가중하지 않는다. S1/S5의 장굉·두 소품을 모두 검사하며, 완전히 가려진 1366 S4 장굉만 제외한다.
- 미검증: 실제 IME, 다른 브라우저, 장시간 성능·재미. 1366 문서의 긴 본문/메타데이터는 기존 내부 스크롤을 유지한다. 서버·계약·의존성·SVG 원본·인물 그림체 변경 없음.
- 인계: 시작 HEAD f4ae213, integrate/visual-assets. Git 소유권 차이는 명령별 safe.directory로 처리했으며 전역 설정은 변경하지 않았다. Git 메타데이터가 쓰기 허용 범위 밖인 원본 저장소에 있어 커밋은 차단됨. `_common.md`에 따라 add/commit/push를 시도하지 않았다. 리드가 아래 구현 5개 파일과 이 로그를 검토·커밋해야 한다. 산출물은 기존 .gitignore상 제외된다.
- 구현 파일: `client/src/style.css`, `client/src/panels.css`, `client/src/ui/panels.ts`, `scripts/screenshots.ts`, `scripts/verify-visual.ts`. 상세 인계 보고: `.codex-runs/m1-fixes-report.md`.
