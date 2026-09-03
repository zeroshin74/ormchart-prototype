// ── 인바디 결과 분석 v2 — App ───────────────────────────────────
/* 좌표계 원칙 (가이드 1)
 * - 하단 처방항목 날짜 헤더가 화면 유일의 X축.
 * - 모든 스크롤 컨테이너는 (내부폭 - 뷰포트폭)이 동일하도록 구성해
 *   scrollLeft 하나로 상/하단이 1px 오차 없이 수직 동기화된다.
 * - 차트: [카드 margin GUT][border 1][y축 AXIS_W][플롯]
 * - 처방: canvas에 margin-left PLOT_OFF / margin-right PLOT_RIGHT 부여 → 동일 원점.
 */

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

const MS = 86400000;
const PAD = 26;              // 플롯 좌우 내부 여백(px) — 카드 개별 축용
// 공유 축 좌측 인셋: 처방 항목명(11px) 폭에 맞춰 그래프/축/데이터 시작점을 정렬
const PAD_L = 124;
const PAD_R = 26;
const LEFTW = 215;           // 좌측 고정 영역 (CSS --left-col-w 와 동일)
const AXIS_W = 44, GUT = 14, BRD = 1;
const PLOT_OFF = GUT + BRD + AXIS_W;   // 59
const PLOT_RIGHT = GUT + BRD;          // 15
const SCALES = [25, 50, 75, 100];
const MINI_W = 258, MINI_PADL = 34, MINI_PADR = 12;
const LIST_H = 150, CARD_H = 168, CMP_H = 470, MINI_H = 76;
const HEAD_H = 30;

