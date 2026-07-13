# ORMCHART CRM · 주소 조건 프로토타입

CRM **조건 지정 발송 › 환자정보 › 주소 조건** 컴포넌트의 인터랙티브 프로토타입 + 화면설계서입니다.
빌드·서버 없이 동작하는 **자립형 단일 HTML**(`index.html`)로 구성되어 있습니다.

## 보는 방법

- **로컬**: `index.html`을 브라우저로 열기 (더블클릭)
- **웹**: GitHub Pages 배포 후 `https://<계정명>.github.io/<저장소명>/` 접속
- 화면 우상단 탭으로 **프로토타입 ↔ 화면설계서** 전환

## 주요 사양

| 항목 | 내용 |
|---|---|
| 데이터 기준 | 행정표준코드 법정동코드 10자리 (시·도 2 + 시·군·구 3 + 읍·면·동 3 + 리 2) |
| 선택 방식 | 검색해서 추가 (전체 경로 토큰 매칭) + 시/도 → 시/군/구 → 읍/면/동 드릴다운 |
| 트리거 | 입력형 콤보박스 — 누른 자리에서 즉시 검색 |
| 선택 모델 | prefix 집합, tri-state, 축약(collapse-up)/분해(explode), 포함=OR / 제외=NOT(OR) |
| 인원수 | 조건 설정 중 미표시 — 대상자 확인·발송 단계에서 조회 |
| 지도 | 확인 전용 — 적용된 선택 범위를 시/군/구 구역 단위로 하이라이트 |
| 키보드 | ↓↑ 탐색 · Space 토글 · Enter 기본동작 · →/← 드릴 이동 · Esc 닫기 (roving tabindex) |

상세 정책·상태 정의·인터랙션 표는 화면 내 **화면설계서 탭**을 참고하세요.

## GitHub Pages 배포 절차

1. GitHub에서 새 저장소 생성 (예: `ormchart-crm-address`)
2. 이 폴더에서:
   ```bash
   git remote add origin https://github.com/<계정명>/ormchart-crm-address.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `/ (root)`** 선택 후 저장
4. 1~2분 뒤 `https://<계정명>.github.io/ormchart-crm-address/` 에서 접속 가능

> 지역 데이터는 데모용 샘플 서브셋입니다. 실서비스는 지역 API(`GET /regions?parentCode`, `GET /regions/search?q`)로 대체합니다.
