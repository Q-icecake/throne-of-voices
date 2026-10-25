# 구조 (코드 지도)

```
브라우저 (client/, Vite)  ──HTTP──▶  로컬 Node 서버 (server/)  ──▶  LLM 공급자 (server/llm/)
 장면·HUD·명령창·패널                 규칙 엔진 + 세계 상태              mock / gemini / openai-compatible / ollama
```

| 폴더 | 역할 |
| --- | --- |
| `shared/` | 클라이언트·서버가 함께 쓰는 계약 타입 (`contracts.ts`) |
| `server/` | 게임 규칙. `engine.ts`(상태 전이), `world.ts`·`rules.ts`(세계·규칙), `characters.ts`·`knowledge.ts`(인물·지식 경계), `compound.ts`(복합 명령 분절), `mock-interpreter.ts`(키 없는 해석기), `opening.ts`·`clock.ts`(오프닝 사건·시계), `http.ts`·`index.ts`(API) |
| `server/llm/` | 공급자 계층. `provider.ts`·`pipeline.ts`(해석 흐름), `validator.ts`·`claims.ts`(제안 검증·허위 완료 방어), `gemini*.ts`·`ollama.ts`·`openai-compatible.ts`(어댑터), `config.ts`·`runtime-settings.ts`(설정), `budget.ts`·`pacer.ts`(일일/세션/분당 제한), `network*.ts`(VPN·프록시 경로), `secrets.ts`(키 반사 방어), `system.ko.txt`·`actions.json`·`output.schema.json`(프롬프트·스키마). 상세: `server/llm/README.md` |
| `client/` | 화면. `src/main.ts`, `src/ui/panels.ts`, CSS, SVG 아트 슬롯 |
| `content/` | 오프닝 시나리오 데이터 (사건·문서·요청) |
| `scripts/` | `dev.ts`(개발 서버), `eval-llm.ts`(평가 CLI), `eval/`(채점·비교), `verify-*.ts`(브라우저 검증), `playthrough.ts`·`soak.ts` |
| `tests/` | `node --test` 테스트와 `fixtures/`(평가 세트 `eval-dev.json`, `eval-final.json` 등) |
| `docs/` | 기능별 문서 |
| `artifacts/` | **실행 결과물 (git 제외)**: 스크린샷, 평가 결과, 사용량·진단 파일 |
| `.codex-runs/` | Codex 작업 보고서(역사 기록) |

## 핵심 원칙

1. **LLM은 제안만 한다.** 제안(JSON)은 스키마 → validator → 엔진 규칙을 통과해야 실행되며, 사용자가 초안을 확인한 뒤에만 반영된다.
2. **기본은 Mock.** 키·네트워크 없이 모든 흐름이 돈다. 실패 시 자동으로 Mock으로 바꾸지 않고 입력을 보존한다.
3. **요청당 재시도 0.** 사용자 조작 한 번에 외부 요청 한 번. 비용·한도 안전장치(일일/세션/RPM/TPM)가 항상 앞에 있다.
4. **키는 메모리·헤더에만.** 모델 입력에 넣지 않고, 응답에 반사되면 차단한다.
5. **평가 세트 분리.** dev만 채점·튜닝, final은 손대지 않는다.
