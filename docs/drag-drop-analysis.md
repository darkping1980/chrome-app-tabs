# 드래그 앤 드롭 분석 및 v0.3.3 개선 (Drag-and-drop analysis and v0.3.3 changes)

> **English summary.** In v0.3.2, dragging a program window onto Chrome often needed a second try. Real-use logs and
> isolated experiments showed four causes. (1) The host located the tab strip with UI Automation
> (`FindFirst(ControlType.Tab)`). Once Chrome's web accessibility tree was on, that query returned the *web page's*
> ARIA tablist, which put the drop zone over the page. (2) Dragging a window snapped by Windows was classified as a
> resize. (3) On a maximized Chrome the usable zone was only ~33 px tall, and it overlapped Windows Snap, whose layouts
> bar could take the drop and leave the window snapped. (4) The decision used the cursor position when the event was
> *handled*, not when the button was *released*.
> v0.3.3 makes these changes:
> - The drop zone is Chrome's own UI above the page (tab strip + address bar + bookmarks bar), measured from plain
>   window geometry. No UI Automation is used.
> - The host tells moves from resizes using a hit test plus the window's behaviour.
> - The host stays out of Windows Snap areas.
> - A drop is judged at the exact release point: the system mouse-move history at the release time, or the grab offset.
> - The original position is taken at the moment the button is pressed, before Windows moves the window.
> - The highlight has hysteresis.
> - Snapped windows return to their snapped rectangle when their tab is closed.

이 문서는 v0.3.2 실사용 중 "프로그램 창을 Chrome 탭 표시줄로 끌어도 한 번에 추가되지 않는다"는 문제의 원인 분석과
v0.3.3 개선 내용을 기록합니다. 로그 인용에서 창 제목, 파일명, 창 핸들, 사용자 경로는 모두 제거했습니다.

## 1. v0.3.2 동작 흐름

1. `SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART/END, OUTOFCONTEXT)`으로 모든 창의 이동/크기 조절 시작과 끝을 받습니다.
2. 시작 시 후보 창인지 확인하고(이미 탭인 창 제외), 30 ms 타이머로 커서를 확인합니다.
3. 타이머마다 다음을 확인합니다.
   - 창 크기가 바뀌면 "크기 조절"로 판정하고, 이 판정은 드래그가 끝날 때까지 유지됩니다.
   - 커서 아래 최상위 창이 Chrome인지 봅니다.
   - 커서가 화면 맨 위 8 px 안이면 Snap 영역으로 보고 거부합니다.
   - 탭 표시줄 영역은 **UI Automation `FindFirst(Descendants, ControlType.Tab)`**으로 찾고, 실패하면 기하 추정(창 위쪽 41 px)을 씁니다.
4. 끝 이벤트를 처리할 때 **그 시점의** `GetCursorPos`가 영역 안이고 마지막 타이머가 대상을 기록했으면 `dropAdd`를 보냅니다.
5. 확장 프로그램은 일반 추가 경로(중복 검사 포함)를 그대로 사용합니다.

## 2. 실사용 로그 분석 (v0.3.2, 드래그 64건)

| 결과 | 건수 | 분류 |
|---|---:|---|
| 정상 추가 | 25 | |
| 정상 추가, 그러나 드롭 영역이 웹페이지의 tablist (페이지 본문에 놓아서 추가됨) | 5 | 드롭 영역 오인 (오탐) |
| 실패: 드롭 영역 = 웹페이지 tablist (예: `[8,184,1770,976]`) | 8 | 드롭 영역 인식 실패 |
| 실패: `resizing` (대부분 첫 판정 30–60 ms 안에 결정 = 스냅된 창을 끌 때 크기 복원) | 8 | 이동/크기 조절 오판 |
| 실패: `snap edge` (y < 8) | 1 | 최대화 Chrome 상단 |
| 실패: 탭 표시줄에서 놓았으나 최종 검사 거부 (Windows Snap 레이아웃이 먼저 적용됨) | 1 | Snap 충돌 |
| 탭 표시줄에 닿기 전에 놓음 (짧은 클릭 포함) | 11 | 의도 불명 |
| Chrome 밖에서 놓음 | 5 | 일반 창 이동 |

`dropAdd` 이후 단계(확장 → 탭 생성 → 연결)의 실패는 0건이었습니다. 문제는 모두 드래그 판정과 드롭 영역 인식에 있었습니다.

