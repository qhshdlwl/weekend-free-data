// 서울시 문화행사 정보(서울 열린데이터광장 OA-15486) → events.json
// 무료 + 아직 안 끝난 + 3주 안에 시작하는 행사만 남긴다. 매일 GitHub Actions가 실행한다.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const KEY = process.env.SEOUL_API_KEY;
if (!KEY) throw new Error("SEOUL_API_KEY 없음");
const PAGE = 1000;
const MAX_PAGES = 30;
const AHEAD_DAYS = 21;

const kst = new Date(Date.now() + 9 * 3600e3);
const today = kst.toISOString().slice(0, 10);
const horizon = new Date(kst.getTime() + AHEAD_DAYS * 86400e3).toISOString().slice(0, 10);

async function page(n) {
  const start = (n - 1) * PAGE + 1;
  const url = `http://openapi.seoul.go.kr:8088/${KEY}/json/culturalEventInfo/${start}/${start + PAGE - 1}/`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      const j = await r.json();
      const body = j.culturalEventInfo;
      if (!body) throw new Error(JSON.stringify(j).slice(0, 200));
      return { total: body.list_total_count, rows: body.row ?? [] };
    } catch (e) {
      console.error(`페이지 ${n} 실패(${attempt}/3):`, e.message);
      await new Promise((res) => setTimeout(res, 3000 * attempt));
    }
  }
  throw new Error(`페이지 ${n} 포기`);
}

const d10 = (s) => (s ?? "").slice(0, 10);
const num = (s) => { const v = Number(s); return Number.isFinite(v) && v !== 0 ? v : null; };
const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const idOf = (r) => r.HMPG_ADDR?.match(/cultcode=(\d+)/)?.[1] ?? createHash("sha1").update(r.TITLE + r.STRTDATE + r.PLACE).digest("hex").slice(0, 10);

const all = [];
let total = Infinity;
for (let n = 1; n <= MAX_PAGES && (n - 1) * PAGE < total; n++) {
  const { total: t, rows } = await page(n);
  total = t;
  all.push(...rows);
}

const seen = new Set();
const events = all
  .filter((r) => r.IS_FREE === "무료" && d10(r.END_DATE) >= today && d10(r.STRTDATE) <= horizon)
  .map((r) => ({
    id: idOf(r), title: clean(r.TITLE), cat: clean(r.CODENAME), gu: clean(r.GUNAME), place: clean(r.PLACE),
    start: d10(r.STRTDATE), end: d10(r.END_DATE), time: clean(r.PRO_TIME), target: clean(r.USE_TRGT),
    lat: num(r.LAT), lng: num(r.LOT), img: r.MAIN_IMG || null, url: r.HMPG_ADDR || r.ORG_LINK || null,
    org: clean(r.ORG_NAME), desc: clean(r.PROGRAM).slice(0, 600),
  }))
  .filter((e) => (seen.has(e.id) ? false : seen.add(e.id)))
  .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

// 좌표가 위경도 뒤바뀐 행(경도 자리에 37.x)이 있으면 바로잡는다
for (const e of events) if (e.lat && e.lng && e.lat > 100 && e.lng < 90) [e.lat, e.lng] = [e.lng, e.lat];

// 급격한 감소는 API 형식 변경·장애일 가능성이 크다 → 덮어쓰지 않고 실패시켜 이전 데이터를 지킨다
if (existsSync("events.json")) {
  const prev = JSON.parse(readFileSync("events.json", "utf8"));
  if (prev.count >= 50 && events.length < prev.count * 0.3) {
    throw new Error(`행사 수 급감 (${prev.count} → ${events.length}). API 응답을 확인할 것`);
  }
}
if (events.length === 0) throw new Error("행사 0건 — API 응답 형식 확인");

writeFileSync("events.json", JSON.stringify({ updatedAt: new Date().toISOString(), source: "서울시 문화행사 정보 (서울 열린데이터광장 OA-15486, 공공누리 1유형)", count: events.length, events }));
console.log(`전체 ${all.length}건 → 무료·진행중·3주내 ${events.length}건, ${new Date().toISOString()}`);