const pms = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromMs = (ms) => new Date(ms);
const fmtMD = (ms) => { const d = fromMs(ms); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
const fmtDot = (ms) => {
  const d = fromMs(ms);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())}`;
};
const parseDot = (s) => {
  const m = /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/.exec((s || '').trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
};

const TODAY_MS = pms(TODAY);
const VISIT_MS = VISIT_DATES.map(pms);

// ── 상태 ────────────────────────────────────────────────────────
const S = {
  mode: 'trend',            // trend | compare — 기본 진입: 항목별 추이
  layout: 'list',           // list | card
  scaleTrend: 2,            // 75% 기본뷰
  scaleCompare: 0,          // 지표변화비교는 Fit to screen 기본
  presetDays: 0,            // 전체(3년) 기본
  customFrom: null, customTo: null,
  visible: new Set(METRICS.map((m) => m.key)),
  hover: null,              // {dateMs, targetKey}
  pin: null,                // {dateMs, targetKey}
  anchorMs: null,           // 클릭 앵커링 기준일
  scroll: 0,
  rxCollapsed: false,       // 처방항목 전체 접기
  extras: false,            // '추가제안' 토글: Δ요약·목표선·구간 통계 (사실·산술 표시만)
  miniW: MINI_W,            // 우측 측정 지표 추이 패널 폭 (스플리터 드래그로 조절)
};

// Δ 표기: 판단이 아닌 산술 — 부호와 단위만 표시
function fmtDelta(metric, d) {
  const v = metric.key === 'ecw' ? Math.abs(d).toFixed(3) : Math.abs(d).toFixed(1);
  return `${d > 0 ? '+' : d < 0 ? '−' : '±'}${v}`;
}

// 라벨 실측 폭 (충돌 계산용) — 날짜 폰트 가이드: 최대 11px / 최소 9px
const AXIS_FONT_MAX = 11, AXIS_FONT_MIN = 9;
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';
const _measureCtx = document.createElement('canvas').getContext('2d');
const textWAt = (s, px) => {
  _measureCtx.font = `${px}px ${FONT_STACK}`;
  return _measureCtx.measureText(s).width;
};

// 렌더링 산출물 레지스트리
const REG = { charts: {}, rxRows: {}, minis: {}, cmp: null, scrolls: [], vlines: [], master: null };
let G = null; // geometry

const scaleIdx = () => (S.mode === 'compare' ? S.scaleCompare : S.scaleTrend);
const setScaleIdx = (v) => { if (S.mode === 'compare') S.scaleCompare = v; else S.scaleTrend = v; };

// ── 도메인/지오메트리 ───────────────────────────────────────────
function domainRange() {
  let end = TODAY_MS, start;
  if (S.customFrom != null && S.customTo != null) {
    start = S.customFrom; end = S.customTo;
  } else if (S.presetDays === 0) {
    start = VISIT_MS[0];
  } else {
    start = end - S.presetDays * MS;
  }
  if (start >= end) start = end - 30 * MS;
  return { start, end };
}

// 창 숨김/최소화 등으로 측정값이 0에 가까울 때를 대비한 마지막 유효 크기 캐시
const _lastGood = { w: 1200, h: 700 };
// 비교 차트 높이 실측 보정치 (렌더 후 잔여 여백/넘침을 흡수)
let _cmpCorr = 0, _cmpCorrecting = false;

function computeGeometry() {
  // 세로 스크롤바 폭을 제외한 실제 가용 폭 기준 (가로 스크롤 진동 방지)
  const scroller = $('#main-scroll');
  let mainW = scroller ? scroller.clientWidth : 0;
  let mainH = $('#main').clientHeight;
  if (mainW < 400) mainW = _lastGood.w; else _lastGood.w = mainW;
  if (mainH < 200) mainH = _lastGood.h; else _lastGood.h = mainH;
  // 좌측 고정 열 제거 — 전체 폭을 플롯에 사용 (항목명은 행 오버레이)
  const bodyW = S.mode === 'compare' ? mainW - S.miniW : mainW;
  const plotViewW = Math.max(200, bodyW - PLOT_OFF - PLOT_RIGHT);
  const { start, end } = domainRange();
  const days = Math.max(1, (end - start) / MS);
  const fit = Math.max(0.2, (plotViewW - PAD_L - PAD_R) / days);
  const steps = [fit, Math.max(fit, 4), Math.max(fit, 14), Math.max(fit, 48)];
  const px = steps[scaleIdx()];
  let contentW = Math.round(PAD_L + PAD_R + days * px);
  if (contentW - plotViewW < 3) contentW = plotViewW; // 반올림 오차로 인한 불필요 스크롤 제거
  const visits = VISIT_MS.filter((t) => t >= start && t <= end);
  const g = {
    mainW, bodyW, plotViewW, start, end, days, fit, steps, px, contentW, visits,
    maxScroll: Math.max(0, contentW - plotViewW),
    padL: PAD_L,
    x(ms) { return PAD_L + ((ms - start) / MS) * px; },
  };
  // 축 표기 대상: 비교=공유(측정일+처방일) / 항목별 추이=처방일만.
  // 처방 접힘 시 — 리스트형은 축이 차트의 유일한 기준이므로 측정일로 전환해 유지,
  // 카드형은 개별 축이 있으므로 공유 축 자체를 숨김
  g.axisHidden = S.rxCollapsed && S.mode === 'trend' && S.layout === 'card';
  const axisKind = S.mode === 'compare' ? 'mixed'
    : (S.rxCollapsed && S.layout === 'list' ? 'visits' : 'rx');
  g.axis = buildAxisLabels(g, axisKind);
  g.axisKind = axisKind;
  g.yearSegs = computeYearSegs(g);

  // 처방 목록 자체 스크롤 높이(뷰포트 ~26% 상한) — 항목이 많으면 목록만 스크롤
  const rxListH = Math.min(PRESCRIPTIONS.length * 44, Math.max(132, Math.round(mainH * 0.26)));
  g.rxListH = rxListH;
  // 하단 고정 블록 높이: 축(47, 카드형 접힘 시 0) + 슬림 타이틀(28) + 목록
  const rxH = (g.axisHidden ? 0 : 47) + 28 + (S.rxCollapsed ? 0 : rxListH);

  // 비교 차트 높이: 세로 반응형 — 가용 높이에서 헤더/스크롤바/처방 테이블을 뺀 값
  if (S.mode === 'compare') {
    const overhead = 12 + 42 + 2 + 16 + rxH + 10; // 상단 패딩+헤드행+보더+스크롤바(16)+여유
    g.cmpH = Math.max(300, Math.min(1200, mainH - overhead + _cmpCorr));
  }

  // 항목별 추이 차트 높이: 세로 반응형 — 표시 지표 수/레이아웃 기준 배분
  if (S.mode === 'trend') {
    const nVis = Math.max(1, METRICS.filter((m) => S.visible.has(m.key)).length);
    const rowsN = S.layout === 'card' ? Math.ceil(nVis / 2) : nVis;
    // 36 = 섹션 헤더(area-head) — 예산 누락 시 맞는 해상도에서도 세로 스크롤바가 생김
    const avail = mainH - rxH - 16 - 14 - 36 - rowsN * 10 - 12;
    g.chartH = Math.max(150, Math.min(420, Math.floor(avail / rowsN) - HEAD_H));
  }

  // 호버 스냅 대상: 측정일 + 처방일 (처방만 있는 날짜도 크로스헤어/툴팁 접근 가능)
  const snap = new Set(visits);
  RX_DATE_SET.forEach((t) => { if (t >= start && t <= end) snap.add(t); });
  g.snapDates = [...snap].sort((a, b) => a - b);

  // 축 틱: 비교 모드=전체 데이터 일자(측정일 강조), 항목별 추이=처방일만.
  // 시각적 뭉개짐 방지를 위해 3px 미만 간격은 솎아냄
  const visitSet = new Set(visits);
  const tickSrc = S.mode === 'compare' ? g.snapDates
    : g.axisKind === 'visits' ? visits
    : [...RX_DATE_SET].filter((t) => t >= start && t <= end).sort((a, b) => a - b);
  g.ticks = [];
  let lastTickX = -1e9;
  tickSrc.forEach((ms) => {
    const x = g.x(ms);
    if (x - lastTickX < 3) return;
    lastTickX = x;
    g.ticks.push({ ms, x, isVisit: visitSet.has(ms) });
  });

  // 카드형: 개별 X축 — 카드 뷰포트 폭 기준의 자체 지오메트리 (가이드-카드 2)
  if (S.mode === 'trend' && S.layout === 'card') {
    const cardW = (bodyW - 28 - 10) / 2;               // grid padding 14*2, gap 10
    const cardPlotW = Math.max(120, cardW - 2 * BRD - AXIS_W);
    const fitC = Math.max(0.1, (cardPlotW - PAD * 2) / days);
    const stepsC = [fitC, Math.max(fitC, 4), Math.max(fitC, 14), Math.max(fitC, 48)];
    const pxC = stepsC[scaleIdx()];
    const gc = {
      start, end, days, visits, px: pxC, steps: stepsC,
      plotViewW: cardPlotW,
      contentW: Math.round(PAD * 2 + days * pxC),
      padL: PAD,
      x(ms) { return PAD + ((ms - start) / MS) * pxC; },
    };
    gc.maxScroll = Math.max(0, gc.contentW - cardPlotW);
    // 카드 개별 축: 하단 처방항목 축과 동일한 날짜 체계(카드 폭 기준으로 단위 자동 조정)
    gc.axis = buildAxisLabels(gc, 'rx');
    g.card = gc;
  }
  return g;
}

// 노출 날짜 컬럼: 데이터 일자 + (여유 시) 달력 그리드 → 충돌 시 생략(Skip)
// 규칙: 첫 측정일/마지막(오늘) 절대 유지, 데이터 일자 우선, 최소 간격 16px 보장
// kind: 'mixed'(비교 모드 공유 축: 측정일 우선+처방일+그리드) | 'rx'(처방일만) | 'visits'(측정일만)
function computeColumns(g, kind) {
  kind = kind || 'mixed';
  const isTodayEnd = g.end === TODAY_MS;
  const dataDates = new Set();
  if (kind !== 'rx') g.visits.forEach((t) => dataDates.add(t));
  if (kind !== 'visits') RX_DATE_SET.forEach((t) => { if (t >= g.start && t <= g.end) dataDates.add(t); });

  // 달력 그리드 (공유 축에서만 빈 구간 채움 — 데이터 전용 축은 데이터 일자만)
  const grid = [];
  const unitPx = g.px;
  let unit = null;
  if (kind === 'mixed' && scaleIdx() > 0) {
    if (unitPx >= 44) unit = 1;
    else if (unitPx * 7 >= 44) unit = 7;
    else if (unitPx * 30.4 >= 44) unit = 30;
    else unit = 91;
  }
  if (unit === 1 || unit === 7) {
    for (let t = g.end; t >= g.start; t -= unit * MS) grid.push(t);
  } else if (unit === 30) {
    const d0 = fromMs(g.end);
    for (let k = 0; ; k++) {
      const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - k, Math.min(d0.getUTCDate(), 28));
      if (t < g.start) break; grid.push(t);
    }
  } else if (unit === 91) {
    const d0 = fromMs(g.end);
    for (let k = 0; ; k += 3) {
      const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - k, Math.min(d0.getUTCDate(), 28));
      if (t < g.start) break; grid.push(t);
    }
  }

  // 라벨 충돌은 행(row)별로, 처방 셀 충돌은 전체(all) 기준으로 검사.
  // 75~100%는 셀 전체 노출(용량|일투수|일수)이므로 컬럼 최소 45px 확보 (가이드 2-1)
  const cellFloor = kind !== 'visits' && scaleIdx() >= 2 ? 45 : 18;
  const visitSet = new Set(g.visits);
  const dataSorted = [...dataDates].sort((a, b) => a - b);

  const bs = (arr, ms) => {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < ms) lo = m + 1; else hi = m; }
    return lo;
  };

  // 폰트/행수 후보 시도: 전체 날짜를 수용하는 첫 구성 우선,
  // 없으면 최다 수용 구성(동률이면 큰 폰트·한 줄 우선)
  const attempt = (fontPx, nRows) => {
    const labelW = (ms) => textWAt(ms === g.end && isTodayEnd ? '오늘' : fmtMD(ms), fontPx);
    const labelGapOf = (a, b) => (labelW(a) + labelW(b)) / 2 + 6;
    const okIn = (arr, ms, gapFn) => {
      const i = bs(arr, ms);
      if (i < arr.length && arr[i] === ms) return false;
      if (i > 0 && g.x(ms) - g.x(arr[i - 1]) < gapFn(arr[i - 1], ms)) return false;
      if (i < arr.length && g.x(arr[i]) - g.x(ms) < gapFn(ms, arr[i])) return false;
      return true;
    };
    const labelRows = Array.from({ length: nRows }, () => []);
    const all = [];
    const rowOf = new Map();
    const tryPlace = (ms) => {
      if (rowOf.has(ms)) return;
      if (!okIn(all, ms, () => cellFloor)) return;
      for (let r = 0; r < nRows; r++) {
        if (okIn(labelRows[r], ms, labelGapOf)) {
          labelRows[r].splice(bs(labelRows[r], ms), 0, ms);
          all.splice(bs(all, ms), 0, ms);
          rowOf.set(ms, r);
          return;
        }
      }
    };
    // tier 0: 양끝 기준 라벨 (가이드 6: 절대 유지)
    all.push(g.end); labelRows[0].push(g.end); rowOf.set(g.end, 0);
    if (dataSorted.length) tryPlace(dataSorted[0]);
    // tier 1: 측정일 최우선 — 최근 → 과거
    if (kind !== 'rx') [...g.visits].reverse().forEach(tryPlace);
    // tier 2: 처방일 (최근 → 과거)
    if (kind === 'rx') [...dataSorted].reverse().forEach(tryPlace);
    else if (kind !== 'visits') [...dataSorted].reverse().forEach((ms) => { if (!visitSet.has(ms)) tryPlace(ms); });
    // tier 3: 달력 그리드 채움 (공유 축 전용)
    grid.forEach(tryPlace);

    let placedData = 0;
    dataSorted.forEach((ms) => { if (rowOf.has(ms)) placedData++; });
    return { all, rowOf, placedData, fontPx, nRows, complete: placedData === dataSorted.length };
  };

  const candidates = [];
  for (let f = AXIS_FONT_MAX; f >= AXIS_FONT_MIN; f--) candidates.push([f, 1]);
  candidates.push([AXIS_FONT_MIN, 2]);
  let best = null;
  for (const [f, n] of candidates) {
    const at = attempt(f, n);
    if (at.complete) { best = at; break; }
    if (!best || at.placedData > best.placedData) best = at;
  }

  const cols = best.all.map((ms, i) => {
    const prev = i > 0 ? best.all[i - 1] : null;
    const next = i < best.all.length - 1 ? best.all[i + 1] : null;
    const gap = Math.min(
      prev != null ? g.x(ms) - g.x(prev) : Infinity,
      next != null ? g.x(next) - g.x(ms) : Infinity
    );
    return {
      ms, x: g.x(ms), gap: gap === Infinity ? 9999 : gap,
      row: best.rowOf.get(ms) || 0,
      label: ms === g.end && isTodayEnd ? '오늘' : fmtMD(ms),
      isToday: ms === g.end && isTodayEnd,
    };
  });
  cols.fontPx = best.fontPx;
  cols.twoRow = best.nRows > 1;
  return cols;
}

// 날짜 축 라벨: 무조건 한 줄. 단위 사다리(일→주→월숫자→분기숫자→연도만) × 폰트(11→9px)
// 순으로 시도해 무충돌인 첫 조합을 선택한다.
function buildAxisLabels(g, kind) {
  const isTodayEnd = g.end === TODAY_MS;
  const daySet = new Set();
  if (kind !== 'rx') g.visits.forEach((t) => daySet.add(t));
  if (kind !== 'visits') RX_DATE_SET.forEach((t) => { if (t >= g.start && t <= g.end) daySet.add(t); });
  const dayDates = [...daySet].sort((a, b) => a - b);

  const weekly = [];
  for (let t = g.end - 7 * MS; t >= g.start; t -= 7 * MS) weekly.push(t);
  weekly.reverse();
  const monthly = [];
  {
    const d0 = fromMs(g.end);
    for (let k = 0; ; k++) {
      const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - k, 1);
      if (t < g.start) break;
      if (t < g.end) monthly.push(t);
    }
    monthly.reverse();
  }
  const quarterly = monthly.filter((t) => fromMs(t).getUTCMonth() % 3 === 0);

  const monthNum = (ms) => String(fromMs(ms).getUTCMonth() + 1);
  const levels = [
    ['day', dayDates, fmtMD],
    ['week', weekly, fmtMD],
    ['month', monthly, monthNum],
    ['quarter', quarterly, monthNum],
  ];
  const todayLbl = isTodayEnd ? '오늘' : fmtMD(g.end);
  const endX = g.x(g.end);

  for (const [level, dates, fmt] of levels) {
    for (let f = AXIS_FONT_MAX; f >= AXIS_FONT_MIN; f--) {
      const wOf = (ms) => textWAt(fmt(ms), f);
      const todayW = textWAt(todayLbl, f);
      // 오늘 라벨과 겹치는 후보 제거 후 전 구간 무충돌 검사
      const ds = dates.filter((ms) => ms !== g.end && endX - g.x(ms) >= (todayW + wOf(ms)) / 2 + 6);
      let ok = true;
      for (let i = 1; i < ds.length; i++) {
        if (g.x(ds[i]) - g.x(ds[i - 1]) < (wOf(ds[i - 1]) + wOf(ds[i])) / 2 + 6) { ok = false; break; }
      }
      if (ok) {
        const labels = ds.map((ms) => ({ ms, x: g.x(ms), label: fmt(ms), isToday: false }));
        labels.push({ ms: g.end, x: endX, label: todayLbl, isToday: isTodayEnd });
        return { labels, font: f, level };
      }
    }
  }
  // 최후: 연도(항상 유지) + 눈금만
  return { labels: [], font: AXIS_FONT_MIN, level: 'year' };
}

// 연도 밴드 구간 (간트 헤더 방식)
function computeYearSegs(g) {
  const segs = [];
  let y = fromMs(g.start).getUTCFullYear();
  const yEnd = fromMs(g.end).getUTCFullYear();
  for (; y <= yEnd; y++) {
    const s = Math.max(g.start, Date.UTC(y, 0, 1));
    const e = Math.min(g.end, Date.UTC(y + 1, 0, 1));
    if (e > s) segs.push({ year: y, startX: g.x(s), endX: g.x(e), isBreak: Date.UTC(y, 0, 1) >= g.start });
  }
  return segs;
}

const RX_DATE_SET = new Set();
PRESCRIPTIONS.forEach((r) => r.events.forEach((e) => RX_DATE_SET.add(pms(e.date))));
const RX_BY_KEY = {};
PRESCRIPTIONS.forEach((r) => {
  RX_BY_KEY[r.key] = { ...r, byDate: new Map(r.events.map((e) => [pms(e.date), e])) };
});

// ── SVG 차트 빌더 ───────────────────────────────────────────────
function metricSeries(metric, g) {
  return metric.data
    .map((d) => ({ ms: pms(d.date), v: d.value }))
    .filter((d) => d.ms >= g.start && d.ms <= g.end);
}

function fmtVal(metric, v) {
  return metric.key === 'ecw' ? Number(v).toFixed(3) : String(v);
}

function yScale(metric, pts, h, topPad, botPad) {
  let vals = pts.map((p) => p.v);
  if (metric.refLine) vals = vals.concat(metric.refLine.value);
  if (S.extras && metric.goal != null) vals = vals.concat(metric.goal);
  if (!vals.length) vals = [0, 1];
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (vmin === vmax) { vmin -= 1; vmax += 1; }
  const span = vmax - vmin;
  vmin -= span * 0.18; vmax += span * 0.18;
  const plotH = h - topPad - botPad;
  return { vmin, vmax, plotTop: topPad, plotH, yOf: (v) => topPad + (1 - (v - vmin) / (vmax - vmin)) * plotH };
}

// 값 라벨 노출 규칙 (가이드 2): 100/75% 전체, 50% 충돌 시 최고/최저/최근, 25% 숨김
function labelMode(pts, g) {
  const idx = scaleIdx();
  if (idx === 0) return 'none';
  if (idx >= 2) return 'all';
  for (let i = 1; i < pts.length; i++) {
    if (g.x(pts[i].ms) - g.x(pts[i - 1].ms) < 34) return 'mml';
  }
  return 'all';
}

function buildChartSVG(metric, g, h, opts) {
  opts = opts || {};
  const pts = metricSeries(metric, g);
  const sc = yScale(metric, pts, h, 14, opts.xLabels ? 32 : 12);
  const w = Math.max(g.contentW, g.plotViewW);
  let out = `<svg width="${w}" height="${h}" data-metric="${metric.key}">`;

  // 정상범위 밴드
  (metric.bands || []).forEach((b) => {
    const yTop = sc.yOf(b.to == null ? sc.vmax : b.to);
    const yBot = sc.yOf(b.from == null ? sc.vmin : b.from);
    out += `<rect x="0" y="${yTop.toFixed(1)}" width="${w}" height="${Math.max(0, yBot - yTop).toFixed(1)}" fill="${b.color}"/>`;
  });
  // 그리드 (y 3틱)
  const ticks = [sc.vmax - (sc.vmax - sc.vmin) * 0.08, (sc.vmax + sc.vmin) / 2, sc.vmin + (sc.vmax - sc.vmin) * 0.08];
  ticks.forEach((tv) => {
    out += `<line x1="0" y1="${sc.yOf(tv).toFixed(1)}" x2="${w}" y2="${sc.yOf(tv).toFixed(1)}" stroke="#edf0f5" stroke-dasharray="3 3"/>`;
  });
  // 기준선 (세포외수분비 경계 등)
  if (metric.refLine) {
    const y = sc.yOf(metric.refLine.value).toFixed(1);
    out += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${metric.refLine.color}" stroke-width="1.4" stroke-dasharray="5 4"/>`;
  }
  // 목표선 ('추가제안' ON): 의사가 입력한 목표값의 단순 표시
  if (S.extras && metric.goal != null) {
    const y = sc.yOf(metric.goal).toFixed(1);
    out += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#2f5bff" stroke-width="1.3" stroke-dasharray="6 4" opacity="0.75"/>`;
    out += `<text x="${(g.padL != null ? g.padL : PAD)}" y="${(sc.yOf(metric.goal) - 5).toFixed(1)}" font-size="10" fill="#2f5bff">목표 ${fmtVal(metric, metric.goal)}</text>`;
  }
  // 라인 — 측정 간격과 무관하게 항상 실선 (가이드 5)
  if (pts.length > 1) {
    const dPath = pts.map((p, i) => `${i ? 'L' : 'M'}${g.x(p.ms).toFixed(1)},${sc.yOf(p.v).toFixed(1)}`).join('');
    out += `<path d="${dPath}" fill="none" stroke="${metric.color}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  // 포인트 + 단일 측정 강조(Ring)
  const single = pts.length === 1;
  pts.forEach((p) => {
    const x = g.x(p.ms).toFixed(1), y = sc.yOf(p.v).toFixed(1);
    if (single) {
      out += `<circle cx="${x}" cy="${y}" r="9" fill="${metric.color}" opacity="0.14"/>`;
      out += `<circle cx="${x}" cy="${y}" r="6" fill="#fff" stroke="${metric.color}" stroke-width="1.6"/>`;
    }
    out += `<circle cx="${x}" cy="${y}" r="3" fill="${metric.color}"/>`;
  });
  // 값 라벨
  const lm = labelMode(pts, g);
  let labelPts = [];
  if (lm === 'all') labelPts = pts;
  else if (lm === 'mml' && pts.length) {
    const maxP = pts.reduce((a, b) => (b.v > a.v ? b : a));
    const minP = pts.reduce((a, b) => (b.v < a.v ? b : a));
    labelPts = [...new Set([maxP, minP, pts[pts.length - 1]])];
  }
  labelPts.forEach((p) => {
    out += `<text class="pt-label" x="${g.x(p.ms).toFixed(1)}" y="${(sc.yOf(p.v) - 8).toFixed(1)}" text-anchor="middle">${fmtVal(metric, p.v)}</text>`;
  });
  // 카드형 개별 X축 라벨 (가이드-카드 2) — 한 줄, 단위/폰트 사다리 적용
  if (opts.xLabels && g.axis) {
    g.axis.labels.forEach((l) => {
      out += `<text class="axis-tick" font-size="${g.axis.font}" x="${l.x.toFixed(1)}" y="${h - 9}" text-anchor="middle"${l.isToday ? ' font-weight="700" fill="#222834"' : ''}>${l.label}</text>`;
    });
  }
  out += '</svg>';
  return { svg: out, sc, pts, tickVals: [ticks[0], ticks[1], ticks[2]] };
}

function yAxisHtml(metric, built, h) {
  const t = built.tickVals;
  return `<div style="position:absolute;left:0;top:${HEAD_H}px;width:${AXIS_W}px;height:${h}px;pointer-events:none">
    ${t.map((v) => `<div style="position:absolute;right:6px;top:${(built.sc.yOf(v) - 7).toFixed(1)}px;font-size:10px;color:#8b94a5">${fmtVal(metric, +v.toFixed(metric.key === 'ecw' ? 3 : 1))}</div>`).join('')}
  </div>`;
}

// ── 처방항목 블록 ──────────────────────────────────────────────
function rxTitleRowHtml() {
  return `<div class="rx-title" id="rx-title-row" title="처방항목 전체 펼치기/접기">
      <button class="rx-toggle" id="rx-toggle" aria-label="처방항목 접기/펼치기">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5 L6 4 L9.5 7.5"/></svg>
      </button>
      <span>처방항목</span><span class="rx-count">${PRESCRIPTIONS.length}</span>
    </div>`;
}

// 독립 날짜 축 행: 연도 밴드 + 한 줄 날짜 라벨 + 전 일자 틱
function axisBodyHtml(g) {
  const ax = g.axis || { labels: [], font: AXIS_FONT_MAX };
  const labels = ax.labels.map((l) =>
    `<div class="dlabel single${l.isToday ? ' today' : ''}" style="left:${l.x.toFixed(1)}px;font-size:${ax.font}px">${l.label}</div>`).join('');
  // 틱 바는 첫 날짜 라벨 이전 구간에는 그리지 않음 (라벨 시작점과 정렬)
  const firstLabelMs = ax.labels.length ? Math.min(...ax.labels.map((l) => l.ms)) : -Infinity;
  const ticks = (g.ticks || []).filter((t) => t.ms >= firstLabelMs).map((t) =>
    `<div class="dtick${t.isVisit ? ' visit' : ''}" style="left:${t.x.toFixed(1)}px"></div>`).join('');
  const yearLabels = g.yearSegs.map((s) =>
    `<div class="yr-label" data-sx="${s.startX.toFixed(1)}" data-ex="${s.endX.toFixed(1)}" style="left:${(s.startX + 2).toFixed(1)}px">${s.year}</div>`).join('');
  return `<div id="axis-canvas" style="width:${g.contentW}px;margin-left:${PLOT_OFF}px;margin-right:${PLOT_RIGHT}px">
    <div class="axis-head"><div class="yr-row"></div>${labels}${yearLabels}${ticks}</div>
  </div>`;
}

// 처방 행: 모든 이벤트 표시 — 여유 시 전체 텍스트 → 용량 칩 → 원형 점(솎아냄)
function rxRowsHtml(g) {
  REG.rxModes = {};
  const rows = PRESCRIPTIONS.map((r) => {
    const rx = RX_BY_KEY[r.key];
    const evs = rx.events
      .map((e) => ({ e, ms: pms(e.date) }))
      .filter((v) => v.ms >= g.start && v.ms <= g.end)
      .sort((a, b) => a.ms - b.ms);
    const modes = new Map();
    REG.rxModes[r.key] = modes;
    // 행 단위 일괄 판정: 부분 혼용 표기 금지 — 행 내 최소 간격으로 모드 결정
    let rowMinGap = 1e9;
    for (let i = 1; i < evs.length; i++) {
      rowMinGap = Math.min(rowMinGap, g.x(evs[i].ms) - g.x(evs[i - 1].ms));
    }
    // 숫자 폭(최대 자릿수 기준, 소수점 2자리까지 가능) + 최소 라운드 여백
    const numW = evs.length
      ? Math.max(...evs.map((v) => textWAt(String(v.e.dose), 11))) + 6 : 10;
    let rowMode;
    if (scaleIdx() >= 2 && rowMinGap >= 45) rowMode = 'full';
    else if (rowMinGap >= Math.max(10, numW)) rowMode = 'num';
    else rowMode = 'dot';

    let html = '';
    let lastDotX = -1e9;
    for (let i = 0; i < evs.length; i++) {
      const x = g.x(evs[i].ms);
      modes.set(evs[i].ms, rowMode);
      if (rowMode === 'dot') {
        // 점 시각적 솎아냄 (7px 미만 간격 생략, 마지막은 유지)
        if (x - lastDotX < 7 && i !== evs.length - 1) continue;
        lastDotX = x;
        html += `<span class="rx-dot" data-ms="${evs[i].ms}" style="left:${x.toFixed(1)}px"></span>`;
      } else {
        const e = evs[i].e;
        const cls = rowMode === 'full' ? 'plain' : 'more';
        const txt = rowMode === 'full'
          ? `${e.dose}<span class="bar">|</span>${e.perDay}<span class="bar">|</span>${e.days}`
          : `${e.dose}`;
        html += `<div class="rx-cell ${cls}" data-rx="${r.key}" data-ms="${evs[i].ms}" style="left:${x.toFixed(1)}px">${txt}</div>`;
      }
    }
    return `<div class="rx-row" data-rxrow="${r.key}">${html}</div>`;
  }).join('');
  return `<div id="rx-canvas" style="width:${g.contentW}px;margin-left:${PLOT_OFF}px;margin-right:${PLOT_RIGHT}px">${rows}</div>`;
}

// 하단 고정 블록: [가로 스크롤바][독립 날짜 축][처방항목 타이틀 행][처방 행들]
// 좌측 열 없이 전체 폭 사용 — 항목명은 행 좌측 오버레이
function rxBlockHtml(g) {
  const collapsed = S.rxCollapsed ? ' collapsed' : '';
  return `${masterHtml(g)}
  <div id="axis-sect"${g.axisHidden ? ' style="display:none"' : ''}>
    <div id="axis-body" class="pannable">${axisBodyHtml(g)}</div>
  </div>
  <div id="rx-title-sect" class="${collapsed}">${rxTitleRowHtml()}</div>
  <div id="rx-sect" class="${collapsed}" style="max-height:${g.rxListH || 176}px">
    <div id="rx-body" class="pannable">${rxRowsHtml(g)}</div>
    <div class="rx-names">${PRESCRIPTIONS.map((r, i) =>
      `<div class="rx-name-float" style="top:${i * 44}px">${r.name}</div>`).join('')}</div>
    <div class="vline" data-vline="rx"></div>
  </div>`;
}

function masterHtml(g) {
  // 스크롤바 영역(12px)은 항상 고정 확보 — 스크롤 유무와 무관하게 레이아웃 위치 불변.
  // 콘텐츠=뷰포트일 때는 트랙이 그려지지 않아 빈 여백으로만 남는다.
  return `<div style="background:#fff;padding:4px 0"><div id="master-scroll"><div class="spacer" style="width:${g.contentW + PLOT_OFF + PLOT_RIGHT}px"></div></div></div>`;
}

// ── 항목별 추이 렌더 ────────────────────────────────────────────
function chartCardHtml(metric, g, h, opts) {
  const built = buildChartSVG(metric, g, h, opts);
  const latest = metric.data.length ? metric.data[metric.data.length - 1] : null;
  // '추가제안' ON: 전회/시작 대비 Δ 요약 (조회 기간 기준 단순 산술)
  let deltaHtml = '';
  if (S.extras && built.pts.length >= 2) {
    const p = built.pts;
    const dPrev = p[p.length - 1].v - p[p.length - 2].v;
    const dFirst = p[p.length - 1].v - p[0].v;
    deltaHtml = `<span class="head-delta">전회 ${fmtDelta(metric, dPrev)} · 시작 ${fmtDelta(metric, dFirst)}</span>`;
  }
  return {
    html: `<div class="chart-card" data-card="${metric.key}">
      <div class="head">
        <span class="dot" style="background:${metric.color}"></span>
        <span>${metric.name}</span><span class="unit">(${metric.unit})</span>
        <span class="latest">최근 <b>${latest ? fmtVal(metric, latest.value) : '-'}</b> ${metric.unit}</span>${deltaHtml}
      </div>
      ${yAxisHtml(metric, built, h)}
      <div class="chart-scroll pannable" style="margin-left:${AXIS_W}px">${built.svg}</div>
      <div class="vline" data-vline="card:${metric.key}"></div>
    </div>`,
    built,
  };
}

function renderTrend(content, g) {
  const vis = METRICS.filter((m) => S.visible.has(m.key));
  const isCard = S.layout === 'card';
  const h = g.chartH || (isCard ? CARD_H : LIST_H);
  const gChart = isCard ? g.card : g;
  const cards = vis.map((m) => {
    const c = chartCardHtml(m, gChart, h, { xLabels: isCard });
    REG.charts[m.key] = { built: c.built, h };
    return c.html;
  }).join('');

  content.insertAdjacentHTML('beforeend', `
    <div id="charts-sect">
      <div class="area-head"><span class="t1">측정지표 추이</span><span class="t2">각 지표별 절대 값</span></div>
      <div id="charts-body">
        <div class="${isCard ? 'card-grid' : 'chart-rows'}" id="charts-area">
          ${cards || '<div class="empty-hint">표시할 지표가 없습니다. 상단 설정에서 지표를 선택하세요.</div>'}
        </div>
      </div>
    </div>
    <div id="bottom-block">${rxBlockHtml(g)}</div>
  `);

  vis.forEach((m) => { REG.charts[m.key].svgWrap = $(`.chart-card[data-card="${m.key}"] .chart-scroll`); REG.charts[m.key].cardEl = $(`.chart-card[data-card="${m.key}"]`); });
}

// ── 지표 변화 비교 렌더 ────────────────────────────────────────
function buildCompareSVG(g, vis) {
  // 인덱스 정규화: 각 지표의 도메인 내 첫 측정값 = 100
  const seriesIdx = vis.map((m) => {
    const pts = metricSeries(m, g);
    if (!pts.length) return { m, pts: [] };
    const base = pts[0].v;
    return { m, pts: pts.map((p) => ({ ms: p.ms, v: p.v, idx: (p.v / base) * 100 })) };
  });
  let vals = [];
  seriesIdx.forEach((s) => s.pts.forEach((p) => vals.push(p.idx)));
  if (!vals.length) vals = [90, 110];
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (vmin === vmax) { vmin -= 5; vmax += 5; }
  const span = vmax - vmin; vmin -= span * 0.08; vmax += span * 0.08;
  const H = g.cmpH || CMP_H;
  const topPad = 16, botPad = 14, plotH = H - topPad - botPad;
  const yOf = (v) => topPad + (1 - (v - vmin) / (vmax - vmin)) * plotH;
  const w = Math.max(g.contentW, g.plotViewW);

  let out = `<svg width="${w}" height="${H}">`;
  const nTicks = 5;
  const tickVals = [];
  for (let i = 0; i < nTicks; i++) {
    const tv = vmax - span * 0.0 - ((vmax - vmin) / (nTicks - 1)) * i * 1;
    tickVals.push(tv);
    out += `<line x1="0" y1="${yOf(tv).toFixed(1)}" x2="${w}" y2="${yOf(tv).toFixed(1)}" stroke="#edf0f5" stroke-dasharray="3 3"/>`;
  }
  out += `<line x1="0" y1="${yOf(100).toFixed(1)}" x2="${w}" y2="${yOf(100).toFixed(1)}" stroke="#c9d0dc" stroke-width="1.2"/>`;
  // 비교 차트에서는 Ring 강조 없이 일반 점으로만 표시 (인덱스=100 단일점의 과잉 강조 방지)
  // 점 크기는 추이 그래프와 동일(r=3)
  seriesIdx.forEach((s) => {
    if (s.pts.length > 1) {
      const dPath = s.pts.map((p, i) => `${i ? 'L' : 'M'}${g.x(p.ms).toFixed(1)},${yOf(p.idx).toFixed(1)}`).join('');
      out += `<path d="${dPath}" fill="none" stroke="${s.m.color}" stroke-width="1.8" stroke-linejoin="round"/>`;
    }
    s.pts.forEach((p) => {
      out += `<circle cx="${g.x(p.ms).toFixed(1)}" cy="${yOf(p.idx).toFixed(1)}" r="3" fill="${s.m.color}"/>`;
    });
  });
  out += '</svg>';
  return { svg: out, yOf, vmin, vmax, tickVals, seriesIdx };
}

function buildMiniSVG(metric, g) {
  // 우측 패널 스케일 잠금: 항상 전체 기간 Fit (가이드-비교 2)
  const w = S.miniW - 20, plotW = w - MINI_PADL - MINI_PADR;
  const pts = metricSeries(metric, g);
  const days = g.days;
  const xOf = (ms) => MINI_PADL + ((ms - g.start) / MS / days) * plotW;
  const sc = yScale(metric, pts, MINI_H, 8, 18);
  let out = `<svg width="${w}" height="${MINI_H}">`;
  if (pts.length > 1) {
    const dPath = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.ms).toFixed(1)},${sc.yOf(p.v).toFixed(1)}`).join('');
    out += `<path d="${dPath}" fill="none" stroke="${metric.color}" stroke-width="1.5"/>`;
  }
  pts.forEach((p) => { out += `<circle cx="${xOf(p.ms).toFixed(1)}" cy="${sc.yOf(p.v).toFixed(1)}" r="${pts.length === 1 ? 2.6 : 1.7}" fill="${metric.color}"/>`; });
  // y 최소/최대
  if (pts.length) {
    const vmaxL = fmtVal(metric, +(Math.max(...pts.map((p) => p.v))).toFixed(metric.key === 'ecw' ? 3 : 1));
    const vminL = fmtVal(metric, +(Math.min(...pts.map((p) => p.v))).toFixed(metric.key === 'ecw' ? 3 : 1));
    out += `<text class="mini-tick" x="${MINI_PADL - 4}" y="12" text-anchor="end">${vmaxL}</text>`;
    out += `<text class="mini-tick" x="${MINI_PADL - 4}" y="${MINI_H - 20}" text-anchor="end">${vminL}</text>`;
  }
  // x 라벨 4개
  for (let i = 0; i < 4; i++) {
    const ms = g.start + (days * MS * i) / 3;
    out += `<text class="mini-tick" x="${(MINI_PADL + (plotW * i) / 3).toFixed(1)}" y="${MINI_H - 5}" text-anchor="middle">${fmtMD(ms)}</text>`;
  }
  out += '</svg>';
  return { svg: out, xOf, sc, pts };
}