대표적인 연쇄 실패는 다음과 같았습니다. 탭 표시줄에서 놓았지만 Windows 11 Snap 레이아웃 막대가 창을 먼저 배치했습니다.
그 결과 드롭이 거부되었고 창은 스냅 상태가 되었습니다. 다음 드래그에서는 Windows가 창 크기를 복원하므로 `resizing`으로 거부되었고,
세 번째 시도에서야 추가되었습니다.

## 3. 원인

### R1. UI Automation이 웹페이지의 탭 목록을 탭 표시줄로 오인 (가장 큰 원인)

`FindFirst(TreeScope.Descendants, ControlType.Tab)`는 트리 순서상 웹 콘텐츠(`MultiContentsView > … > Document`)의
`role="tablist"`를 Chrome의 `TabContainer`보다 먼저 찾습니다. 격리 Chrome에서 재현한 결과는 다음과 같습니다.

| 질의 | 결과 |
|---|---|
| 1회차 `FindFirst` | `TabContainer` (정상): 아직 웹 접근성 트리가 없음 |
| `FindAll` | `[웹 tablist, TabContainer]` 순서 |
| 2회차 `FindFirst` | 웹 tablist (페이지 본문 위치) |

즉 **호스트 자신의 첫 UIA 질의가 Chrome 웹 접근성 트리를 켜고**, 그 뒤에는 탭 목록이 있는 페이지(문서 사이트, 저장소 사이트 등)에서
드롭 영역이 페이지 본문으로 잡혔습니다. 검증 조건(높이 > 10, 창 안)으로는 걸러지지 않았습니다.
그래서 진짜 탭 표시줄에 놓으면 실패하고, 본문에 놓으면 추가되었습니다. 파란 표시도 본문 위에 크게 나타났습니다.
부수적으로, 질의가 웹 콘텐츠 트리 전체를 순회하므로 느리고 Chrome의 접근성 모드를 켜는 부작용도 있었습니다.

### R2. 스냅된 창은 항상 "크기 조절"로 판정
Windows는 스냅된 창을 끌기 시작하면 스냅 전 크기로 복원합니다. v0.3.2는 최대화만 예외로 처리했습니다.
그래서 첫 판정에서 크기 변화를 보고 크기 조절로 확정했고, 이 판정은 드래그가 끝날 때까지 풀리지 않았습니다.

### R3. 최대화 Chrome과 Windows Snap 영역이 겹침
최대화 Chrome의 탭 표시줄은 y = 0–41입니다. 맨 위 8 px를 Snap용으로 제외하면 목표 높이는 33 px뿐입니다.
또 화면 상단에 닿으면 열리는 Windows 11 Snap 레이아웃 막대 위에서 놓으면 Windows가 창을 배치합니다.

### R4. 놓은 순간이 아니라 처리 시점의 커서로 판정
- 끝 이벤트 처리 시점에 커서를 다시 읽으므로, 놓자마자 마우스를 움직이면 영역 밖으로 판정될 수 있었습니다.
- 대상은 30 ms 타이머에서만 정해졌고, 처음 Chrome 위로 올라갈 때 UIA를 동기로 호출했습니다(30–120 ms).
  이 때문에 빠른 드래그에서는 대상이 비어 있을 수 있었습니다.

### R5. UIA 호출 중 타이머 재진입 (로그상 추정)
같은 드래그 안에서 판정 결과가 1–3 ms 간격으로 뒤바뀌는 기록이 있었습니다. 경계에서 깜빡임을 막는 히스테리시스도 없었습니다.

### v0.3.3 개발 중 추가로 확인한 점
- **이동 루프 시작 시점.** Windows는 제목 표시줄을 누른 뒤 마우스가 드래그 임계값을 넘어야 이동 루프를 시작합니다.
  그래서 시작 이벤트 시점의 커서는 실제로 잡은 지점에서 이미 몇 px 이동해 있습니다.
  - 실측에서 약 10 px 어긋났습니다. 이 지점으로 `WM_NCHITTEST`를 하면 바로 위의 창 테두리(`HTTOP`)가 나와 이동을 크기 조절로 오판했습니다.
  - v0.3.3은 실제 동작을 우선합니다. 크기는 그대로이고 위치만 바뀌면 이동입니다.
  - 놓은 지점은 정지 상태에서 잰 오프셋이나, 버튼을 뗀 시각의 시스템 마우스 이동 기록으로 정합니다.

