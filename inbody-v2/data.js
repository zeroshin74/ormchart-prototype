// ── 인바디 결과 분석 v2 — Mock Data ──────────────────────────────
// 환자: 이요원 (32세/여) cn.57 / 1989.10.04
// 최신 측정일 기준 오늘: 2026-09-02

const TODAY = '2026-09-02';

const PATIENT = {
  name: '이요원',
  ageSex: '32세/여',
  chartNo: 'cn.57',
  birth: '1989.10.04',
};

// 외래 방문(측정)일 — 실제 외래 간격 패턴 (3년: 2023-09 ~ 오늘)
const VISIT_DATES = [
  '2023-09-20', '2023-10-18', '2023-11-15', '2023-12-13',
  '2024-01-10', '2024-02-07', '2024-03-06', '2024-04-10', '2024-05-08',
  '2024-06-12', '2024-07-17', '2024-08-21', '2024-09-25', '2024-10-23',
  '2024-11-20', '2024-12-18',
  '2025-01-08', '2025-02-05', '2025-03-05', '2025-03-19', '2025-04-10',
  '2025-04-24', '2025-05-13', '2025-06-01', '2025-06-27', '2025-07-17',
  '2025-08-04', '2025-08-19', '2025-08-30', '2025-09-14', '2025-10-03',
  '2025-10-30', '2025-11-22', '2025-12-04', '2025-12-29', '2026-01-14',
  '2026-01-30', '2026-02-18', '2026-03-04', '2026-03-18', '2026-03-30',
  '2026-04-15', '2026-04-22', '2026-05-04', '2026-05-13', '2026-05-29',
  '2026-06-13', '2026-06-24', '2026-07-05', '2026-07-16', '2026-07-24',
  '2026-08-02', '2026-08-11', '2026-08-22', '2026-08-30',
];

// 결정적(비랜덤) 시계열 생성: 감소 곡선 + 미세 요동
function genSeries(start, end, wiggle, decimals, recoverFrom) {
  const n = VISIT_DATES.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let v;
    if (recoverFrom != null && t > recoverFrom) {
      // 말기 반등 곡선 (골격근량 회복 등): 저점에서 완만히 상승
      const low = start + (end - start) * (1 - Math.pow(1 - recoverFrom, 1.6));
      const rt = (t - recoverFrom) / (1 - recoverFrom);
      v = low + Math.abs(end - start) * 0.12 * rt * rt;
    } else {
      v = start + (end - start) * (1 - Math.pow(1 - t, 1.6));
    }
    v += wiggle * Math.sin(i * 1.7) + wiggle * 0.6 * Math.cos(i * 0.9);
    out.push(+v.toFixed(decimals));
  }
  return out;
}

const _weight = genSeries(98.4, 70.8, 0.35, 1);
const _bfm = genSeries(47.2, 25.7, 0.28, 1);
const _smm = genSeries(25.3, 21.4, 0.12, 1, 0.85); // 말기 소폭 회복
const _pbf = _weight.map((w, i) => +((_bfm[i] / w) * 100).toFixed(1));
const _bmi = _weight.map((w) => +(w / (1.63 * 1.63)).toFixed(1));
const _ecw = genSeries(0.369, 0.384, 0.0009, 3);

function seriesOf(values) {
  return VISIT_DATES.map((d, i) => ({ date: d, value: values[i] }));
}