function renderCompare(content, g) {
  const vis = METRICS.filter((m) => S.visible.has(m.key));
  const cmp = buildCompareSVG(g, vis);
  REG.cmp = cmp;

  const legend = METRICS.map((m) =>
    `<span class="lg${S.visible.has(m.key) ? '' : ' off'}" data-lg="${m.key}"><span class="sw" style="background:${m.color}"></span>${m.name}</span>`).join('');

  const minis = METRICS.filter((m) => S.visible.has(m.key)).map((m) => {
    const b = buildMiniSVG(m, g);
    REG.minis[m.key] = b;
    return `<div class="mini-card" data-mini="${m.key}">
      <div class="m-head"><span class="dot" style="background:${m.color}"></span>${m.name}<span class="unit">(${m.unit})</span></div>
      ${b.svg}<div class="vline" data-vline="mini:${m.key}"></div>
    </div>`;
  }).join('');

  const yTicksHtml = cmp.tickVals.map((tv) =>
    `<div style="position:absolute;right:6px;top:${(cmp.yOf(tv) - 7).toFixed(1)}px;font-size:10px;color:#8b94a5">${tv.toFixed(0)}</div>`).join('');

  content.insertAdjacentHTML('beforeend', `
    <div style="display:flex">
      <div id="cmp-col" style="flex:1;min-width:0;position:relative">
          <div style="border-bottom:1px solid var(--line)">
            <div id="compare-center">
              <div class="cmp-head">
                <div><div class="t1">지표 변화 비교</div><div class="t2">Y축: Index (100 = 기준일)</div></div>
                <div id="compare-legend">${legend}</div>
              </div>
              <div style="position:relative;margin:0 ${GUT}px;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden">
                <div style="position:absolute;left:0;top:0;width:${AXIS_W}px;height:${g.cmpH || CMP_H}px;pointer-events:none;z-index:2">${yTicksHtml}</div>
                <div id="compare-scroll" class="pannable" style="overflow:hidden;margin-left:${AXIS_W}px">${cmp.svg}</div>
              </div>
            </div>
          </div>
          <div id="bottom-block">${rxBlockHtml(g)}</div>
          <div class="vline" data-vline="cmp"></div>
        </div>
      <div id="mini-col" style="flex:0 0 ${S.miniW}px;width:${S.miniW}px">
        <div id="mini-splitter" title="드래그하여 좌우 영역 크기 조절"><span class="split-grip"><svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2 L2 6 L5 10"/><path d="M11 2 L14 6 L11 10"/></svg></span></div>
        <div id="mini-panel">
          <div class="mini-title">측정 지표 추이</div>
          ${minis}
        </div>
      </div>
    </div>
  `);
}