## 4. 대안 비교

| 방식 | 장점 | 단점 | 판단 |
|---|---|---|---|
| A. v0.3.2: MOVESIZE WinEvent + 폴링 + UIA | 비침투, Snap 무간섭 | R1–R5 | 골격 유지 |
| B. 드롭 영역 = 웹 콘텐츠 창(`Chrome_RenderWidgetHostHWND`) 위쪽 전체 (기하) | UIA 불필요, 목표 높이 확대(33 px → 약 70–110 px), 접근성 부작용 없음 | 주소창 줄에 놓아도 추가됨(의도에 부합), 전체 화면(F11)에서는 영역 없음 | **채택** |
| C. UIA 유지 + 검색 범위 제한 | 탭 표시줄만 정확히 | Chrome 내부 클래스명 의존, 비용 | 미채택 |
| D. 드래그 중에만 전역 마우스 훅(`WH_MOUSE_LL`) | 정확한 버튼 해제 위치 | 전역 입력 경로에 개입, 보안 제품 오탐 | 미채택 (마우스 이동 기록으로 대체) |
| E. 이동 루프 가로채기 / 코드 주입 | 완전 제어 | 프로젝트 원칙(비주입) 위반, Snap 손상 | 배제 |
| F. 수식키로 Chrome 전체를 드롭 영역으로 | 일반 이동과 확실히 구분 | 학습 필요, 다른 도구와 키 충돌 | 이번 버전 제외 |
| G. 머무름(dwell) 확인 | 오탐 감소 | 빠른 사용자 불편 | 미채택 (히스테리시스로 대체) |

## 5. v0.3.3 구현

| 항목 | 내용 |
|---|---|
| 드롭 영역 | 창 위쪽(최대화 시 모니터 위쪽)부터 웹 콘텐츠 창 위쪽까지. 탭 표시줄, 주소창/툴바, 북마크바를 포함합니다. 좌우 프레임과 오른쪽 캡션 버튼(150 DIP)은 제외합니다. 값이 브라우저 UI처럼 보이지 않으면(24–220 DIP 범위 밖) 탭 표시줄만(41 DIP) 씁니다. UIA는 쓰지 않습니다. 영역은 드래그마다 Chrome 창별로 캐시하고, 창 위치가 바뀌면 다시 계산합니다. |
| Snap 공존 | 모니터 맨 위 `max(8 px, 8 DIP)`는 Windows에 양보합니다. 커서가 그 가장자리에 닿으면 Snap 레이아웃 막대가 열릴 수 있으므로, 커서가 위쪽 120 DIP를 벗어날 때까지 그 구역에서는 드롭을 받지 않습니다. 사용자의 Snap 설정(`WindowArrangementActive`, `EnableSnapBar`)은 **읽기만** 하고 변경하지 않습니다. 놓는 순간 Windows가 창을 최대화하거나 배치하거나 크기를 바꾸면 드롭하지 않습니다. |
| 이동/크기 조절 판별 | 마우스를 누른 순간(`EVENT_SYSTEM_CAPTURESTART`)의 지점으로 `WM_NCHITTEST`를 보냅니다(`SendMessageTimeout` 50 ms, 창의 DPI 좌표로 변환). 판별 결과와 실제 동작이 다르면 동작을 우선합니다. 위치만 바뀌면 이동이고, 크기가 계속 바뀌면 크기 조절입니다. 스냅 해제나 DPI 변경으로 인한 크기 변화는 몇 번까지 허용합니다. |
| 놓은 지점 판정 | 우선순위는 ① 버튼을 뗀 시각의 시스템 마우스 이동 기록(`GetMouseMovePointsEx`, 놓인 창 위에 있고 오프셋 추정치와 64 px 이내일 때만), ② 창이 움직인 **뒤** 창과 커서가 정지한 상태에서 잰 잡은 지점 오프셋, ③ 마우스를 누른 순간의 오프셋입니다. 셋 다 없으면 지금 커서와 마지막 샘플이 **모두** 같은 영역 안에 있고 커서가 놓인 창 위에 있을 때만 인정합니다. 최근에 영역을 지나갔다는 사실만으로는 인정하지 않습니다. |
| 파란 표시 | 15 ms 샘플링, 블로킹 호출 없음. 영역에 들어가면 즉시 표시하고, 경계에서 한 번 벗어난 것은 무시합니다(12 DIP 여유, 연속 2회 이탈 시 숨김). 다른 DPI 모니터로 이동할 때 `WM_DPICHANGED`로 위치가 바뀌지 않게 막습니다. |
| 좌표 | 호스트는 Per-Monitor v2입니다. 모든 좌표는 물리 픽셀이고, 배율은 창/모니터별 DPI로 계산합니다. 음수 좌표 모니터와 위치가 어긋난 모니터 배치를 지원합니다. |
| 원래 위치 복원 | 마우스를 누른 순간(이동 루프가 창을 움직이기 전)의 `WINDOWPLACEMENT`와 실제 화면 사각형을 저장합니다. 스냅된 창은 placement의 "normal" 사각형이 스냅 전 크기이므로, 탭을 닫으면 실제 사각형(스냅 위치)으로 되돌립니다. 저장된 사각형이 어느 모니터에도 없으면 placement만 적용합니다. 상태 파일에도 저장하므로 watchdog 복원에도 적용됩니다. 누름 기록은 캡처가 끝난 직후(500 ms 이내) 이동 루프가 시작된 경우에만 사용합니다. |
| 유지 | 이미 탭인 창 무시(중복 방지), Esc 취소, `dropAdd` → 확장의 일반 추가 경로, 드래그 기능 끄기 설정 |