// 지표 정의 — 색/단위/표준치/정상범위 밴드
const METRICS = [
  {
    key: 'weight', name: '체중', unit: 'kg', color: '#3D8BFF',
    std: 57.5, goal: 65.0, // 목표 체중(의사 입력값 가정) — '추가제안' ON 시 목표선 표시
    data: seriesOf(_weight), bands: [],
  },
  {
    key: 'smm', name: '골격근량', unit: 'kg', color: '#00B98D',
    std: 22.1, data: seriesOf(_smm), bands: [],
  },
  {
    key: 'bfm', name: '체지방량', unit: 'kg', color: '#FF8A3D',
    std: 15.0, data: seriesOf(_bfm), bands: [],
  },
  {
    key: 'pbf', name: '체지방률', unit: '%', color: '#FF3D77',
    std: 28.0, data: seriesOf(_pbf),
    bands: [
      { from: 28, to: null, color: 'rgba(255,61,119,0.07)' },  // 표준 이상
      { from: 18, to: 28, color: 'rgba(0,185,141,0.08)' },     // 정상
    ],
  },
  {
    key: 'ecw', name: '세포외수분비', unit: 'ratio', color: '#8B5CF6',
    std: 0.380, data: seriesOf(_ecw),
    bands: [],
    refLine: { value: 0.390, color: '#FF5A5A', label: '부종 경계 0.390' },
  },
  {
    key: 'bmi', name: '체질량지수', unit: 'kg/m²', color: '#00B5C9',
    std: 23.0, data: seriesOf(_bmi),
    bands: [
      { from: 25, to: null, color: 'rgba(255,90,90,0.08)' },   // 비만
      { from: 23, to: 25, color: 'rgba(255,190,60,0.10)' },    // 과체중
      { from: 18.5, to: 23, color: 'rgba(0,185,141,0.08)' },   // 정상
    ],
  },
  {
    key: 'bcm', name: '체세포량', unit: 'kg', color: '#5B6470',
    std: 30.2,
    // 단 1회 측정 → Ring 강조 대상 (가이드 5. 단일 데이터 강조)
    data: [{ date: '2026-07-24', value: 29.4 }],
    bands: [],
  },
];

// ── 처방항목 ────────────────────────────────────────────────────
// dose=용량, perDay=일투수, days=일수, note=주요 임상 시나리오
function rxEvents(dates, mk) {
  return dates.map((d, i) => Object.assign({ date: d, dose: 1, perDay: 1, days: 7 }, mk ? mk(d, i) : {}));
}

// 밀집 처방 시나리오: 3년간 주 4회 처방 (요일 스케줄 기반)
const RX_START = '2023-09-20', RX_END = '2026-09-01';

function genWeeklyDates(startStr, endStr, weekdays) {
  const out = [];
  const d = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  while (d <= end) {
    if (weekdays.includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const PRESCRIPTIONS = [
  {
    key: 'wegovy', name: '위고비 2.4mg', code: '35248621',
    // 월·화·목·금 주 4회
    events: rxEvents(genWeeklyDates(RX_START, RX_END, [1, 2, 4, 5]), (d, i) => {
      const e = { days: 7 };
      if (i === 0) e.note = '약제 시작 (0.25mg 시작 용량)';
      if (d === '2024-09-02') e.note = '용량 증량 (1.0→1.7mg)';
      if (d === '2025-12-29') e.note = '유지용량 도달 (2.4mg)';
      return e;
    }),
  },
  {
    key: 'posture', name: '체형교정치료', code: '51200342',
    // 월·수·금·토 주 4회
    events: rxEvents(genWeeklyDates(RX_START, RX_END, [1, 3, 5, 6]), (d, i) => ({
      days: 1, note: i === 0 ? '치료 시작' : undefined,
    })),
  },
  {
    key: 'lipo', name: '지방흡입술', code: '77031205',
    // 화·수·금·토 주 4회
    events: rxEvents(genWeeklyDates(RX_START, RX_END, [2, 3, 5, 6]), (d) => ({
      days: 1,
      note: d === '2024-05-08' ? '시술 시행일 (허벅지)'
        : d === '2025-08-19' ? '시술 시행일 (복부)' : undefined,
    })),
  },
  {
    key: 'saxenda', name: '삭센다펜주 6mg/mL', code: '643505841',
    // 일·수·목·토 주 4회
    events: rxEvents(genWeeklyDates(RX_START, RX_END, [0, 3, 4, 6]), (d, i) => ({
      days: 7, note: i === 0 ? '약제 시작' : undefined,
    })),
  },
];