// ── 메인 렌더 ──────────────────────────────────────────────────
function render() {
  G = computeGeometry();
  REG.charts = {}; REG.minis = {}; REG.cmp = null;

  // 재렌더 중 콘텐츠 재구성으로 세로 스크롤이 순간 클램프되어 튀는 현상 방지
  const scroller = $('#main-scroll');
  const keepTop = scroller ? scroller.scrollTop : 0;

  const content = $('#content');
  content.innerHTML = '<div id="crosshair"></div>';

  if (S.mode === 'trend') renderTrend(content, G);
  else renderCompare(content, G);

  // 레지스트리 수집
  REG.master = $('#master-scroll');
  REG.scrolls = $$('.chart-scroll').concat([$('#rx-body'), $('#axis-body'), $('#compare-scroll')].filter(Boolean));
  REG.rxRows = {};
  $$('.rx-row').forEach((el) => { REG.rxRows[el.dataset.rxrow] = el; });

  // 스크롤 적용 (가로 동기화 + 세로 위치 복원)
  S.scroll = Math.max(0, Math.min(S.scroll, G.maxScroll));
  if (REG.master) REG.master.scrollLeft = S.scroll;
  syncScroll(S.scroll);
  if (scroller && scroller.scrollTop !== keepTop) scroller.scrollTop = keepTop;

  // 컨트롤 상태 반영
  $('#zoom-pct').textContent = SCALES[scaleIdx()] + '%';
  const steps = G.steps;
  $('#zoom-in').disabled = scaleIdx() >= 3 || steps[Math.min(3, scaleIdx() + 1)] === steps[scaleIdx()];
  $('#zoom-out').disabled = scaleIdx() <= 0 || steps[Math.max(0, scaleIdx() - 1)] === steps[scaleIdx()];
  updateLayoutToggle();
  $$('#mode-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.mode === S.mode));

  // 비교 모드: 렌더 후 실측으로 하단 여백/넘침을 차트 높이에 흡수 (1회 보정 재렌더)
  if (S.mode === 'compare' && !_cmpCorrecting) {
    const block = $('#bottom-block');
    const mainEl = $('#main');
    const sc = $('#main-scroll');
    if (block && mainEl && sc) {
      const mr = mainEl.getBoundingClientRect();
      const overflowV = sc.scrollHeight - sc.clientHeight;
      // 넘침은 1px라도 즉시 흡수(세로 스크롤바 생성 금지), 여백은 3px 초과 시 확장
      const slack = overflowV > 0 ? -overflowV
        : Math.round(mr.bottom - block.getBoundingClientRect().bottom);
      // 이미 최소 높이(300)에 닿아 더 줄일 수 없으면 보정 반복 금지
      if (mr.height > 200 && Math.abs(slack) < 400 && (slack > 3 || (slack < 0 && G.cmpH > 300))) {
        _cmpCorr = Math.max(-600, Math.min(600, _cmpCorr + slack));
        _cmpCorrecting = true;
        render();
        _cmpCorrecting = false;
        return;
      }
    }
  }

  refreshHover();
}

// ── 스크롤 동기화 ──────────────────────────────────────────────
function cardScrollOf(el, s) {
  // 카드형: 뷰포트가 좁아 max가 다름 → 비례 매핑 (독립 X축, 논리 동기화)
  const max = Math.max(0, el.scrollWidth - el.clientWidth);
  if (G.maxScroll <= 0) return 0;
  return (s / G.maxScroll) * max;
}

function syncScroll(s) {
  S.scroll = s;
  const isCardGrid = S.mode === 'trend' && S.layout === 'card';
  REG.scrolls.forEach((el) => {
    if (!el) return;
    if (isCardGrid && el.classList.contains('chart-scroll')) el.scrollLeft = cardScrollOf(el, s);
    else el.scrollLeft = s;
  });
  // 연도 뱃지: 자기 구간 안에서 sticky — 좌측 최소 간격 유지
  $$('.yr-label').forEach((el) => {
    const sx = +el.dataset.sx, ex = +el.dataset.ex;
    const w = el.offsetWidth || 26;
    el.style.left = `${Math.min(Math.max(sx + 2, s + 2), Math.max(sx + 2, ex - w - 4)).toFixed(1)}px`;
  });
  refreshHover();
}

// ── 크로스헤어/호버 ────────────────────────────────────────────
function plotOriginScreenX() {
  const body = S.mode === 'compare' ? $('#compare-center') : $('#charts-body');
  if (!body) return 0;
  return body.getBoundingClientRect().left + PLOT_OFF - (S.mode === 'compare' ? 0 : 0);
}

function nearestVisit(ms) {
  const arr = G.snapDates && G.snapDates.length ? G.snapDates : G.visits;
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < ms) lo = m + 1; else hi = m; }
  const cand = [arr[Math.max(0, lo - 1)], arr[lo]];
  return Math.abs(cand[0] - ms) <= Math.abs(cand[1] - ms) ? cand[0] : cand[1];
}