판정 로직은 Win32 호출 없이 `host/DropLogic.cs`에 분리했고, 단위 테스트는 `tests/unit/`에 있습니다.

## 6. 테스트

- 단위 테스트: `powershell -File tests\unit\run.ps1` (화면·마우스·키보드를 쓰지 않음)
- 실제 입력 테스트: `node tests\drag_test.mjs <workDir> [rounds]`. 격리 Chrome(임시 프로필, DEV 호스트), 테스트 창, 격리 VS Code,
  메모장(임시 파일), DBeaver(별도 작업공간)를 사용하며 최대화 Chrome을 중심으로 검사합니다.
- 회귀: `node tests\e2e.mjs <workDir>`, `node tests\compat_test.mjs <workDir>`

### v0.3.3 테스트 결과 (2026-11-26)

- 테스트 PC: Windows 11, Chrome 158, 모니터 3대(모두 100% 배율). 시험 모니터는 위쪽이 6 px 어긋난 보조 모니터입니다.
- 단위 테스트: **46/46 통과**

**실제 입력 테스트 (`drag_test.mjs`, 최종 실행): 검사 42/50 통과**

| 프로그램 | 최대화 Chrome 반복 드롭 | 일반 Chrome 반복 드롭 | 시나리오 M1–M9 |
|---|---|---|---|
| 테스트 창 (WinForms, 표준 제목 표시줄) | **10/10** | **5/5** | 모두 통과 |
| VS Code 1.148 (포터블, 격리) | **10/10** | **5/5** | M8(스냅된 창) 실패, 나머지 통과 |
| DBeaver 26.2 (격리 작업공간) | **10/10** | **5/5** | 모두 통과 |
| Windows 11 메모장 | 0/10 | 0/5 | M5·M6b·M7·M8·M9 통과, M1–M4·M6 실패 |

- 반복 드롭은 탭 추가와 원위치 복원이 **모두** 성공해야 성공으로 셉니다.
- 시나리오 목록: M1 느린 드래그, M2 빠른 드래그, M3 주소창 줄에 놓기, M4 페이지 위에 놓기(추가되지 않아야 함), M5 Esc,
  M6 탭 목록 페이지에서 탭 표시줄에 놓기, M6b 탭 목록 위에 놓기(추가되지 않아야 함),
  M7 화면 맨 위에 닿은 뒤 놓기(추가되지 않아야 함), M8 스냅된 창을 끌어 놓기, M9 위쪽 테두리로 크기 조절(추가되지 않아야 함)
- 다중 모니터: 왼쪽 모니터에서 오른쪽 모니터의 최대화 Chrome으로 드롭하고 원래 모니터로 복원하는 시나리오 통과
- 이미 탭인 프로그램은 다시 끌어도 두 번째 탭이 생기지 않음 (통과)