function dateFromClientX(clientX, originX, scroll, g) {
  g = g || G;
  const contentX = clientX - originX + scroll;
  const ms = g.start + ((contentX - (g.padL != null ? g.padL : PAD)) / g.px) * MS;
  return nearestVisit(ms);
}

function hideVlines() {
  $$('.vline').forEach((el) => { el.style.display = 'none'; });
  const c = $('#crosshair'); if (c) c.style.display = 'none';
  $$('.rx-cell.hl').forEach((el) => el.classList.remove('hl'));
}

function updateLines(dateMs) {
  hideVlines();
  if (dateMs == null) return;
  const x = G.x(dateMs);
  const inView = x - S.scroll >= -2 && x - S.scroll <= G.plotViewW + 2;

  if (S.mode === 'trend' && S.layout === 'list') {
    // 관통형 크로스헤어: 차트 최상단 → 테이블 끝까지 (가이드 4)
    const c = $('#crosshair');
    if (c && inView) {
      c.style.left = `${PLOT_OFF + (x - S.scroll)}px`;
      c.style.display = 'block';
    }
  } else if (S.mode === 'trend' && S.layout === 'card') {
    // 카드형: 관통 해제, 카드별 독립 크로스헤어 + 테이블 강조선 (가이드-카드 3)
    const xc = G.card ? G.card.x(dateMs) : x;
    Object.keys(REG.charts).forEach((key) => {
      const reg = REG.charts[key];
      const el = $(`.vline[data-vline="card:${key}"]`);
      const wrap = reg.svgWrap;
      if (!el || !wrap) return;
      const lx = AXIS_W + BRD + (xc - wrap.scrollLeft);
      if (lx > AXIS_W + 2 && lx < wrap.clientWidth + AXIS_W) {
        el.style.left = `${lx}px`; el.style.top = `${HEAD_H}px`; el.style.bottom = '0';
        el.style.display = 'block';
      }
    });
    const rxLine = $('.vline[data-vline="rx"]');
    if (rxLine && inView) {
      rxLine.style.left = `${PLOT_OFF + (x - S.scroll)}px`;
      rxLine.style.display = 'block';
    }
  } else if (S.mode === 'compare') {
    // 물리 동기화(중앙↔하단) + 논리 동기화(중앙↔우측 미니맵) (가이드-비교 3)
    const line = $('.vline[data-vline="cmp"]');
    if (line && inView) {
      line.style.left = `${PLOT_OFF + (x - S.scroll)}px`;
      line.style.display = 'block';
    }
    Object.keys(REG.minis).forEach((key) => {
      const el = $(`.vline[data-vline="mini:${key}"]`);
      const b = REG.minis[key];
      if (!el || !b) return;
      el.style.left = `${10 + b.xOf(dateMs)}px`;
      el.style.top = '22px'; el.style.bottom = '2px';
      el.style.display = 'block';
    });
  }
  // 처방 셀 강조
  $$(`.rx-cell[data-ms="${dateMs}"]`).forEach((el) => el.classList.add('hl'));
}