개발 중 실제 입력 테스트로 찾아 고친 결함:
1. 시작 이벤트를 늦게 처리하면 커서가 이미 창 위쪽 테두리로 이동한 상태라, `HTTOP`이 나와 이동을 크기 조절로 오판했습니다. 이제 실제 동작을 우선합니다.
2. DBeaver(SWT)는 자체 드래그 감지 후 이동을 시작하므로, 창이 움직이기 전에 잰 오프셋이 약 9 px 어긋났습니다.
   이 때문에 놓은 지점을 Snap 가장자리로 잘못 판정했습니다. 이제 창이 움직인 뒤의 정지 샘플과 해제 시각의 마우스 이동 기록만 씁니다.
3. 탭을 닫은 뒤 원위치 복원이 5–20 px 어긋났습니다. Windows는 이동 루프를 시작하면서 창을 바로 움직이므로 placement도 이미 갱신된 상태였습니다.
   이제 마우스를 누른 순간(`EVENT_SYSTEM_CAPTURESTART`)의 위치를 저장합니다.
4. 클릭만 하고 끝난 누름의 기록이 다음 드래그에 쓰일 수 있었습니다. 이제 캡처 종료 직후 이동 루프가 시작된 경우에만 그 누름을 사용합니다.
5. 호스트가 종료될 때 WinEvent/UIA 콜백 때문에 처리되지 않은 예외(0xC0020001)가 났습니다. 창 복원은 이미 끝난 뒤였고, v0.3.2 이전 개발 빌드에도 있던 문제입니다.
   이제 종료 전에 모든 훅과 UIA 핸들러를 해제합니다.

**알려진 문제와 미검증 항목** (실패를 성공으로 처리하지 않았습니다)
- 결함 4와 5는 최종 실제 입력 테스트 **이후에** 고쳤습니다. 단위 테스트와 호스트 단독 실행 종료 확인(종료 코드 0, 오류 이벤트 없음)만 했고, 실제 입력 테스트는 다시 하지 않았습니다.
- **Windows 11 메모장**의 일반 창 드래그(M1–M4·M6, 반복 드롭)는 검증하지 못했습니다.
  테스트 도구가 주입한 마우스 입력으로는 메모장 WinUI 제목 표시줄에서 창 이동 자체가 시작되지 않았습니다(호스트 로그에 드래그 시작 없음).
  스냅된 메모장(M8)은 이동이 시작되어 통과했습니다. 실사용에서 확인이 필요합니다.
- **VS Code M8(스냅된 창)** 실패: 드래그가 시작되지 않았습니다(호스트 로그에 드래그 시작 없음). 반 폭 창에서 테스트가 잡은 위치(폭의 75%)가
  레이아웃 버튼 위였던 것으로 추정되지만 확인하지 못했습니다. 스냅된 창 드래그는 테스트 창, DBeaver, 메모장에서는 통과했습니다.
- 기존 회귀 테스트(`e2e.mjs`, `compat_test.mjs`)는 이번에 실행하지 않았습니다. 탭 전환, 주소창 peek, watchdog 등 드래그 외 기능은 이번 버전에서 코드를 바꾸지 않았지만 실제 입력으로는 재검증하지 않았습니다.
  변경 범위: 복원 시 스냅 사각형 적용, 종료 시 훅 해제.
- 설치된 VS Code는 대기 중인 업데이트(`vscode-updating` 뮤텍스) 때문에 두 번째 인스턴스가 시작되지 않아, 공식 포터블 빌드(서명 확인)로 테스트했습니다.
- 배율이 서로 다른 모니터는 실제 장비로 검증하지 않았습니다(단위 테스트만).
- Snap 레이아웃 막대 회피 깊이(120 DIP)는 경험값입니다.

## 7. 남은 한계

- Snap 레이아웃 막대 회피 깊이(120 DIP)는 경험값입니다. 화면 위쪽 가장자리에 닿은 뒤에는 커서를 한 번 아래로 내렸다가 다시 올려야 합니다.
- 서로 다른 배율의 모니터 조합은 단위 테스트로만 검증했습니다(테스트 PC는 모든 모니터가 100%).
- 전체 화면(F11) Chrome에는 드롭 영역이 없습니다.