// ── 툴팁 ───────────────────────────────────────────────────────
function tipMetricHtml(metric, v, dateMs, pinned, z, isTarget, refDays, ext) {
  const refBadge = refDays > 0 ? `<span class="ref-badge">${refDays}일 전 측정</span>` : '';
  // '추가제안' ON: 전회/시작 대비 Δ·월평균 변화 (단순 산술 표시 — 판정·권고 없음)
  const extRows = ext ? `
    <div class="t-row"><span>전회대비 :</span><span class="v">${fmtDelta(metric, ext.dPrev)}</span></div>
    <div class="t-row"><span>시작대비 :</span><span class="v">${fmtDelta(metric, ext.dFirst)}</span>
      <span style="color:#aab2c0">(월평균 ${fmtDelta(metric, ext.perMonth)})</span></div>` : '';
  return `<div class="tip${pinned ? ' pinned' : ''}${isTarget ? ' target' : ''}" data-anchor="m:${metric.key}" style="z-index:${z}">
    <div class="t-head"><span>${fmtDot(dateMs)}</span>${refBadge}
      ${pinned ? '<button class="t-close" data-close>✕</button>' : ''}</div>
    <div class="t-row"><span>항목명 :</span><span class="v"><span class="dot" style="background:${metric.color}"></span>${metric.name}</span></div>
    <div class="t-row"><span>결과값 :</span><span class="v accent" style="color:${metric.color}">${fmtVal(metric, v)}</span></div>
    <div class="t-row"><span>표준치 :</span><span class="v">${metric.std == null ? '-' : fmtVal(metric, metric.std)}</span></div>${extRows}
  </div>`;
}

function tipRxHtml(rx, e, dateMs, pinned, z, isTarget) {
  return `<div class="tip${pinned ? ' pinned' : ''}${isTarget ? ' target' : ''}" data-anchor="r:${rx.key}" style="z-index:${z}">
    <div class="t-head"><span>${rx.name}</span><span class="code">${rx.code}</span>
      ${pinned ? '<button class="t-close" data-close>✕</button>' : ''}</div>
    <div class="t-row"><span>처방일자 :</span><span class="v">${fmtDot(dateMs)}</span></div>
    <div class="t-row"><span>처방정보 :</span><span class="v">용량 ${e.dose} | 일투수 ${e.perDay} | 일수 ${e.days}</span></div>
    ${e.note ? `<div class="t-note">${e.note}</div>` : ''}
  </div>`;
}

function tipCompareHtml(dateMs, rows, pinned, targetKey) {
  return `<div class="tip target${pinned ? ' pinned' : ''}" data-anchor="cmp" style="z-index:1500">
    <div class="t-head"><span>${fmtDot(dateMs)}</span>${pinned ? '<button class="t-close" data-close>✕</button>' : ''}</div>
    ${rows.map((r) => `<div class="t-row"><span class="dot" style="background:${r.m.color}"></span>
      <span style="${r.m.key === targetKey ? 'font-weight:700;color:#222834' : ''}">${r.m.name}</span>
      <span class="v${r.m.key === targetKey ? ' accent' : ''}" style="margin-left:auto${r.m.key === targetKey ? `;color:${r.m.color}` : ''}">${fmtVal(r.m, r.v)} ${r.m.unit}</span>
      <span style="color:#aab2c0">${r.refMs ? `(${fmtMD(r.refMs)} 측정)` : `(${r.idx.toFixed(1)})`}</span></div>`).join('')}
  </div>`;
}

function tipMiniHtml(metric, v, z, refMs) {
  return `<div class="tip" data-anchor="mini:${metric.key}" style="z-index:${z};min-width:0;padding:6px 9px">
    <div class="t-row" style="line-height:1.4"><span class="dot" style="background:${metric.color}"></span>
      <span class="v accent" style="color:${metric.color}">${fmtVal(metric, v)}</span>
      <span style="color:#aab2c0">${metric.unit}</span>
      ${refMs ? `<span style="color:#aab2c0;font-size:10px">${fmtMD(refMs)}</span>` : ''}</div>
  </div>`;
}

// 처방 툴팁 필요 여부: 셀이 전체 노출(용량|일투수|일수)로 화면에 보이면
// 노트 여부와 무관하게 호버 이벤트/팝업 없음.
// 25~50%(용량 단독)·라벨 생략으로 미노출·접힘 상태에서만 툴팁 제공
function rxTipNeeded(dateMs, rxKey) {
  // 처방항목이 접혀(숨김) 있으면 처방 레이어 팝업도 표시하지 않음
  if (S.rxCollapsed) return false;
  // 전체 텍스트(용량|일투수|일수)로 보이는 셀만 호버 정보 불필요
  const modes = REG.rxModes[rxKey];
  return !modes || modes.get(dateMs) !== 'full';
}

function showTips(dateMs, targetKey) {
  const layer = $('#floating');
  layer.innerHTML = '';
  if (dateMs == null) return;
  const pinned = !!S.pin;
  const x = G.x(dateMs);
  const lineScreenX = plotOriginScreenX() + (x - S.scroll) + (S.mode === 'compare' ? 0 : 0);
  const anchors = [];
  let html = '';

  if (S.mode === 'trend') {
    // 하단 고정 블록(처방항목)이 최상위 레이어: 그 아래로 스크롤된 차트의 레이어는 숨김
    const blockEl = $('#bottom-block');
    const blockTop = blockEl ? blockEl.getBoundingClientRect().top : Infinity;
    const mainTop = $('#main').getBoundingClientRect().top;
    const vis = METRICS.filter((m) => S.visible.has(m.key));
    vis.forEach((m, i) => {
      // LOCF: 해당 일자 측정이 없으면 직전(가장 가까운 이전) 측정값을 참조 표시
      const pts = metricSeries(m, G);
      let pt = null;
      for (const p of pts) { if (p.ms <= dateMs) pt = p; else break; }
      if (!pt) return;
      const refDays = Math.round((dateMs - pt.ms) / MS);
      // '추가제안' ON: 전회/시작 대비 Δ, 월평균 변화율 (조회 기간 내 산술)
      let ext = null;
      const ptIdx = pts.indexOf(pt);
      if (S.extras && ptIdx > 0) {
        const first = pts[0];
        const months = Math.max(0.5, (pt.ms - first.ms) / MS / 30.4);
        ext = {
          dPrev: pt.v - pts[ptIdx - 1].v,
          dFirst: pt.v - first.v,
          perMonth: (pt.v - first.v) / months,
        };
      }
      const isT = targetKey === 'm:' + m.key;
      const reg = REG.charts[m.key];
      let ax = lineScreenX, ay = 0;
      if (reg && reg.svgWrap) {
        const rect = reg.svgWrap.getBoundingClientRect();
        if (S.layout === 'card' && G.card) {
          // 카드 뷰포트 밖 날짜는 카드 경계로 클램프 (레이어 이탈 방지)
          ax = rect.left + (G.card.x(dateMs) - reg.svgWrap.scrollLeft);
          ax = Math.max(rect.left + 8, Math.min(rect.right - 8, ax));
        }
        ay = rect.top + reg.built.sc.yOf(pt.v);
      }
      // 차트 포인트가 차트 가시 영역 밖(블록 아래/상단 위)이면 레이어 미표시
      if (ay > blockTop - 4 || ay < mainTop + 4) return;
      html += tipMetricHtml(m, pt.v, pt.ms, pinned, isT ? 1500 : 100 + i, isT, refDays, ext);
      // 카드형: 레이어가 자기 카드 경계를 벗어나지 않도록 좌우 대칭 클램프
      const cardClamp = S.layout === 'card' && reg && reg.cardEl
        ? { clampX: false, clampRect: reg.cardEl.getBoundingClientRect() } : {};
      anchors.push({ ax, ay, maxBottom: blockTop, ...cardClamp });
    });
    PRESCRIPTIONS.forEach((r, j) => {
      const e = RX_BY_KEY[r.key].byDate.get(dateMs);
      if (!e || !rxTipNeeded(dateMs, r.key)) return;
      const isT = targetKey === 'r:' + r.key;
      html += tipRxHtml(r, e, dateMs, pinned, isT ? 1500 : 300 + j, isT);
      const rowEl = REG.rxRows[r.key];
      const ay = rowEl ? rowEl.getBoundingClientRect().top + 22 : 0;
      anchors.push({ ax: lineScreenX, ay });
    });
  } else {
    // 중앙 통합 툴팁 (타겟 지표 강조) + 우측 미니 툴팁 동시 렌더
    const vis = METRICS.filter((m) => S.visible.has(m.key));
    const rows = [];
    vis.forEach((m) => {
      const s = REG.cmp && REG.cmp.seriesIdx.find((si) => si.m.key === m.key);
      if (!s) return;
      // LOCF: 해당 일자 측정이 없으면 직전 측정값 + 실제 측정일 표기
      let pt = null;
      for (const p of s.pts) { if (p.ms <= dateMs) pt = p; else break; }
      if (pt) rows.push({ m, v: pt.v, idx: pt.idx, refMs: pt.ms !== dateMs ? pt.ms : null });
    });
    if (rows.length) {
      html += tipCompareHtml(dateMs, rows, pinned, (targetKey || '').replace('m:', ''));
      const cs = $('#compare-scroll');
      const rect = cs ? cs.getBoundingClientRect() : { top: 100 };
      anchors.push({ ax: lineScreenX, ay: rect.top + 40, prefer: 'right' });
    }
    // 미니 툴팁: 우측 미니맵 그래프 위(패널 내부)에서 노출
    const panelEl = $('#mini-panel');
    const panelRect = panelEl ? panelEl.getBoundingClientRect() : null;
    rows.forEach((r, i) => {
      html += tipMiniHtml(r.m, r.v, 200 + i, r.refMs);
      const b = REG.minis[r.m.key];
      const card = $(`.mini-card[data-mini="${r.m.key}"]`);
      if (b && card) {
        const rect = card.getBoundingClientRect();
        anchors.push({ ax: rect.left + 10 + b.xOf(dateMs), ay: rect.top + 34, clampX: false, clampRect: panelRect });
      } else anchors.push({ ax: lineScreenX, ay: 100 });
    });
    PRESCRIPTIONS.forEach((r, j) => {
      const e = RX_BY_KEY[r.key].byDate.get(dateMs);
      if (!e || !rxTipNeeded(dateMs, r.key)) return;
      const isT = targetKey === 'r:' + r.key;
      html += tipRxHtml(r, e, dateMs, pinned, isT ? 1500 : 300 + j, isT);
      const rowEl = REG.rxRows[r.key];
      anchors.push({ ax: lineScreenX, ay: rowEl ? rowEl.getBoundingClientRect().top + 22 : 0 });
    });
  }

  layer.innerHTML = html;
  // 배치: 가장자리 인식(좌/우 플립) + 메인 영역 클램프 — 잘리지 않되 헤더/컨트롤 침범 금지
  const mainRect = $('#main').getBoundingClientRect();
  const originX = plotOriginScreenX();
  const tips = $$('.tip', layer);
  const placedRects = []; // 완전 중첩 방지용 캐스케이드 배치 기록
  tips.forEach((tip, i) => {
    const a = anchors[i] || { ax: lineScreenX, ay: 100 };
    // 플롯 영역 밖으로 벗어난 앵커는 플롯 경계로 클램프 (좌측 패널 위 이탈 방지)
    const ax = a.clampX === false ? a.ax
      : Math.max(originX, Math.min(originX + G.plotViewW, a.ax));
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left;
    if (a.clampRect) {
      // 지정 모듈(미니 패널) 내부로 클램프 — 해당 그래프 위에서 노출
      left = Math.min(Math.max(ax + 8, a.clampRect.left + 4), a.clampRect.right - w - 4);
    } else {
      left = ax + 14;
      if (a.prefer === 'left' || left + w > window.innerWidth - 8) left = ax - 14 - w;
      if (left < 8) left = 8;
    }
    let top = a.ay - h / 2;
    top = Math.max(mainRect.top + 6, Math.min(top, window.innerHeight - h - 8));
    // 지표 레이어는 하단 고정 블록(처방항목) 위를 침범하지 않음
    if (a.maxBottom) top = Math.min(top, a.maxBottom - h - 6);
    // 같은 자리에 겹치는 레이어는 계단식(30px)으로 어긋나게 — 모든 층의 머리글 접근 보장
    let bump = 0;
    placedRects.forEach((pr) => {
      if (Math.abs(pr.left - left) < 40 && Math.abs(pr.top - top) < 40) bump++;
    });
    if (bump) {
      // 아래로 벌릴 공간이 없으면 위로 계단식 배치 (머리글 접근 보장)
      const limit = Math.min(window.innerHeight - h - 8, a.maxBottom ? a.maxBottom - h - 6 : Infinity);
      const down = top + bump * 30;
      top = down <= limit ? down : Math.max(mainRect.top + 6, top - bump * 30);
      left += bump * 10;
      if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    }
    placedRects.push({ left, top });
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
}

function refreshHover() {
  const st = S.pin || S.hover;
  if (!st) { hideVlines(); $('#floating').innerHTML = ''; return; }
  updateLines(st.dateMs);
  showTips(st.dateMs, st.targetKey);
}

// ── 이벤트 ─────────────────────────────────────────────────────
function targetKeyFromEvent(e) {
  const card = e.target.closest && e.target.closest('.chart-card');
  if (card) return 'm:' + card.dataset.card;
  const rxRow = e.target.closest && e.target.closest('.rx-row');
  if (rxRow) return 'r:' + rxRow.dataset.rxrow;
  const mini = e.target.closest && e.target.closest('.mini-card');
  if (mini) return 'm:' + mini.dataset.mini;
  if (e.target.closest && e.target.closest('#compare-scroll')) {
    // 중앙 차트: 커서 y에 가장 가까운 라인을 타겟팅
    return nearestCompareLine(e);
  }
  return null;
}

function nearestCompareLine(e) {
  if (!REG.cmp) return null;
  const cs = $('#compare-scroll');
  const rect = cs.getBoundingClientRect();
  const cy = e.clientY - rect.top;
  const originX = rect.left;
  const ms = dateFromClientX(e.clientX, originX, cs.scrollLeft);
  if (ms == null) return null;
  let best = null, bestDy = 1e9;
  REG.cmp.seriesIdx.forEach((s) => {
    const pt = s.pts.find((p) => p.ms === ms);
    if (!pt) return;
    const dy = Math.abs(REG.cmp.yOf(pt.idx) - cy);
    if (dy < bestDy) { bestDy = dy; best = 'm:' + s.m.key; }
  });
  return best;
}

function hoverFromEvent(e) {
  let dateMs = null;
  const mini = e.target.closest && e.target.closest('.mini-card');
  const cardWrap = e.target.closest && e.target.closest('.chart-scroll');
  if (mini && REG.minis[mini.dataset.mini]) {
    // 미니맵: 자체 Fit 좌표계에서 날짜 역산 (논리 동기화)
    const b = REG.minis[mini.dataset.mini];
    const rect = mini.getBoundingClientRect();
    const px = (e.clientX - rect.left - 10 - MINI_PADL);
    const plotW = S.miniW - 20 - MINI_PADL - MINI_PADR;
    const ms = G.start + (px / plotW) * G.days * MS;
    dateMs = nearestVisit(ms);
  } else if (S.mode === 'trend' && S.layout === 'card' && cardWrap) {
    const rect = cardWrap.getBoundingClientRect();
    dateMs = dateFromClientX(e.clientX, rect.left, cardWrap.scrollLeft, G.card);
  } else if (e.target.closest && (e.target.closest('.chart-scroll') || e.target.closest('#rx-body') || e.target.closest('#compare-scroll') || e.target.closest('.chart-card'))) {
    dateMs = dateFromClientX(e.clientX, plotOriginScreenX(), S.scroll);
  }
  return dateMs;
}

let dragState = null;
let wheelLock = 0;

function bindEvents() {
  const main = $('#main');

  main.addEventListener('mousemove', (e) => {
    if (dragState && dragState.moved) return;
    if (S.pin) return; // 핀 고정 중 호버로 상태 이동 금지
    const dateMs = hoverFromEvent(e);
    if (dateMs == null) { S.hover = null; refreshHover(); return; }
    S.hover = { dateMs, targetKey: targetKeyFromEvent(e) };
    refreshHover();
  });

  main.addEventListener('mouseleave', () => {
    if (S.pin) return;
    S.hover = null; refreshHover();
  });

  // 클릭: 핀 고정/해제 + 줌 앵커 지정 (가이드 3 클릭 앵커링)
  main.addEventListener('mousedown', (e) => {
    const pannable = e.target.closest && (e.target.closest('.chart-scroll') || e.target.closest('#rx-body') || e.target.closest('#compare-scroll'));
    dragState = { x: e.clientX, moved: false, pan: !!pannable, start: S.scroll };
    if (pannable) pannable.classList.add('panning');
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragState || !dragState.pan) return;
    const dx = e.clientX - dragState.x;
    if (Math.abs(dx) > 4) dragState.moved = true;
    if (dragState.moved && REG.master) REG.master.scrollLeft = dragState.start - dx;
  });
  window.addEventListener('mouseup', (e) => {
    $$('.panning').forEach((el) => el.classList.remove('panning'));
    if (!dragState) return;
    const wasDrag = dragState.moved;
    dragState = null;
    if (wasDrag) return;
    if (e.target.closest && e.target.closest('[data-close]')) { unpin(); return; }
    if (!e.target.closest || !$('#main').contains(e.target)) return;
    const dateMs = hoverFromEvent(e);
    if (S.pin) { unpin(); return; }          // 핀 상태에서 클릭 → 해제
    if (dateMs == null) return;
    S.pin = { dateMs, targetKey: targetKeyFromEvent(e) };
    S.anchorMs = dateMs;                      // 클릭 지점을 새로운 줌 기준점으로
    refreshHover();
  });

  function unpin() { S.pin = null; S.hover = null; refreshHover(); }

  // 핀 고정 툴팁의 ✕ 버튼 (플로팅 레이어는 #main 밖이므로 별도 바인딩)
  $('#floating').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) unpin();
  });

  // 휠 정책: ① 마우스 아래 목록(처방/미니 패널) 스크롤 → ② 차트 영역(페이지) 스크롤
  //          → ③ 스크롤 경계에서 줌 전환 (상단에서 위로=확대, 하단에서 아래로=축소)
  //          가로 휠·트랙패드 가로 제스처는 타임라인 팬
  const canConsume = (el, dy) => !!el && (dy > 0
    ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
    : el.scrollTop > 0);
  main.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const zone = e.target.closest && (e.target.closest('.chart-scroll') || e.target.closest('#rx-sect') || e.target.closest('#axis-body') || e.target.closest('#compare-scroll'));
      if (!zone) return;
      e.preventDefault();
      if (REG.master) REG.master.scrollLeft += e.deltaX;
      return;
    }
    const rxList = e.target.closest && e.target.closest('#rx-sect');
    if (rxList && canConsume(rxList, e.deltaY)) return; // 처방 목록 자체 스크롤
    const mini = e.target.closest && e.target.closest('#mini-panel');
    if (mini && canConsume(mini, e.deltaY)) return;     // 미니 패널 자체 스크롤
    const page = $('#main-scroll');
    if (canConsume(page, e.deltaY)) {
      // overscroll-behavior: contain 으로 전파가 막힌 경우 수동 스크롤
      if (rxList || mini) { e.preventDefault(); page.scrollTop += e.deltaY; }
      return; // 그 외에는 네이티브 세로 스크롤
    }
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLock < 160) return;
    wheelLock = now;
    const dir = e.deltaY < 0 ? 1 : -1;
    const anchor = hoverFromEvent(e);
    applyZoom(scaleIdx() + dir, anchor != null ? anchor : undefined);
  }, { passive: false });

  // 줌 버튼: Snappy — 애니메이션 없이 즉시 전환 (가이드 3)
  $('#zoom-in').addEventListener('click', () => applyZoom(scaleIdx() + 1));
  $('#zoom-out').addEventListener('click', () => applyZoom(scaleIdx() - 1));

  // 모드/레이아웃
  $$('#mode-toggle button').forEach((b) => b.addEventListener('click', () => {
    if (S.mode === b.dataset.mode) return;
    S.mode = b.dataset.mode; S.pin = null; S.hover = null;
    S.scroll = 1e9; // 우측(최신) 정렬
    render();
  }));
  // 레이아웃 토글: 단일 버튼 — 전환될 레이아웃의 아이콘 표시, 비교 모드에서는 비활성
  $('#layout-toggle').addEventListener('click', () => {
    if (S.mode === 'compare') return;
    S.layout = S.layout === 'list' ? 'card' : 'list';
    S.pin = null; render();
  });

  // 기간 프리셋 / 직접 조회
  $$('#preset-group button').forEach((b) => b.addEventListener('click', () => {
    S.presetDays = +b.dataset.days; S.customFrom = S.customTo = null;
    $('#date-from').value = ''; $('#date-to').value = '';
    $$('#preset-group button').forEach((x) => x.classList.toggle('active', x === b));
    S.pin = null; S.scroll = 1e9; render();
  }));
  $('#date-apply').addEventListener('click', () => {
    const f = parseDot($('#date-from').value), t = parseDot($('#date-to').value);
    if (f == null || t == null || f >= t) return;
    S.customFrom = f; S.customTo = t; S.presetDays = null;
    $$('#preset-group button').forEach((x) => x.classList.remove('active'));
    S.pin = null; S.scroll = 1e9; render();
  });

  // 우측 패널 스플리터: 드래그로 좌우 영역 확장/축소 (놓는 순간 좌표계 재계산)
  let splitDrag = null;
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest || !e.target.closest('#mini-splitter')) return;
    splitDrag = { x: e.clientX, w: S.miniW };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!splitDrag) return;
    // 최소 = 기본 폭(258), 최대 = 중앙 지표변화비교 영역이 640px 이상 유지되는 지점
    const scroller = $('#main-scroll');
    const maxW = Math.max(MINI_W, (scroller ? scroller.clientWidth : 1200) - 640);
    const w = Math.max(MINI_W, Math.min(maxW, splitDrag.w + (splitDrag.x - e.clientX)));
    splitDrag.cur = w;
    const col = $('#mini-col');
    if (col) { col.style.flexBasis = w + 'px'; col.style.width = w + 'px'; }
  });
  window.addEventListener('mouseup', () => {
    if (!splitDrag) return;
    if (splitDrag.cur != null && splitDrag.cur !== S.miniW) { S.miniW = splitDrag.cur; render(); }
    splitDrag = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // '추가제안' 토글: Δ요약·목표선·구간 통계 일괄 표시/숨김
  const extrasBtn = $('#extras-toggle');
  if (extrasBtn) extrasBtn.addEventListener('click', () => {
    S.extras = !S.extras;
    extrasBtn.classList.toggle('active', S.extras);
    render();
  });

  // 지표 표시 설정 팝오버
  const pop = $('#metric-pop');
  pop.innerHTML = `<div class="mp-title">표시 지표</div>` + METRICS.map((m) =>
    `<label><input type="checkbox" data-mk="${m.key}" ${S.visible.has(m.key) ? 'checked' : ''}/>
      <span class="dot" style="background:${m.color}"></span>${m.name}</label>`).join('');
  $('#metric-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const r = $('#metric-btn').getBoundingClientRect();
    pop.style.left = `${r.left}px`; pop.style.top = `${r.bottom + 6}px`;
    pop.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!pop.contains(e.target) && e.target !== $('#metric-btn')) pop.classList.remove('open');
  });
  pop.addEventListener('change', (e) => {
    const k = e.target.dataset.mk; if (!k) return;
    if (e.target.checked) S.visible.add(k); else S.visible.delete(k);
    render();
  });

  // 비교 범례 토글
  document.addEventListener('click', (e) => {
    const lg = e.target.closest && e.target.closest('[data-lg]');
    if (!lg) return;
    const k = lg.dataset.lg;
    if (S.visible.has(k)) S.visible.delete(k); else S.visible.add(k);
    render();
  });

  // 처방항목 전체 접기/펼치기 — 세로 공간 재배분을 위해 전체 재렌더
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('#rx-title-row')) return;
    S.rxCollapsed = !S.rxCollapsed;
    S.pin = null; S.hover = null;
    render();
  });

  // 마스터 스크롤 → 전체 동기화 / 세로 스크롤 시 툴팁 리포지셔닝
  document.addEventListener('scroll', (e) => {
    if (e.target && e.target.id === 'master-scroll') syncScroll(e.target.scrollLeft);
    else if (e.target && e.target.id === 'main-scroll') refreshHover();
  }, true);

  let resizeT = null;
  const maybeRerender = () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      // 유효한 크기로 실제 변화가 있을 때만 재렌더 (스크롤바 토글/숨김 상태 진동 방지)
      const scroller = $('#main-scroll');
      const w = scroller ? scroller.clientWidth : 0;
      if (w >= 400 && (!G || w !== G.mainW)) render();
    }, 120);
  };
  window.addEventListener('resize', maybeRerender);
  // 창 숨김→표시 복원 등 resize 이벤트 없는 크기 변화도 감지
  if (window.ResizeObserver) new ResizeObserver(maybeRerender).observe($('#main'));
}

const ICON_LIST = `<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
  <rect x="2" y="3" width="14" height="3" rx="1"/><rect x="2" y="8" width="14" height="3" rx="1"/><rect x="2" y="13" width="14" height="3" rx="1"/></svg>`;
const ICON_CARD = `<svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
  <rect x="2" y="2" width="6" height="6" rx="1"/><rect x="10" y="2" width="6" height="6" rx="1"/>
  <rect x="2" y="10" width="6" height="6" rx="1"/><rect x="10" y="10" width="6" height="6" rx="1"/></svg>`;

function updateLayoutToggle() {
  const btn = $('#layout-toggle');
  const toCard = S.layout === 'list';
  btn.innerHTML = toCard ? ICON_CARD : ICON_LIST;
  btn.title = toCard ? '카드형으로 보기' : '리스트형으로 보기';
  btn.disabled = S.mode === 'compare'; // 지표 변화 비교에서는 레이아웃 개념 없음
}

// 줌 적용: 기준점(앵커) 화면 위치 유지 — 기본은 우측(최신) 고정
function applyZoom(newIdx, anchorMsOpt) {
  newIdx = Math.max(0, Math.min(3, newIdx));
  if (newIdx === scaleIdx()) return;
  const anchorMs = anchorMsOpt != null ? anchorMsOpt : (S.anchorMs != null ? S.anchorMs : G.end);
  const sx = Math.max(0, Math.min(G.plotViewW, G.x(anchorMs) - S.scroll)); // 현재 화면상 위치
  setScaleIdx(newIdx);
  if (!S.pin) S.hover = null; // 스케일 전환 시 잔류 호버 제거
  const g2 = computeGeometry();
  S.scroll = Math.max(0, Math.min(g2.maxScroll, g2.x(anchorMs) - sx));
  render();
}

// ── 시작 ───────────────────────────────────────────────────────
bindEvents();
S.scroll = 1e9; // 최초 진입: 우측(최신) 기준
render();
