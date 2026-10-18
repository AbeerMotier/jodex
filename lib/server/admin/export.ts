import 'server-only';
import { FEEDBACK_RATING_LABEL, PERIOD_LABEL, SEVERITY_LABEL, SOURCE_LABEL, type Source } from '@/lib/domain/catalog';
import { dayLabel, fmtPct, instantDate, instantDayLabel, timeHM } from '@/lib/domain/format';
import type { SessionUser } from '../auth';
import { audit } from '../audit';
import { ApiError } from '../http';
import { buildWorkbook, type SheetSpec } from '../reports/excel';
import { chip, esc, num, reportDocument, table, type Cell } from '../reports/html';
import { htmlToPdf } from '../reports/pdf';
import { parseCommon, parseSource, parseUuid, PERIOD_TEXT, type CommonQuery } from './common';
import { buildDashboard } from './dashboard';
import { listFeedback } from './feedback';
import { listLog, LOG_STATUS_OPTIONS } from './log';
import { listNotes } from './notes';
import { parseEnum } from './params';
import type { EntryView } from './presenters';
import { staffReport } from './staff';

const MAX_ROWS = 5000;
export const REPORTS = ['dashboard', 'log', 'feedback', 'notes', 'staff'] as const;
export type Report = (typeof REPORTS)[number];

const TITLES: Record<Report, string> = {
  dashboard: 'تقرير لوحة المؤشرات',
  log: 'تقرير سجل الجولات',
  feedback: 'تقرير تقييمات المستفيدين',
  notes: 'تقرير ملاحظات المشرفين الميدانيين',
  staff: 'تقرير أداء الموظفين',
};

const pctText = (v: number | null | undefined) => fmtPct(v ?? null, 1);
const pctNum = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 10) / 1000);

interface Built {
  meta: [string, string][];
  pdfBody: string;
  sheets: Omit<SheetSpec, 'title' | 'meta'>[];
  subtitle: string;
}

function baseMeta(q: CommonQuery, now: Date): [string, string][] {
  return [
    ['الفترة', `${PERIOD_TEXT[q.period]} (${dayLabel(q.range.from)} – ${dayLabel(q.range.to)})`],
    ['تاريخ التصدير', `${instantDayLabel(now)} ${timeHM(now)}`],
  ];
}

function entryCells(r: EntryView): Cell[] {
  return [
    `${dayLabel(r.date)}${r.time ? ` · ${timeHM(r.time)}` : ''}`,
    r.typeLabel,
    {
      html: `${esc(r.employee.name)}<br>${chip(r.employee.role === 'supervisor' ? 'المشرف الميداني' : 'مراقب المقاول', r.employee.role === 'supervisor' ? 'supervisor' : 'monitor').html}${
        r.onBehalfOf ? `<div class="muted">بالنيابة عن ${esc(r.onBehalfOf)}</div>` : ''
      }`,
    },
    r.restroom.building,
    r.restroom.floor,
    r.restroom.name,
    r.evalType,
    num(pctText(r.result)),
    chip(r.status.label + (r.urgent ? ' · معالجة فورية' : ''), r.status.tone),
  ];
}

const ENTRY_COLUMNS: SheetSpec['columns'] = [
  { header: 'التاريخ', width: 18 },
  { header: 'الوقت', width: 8 },
  { header: 'نوع الجولة', width: 10 },
  { header: 'الموظف', width: 20 },
  { header: 'الدور الوظيفي', width: 14 },
  { header: 'بالنيابة عن', width: 18 },
  { header: 'المبنى', width: 16 },
  { header: 'الدور', width: 14 },
  { header: 'دورة المياه', width: 18 },
  { header: 'نوع التقييم', width: 14 },
  { header: 'النتيجة', width: 10, numFmt: '0.0%' },
  { header: 'الحالة', width: 22 },
];

function entryRow(r: EntryView): (string | number | null)[] {
  return [
    r.date,
    r.time ? timeHM(r.time) : '—',
    r.typeLabel,
    r.employee.name,
    r.employee.role === 'supervisor' ? 'المشرف الميداني' : 'مراقب المقاول',
    r.onBehalfOf ?? '',
    r.restroom.building,
    r.restroom.floor,
    r.restroom.name,
    r.evalType,
    pctNum(r.result),
    r.status.label + (r.urgent ? ' · معالجة فورية' : ''),
  ];
}

async function buildReport(report: Report, sp: URLSearchParams, user: SessionUser, now: Date): Promise<Built & { q: CommonQuery }> {
  const q = parseCommon(sp, now);
  const meta = baseMeta(q, now);
  switch (report) {
    case 'dashboard': {
      const source: Source = parseSource(sp);
      const d = await buildDashboard(user, q, source, now);
      meta.push(['نوع التقييم', SOURCE_LABEL[source]]);
      const summary: [string, string][] = [[d.total.label, String(d.total.value)]];
      if (d.rounds) {
        summary.push(
          ['الجولات المطلوبة', String(d.rounds.required)],
          ['المكتملة', `${d.rounds.completed} (${pctText(d.rounds.completedPct)})`],
          ['المتأخرة', `${d.rounds.late} (${pctText(d.rounds.latePct)})`],
          ['الفائتة', `${d.rounds.missed} (${pctText(d.rounds.missedPct)})`],
        );
      }
      if (d.quality.contractor) summary.push(['متوسط نتيجة جولات مراقبي المقاول', `${pctText(d.quality.contractor.value)} · ${d.quality.contractor.sub}`]);
      if (d.quality.supervisor) summary.push(['متوسط التقييم العام للمشرفين الميدانيين', `${pctText(d.quality.supervisor.value)} · ${d.quality.supervisor.sub}`]);
      if (d.quality.beneficiary) summary.push(['رضا المستفيدين', `${pctText(d.quality.beneficiary.value)} · ${d.quality.beneficiary.sub}`]);
      if (d.quality.compliance)
        summary.push(['نسبة التزام الجولات', `كلية ${pctText(d.quality.compliance.overall)} · صباحية ${pctText(d.quality.compliance.am)} · مسائية ${pctText(d.quality.compliance.pm)}`]);

      const seriesHead = d.comparison.series.map((s) => (s === 'contractor' ? 'جولات المراقب' : s === 'supervisor' ? 'تقييم المشرف' : 'رضا المستفيدين'));
      const compRows = d.comparison.points.map((p) => [
        p.name,
        `${p.floor} · ${p.building}`,
        ...d.comparison.series.map((s) => (s === 'beneficiary' ? p.satisfaction : p[s])),
      ]);
      const recentEntries = d.recent.kind === 'entries' ? (d.recent.items as EntryView[]) : [];
      const perf = d.performance ?? [];
      const body = [
        `<h2>المؤشرات</h2>`,
        table(['المؤشر', 'القيمة'], summary),
        `<h2>مقارنة الأداء العام</h2>`,
        table(['دورة المياه', 'الموقع', ...seriesHead], compRows.map((r) => r.map((c, i) => (i < 2 ? String(c) : num(pctText(c as number | null)))))),
        recentEntries.length ? `<h2>${d.recent.title}</h2>` + table(['التاريخ والوقت', 'النوع', 'الموظف', 'المبنى', 'الدور', 'دورة المياه', 'نوع التقييم', 'النتيجة', 'الحالة'], recentEntries.map(entryCells)) : '',
        perf.length
          ? `<h2>مؤشرات أداء المقاولين</h2>` +
            table(['المراقب', 'الموقع', 'مستوى الجودة', 'الالتزام', 'الجولات'], perf.map((p) => [p.name, `${p.restroom.name} · ${p.restroom.floor} · ${p.restroom.building}`, num(pctText(p.q)), num(pctText(p.cp)), num(pctText(p.a))]))
          : '',
      ].join('');
      return {
        q,
        meta,
        subtitle: `${PERIOD_LABEL[q.period]} · ${SOURCE_LABEL[source]}`,
        pdfBody: body,
        sheets: [
          { name: 'الملخص', columns: [{ header: 'المؤشر', width: 38 }, { header: 'القيمة', width: 50 }], rows: summary },
          {
            name: 'مقارنة الأداء',
            columns: [{ header: 'دورة المياه', width: 20 }, { header: 'الموقع', width: 30 }, ...seriesHead.map((h) => ({ header: h, width: 16, numFmt: '0.0%' }))],
            rows: compRows.map((r) => r.map((c, i) => (i < 2 ? (c as string) : pctNum(c as number | null)))),
          },
          { name: 'أحدث الجولات', columns: ENTRY_COLUMNS, rows: recentEntries.map(entryRow) },
          {
            name: 'أداء المقاولين',
            columns: [
              { header: 'المراقب', width: 20 },
              { header: 'الموقع', width: 36 },
              { header: 'مستوى الجودة', width: 14, numFmt: '0.0%' },
              { header: 'الالتزام', width: 12, numFmt: '0.0%' },
              { header: 'الجولات (متوسط النتيجة)', width: 20, numFmt: '0.0%' },
            ],
            rows: perf.map((p) => [p.name, `${p.restroom.name} · ${p.restroom.floor} · ${p.restroom.building}`, pctNum(p.q), pctNum(p.cp), pctNum(p.a)]),
          },
        ],
      };
    }
    case 'log': {
      const data = await listLog(
        {
          ...q,
          kind: parseEnum(sp, 'kind', ['round', 'supervisor'] as const),
          status: parseEnum(sp, 'status', LOG_STATUS_OPTIONS.map((o) => o.value)),
          employeeId: parseUuid(sp, 'employee'),
          offset: 0,
          limit: MAX_ROWS,
        },
        now,
      );
      meta.push(['عدد السجلات', String(data.total)]);
      return {
        q,
        meta,
        subtitle: 'جولات مراقبي المقاول وتقييمات المشرفين الميدانيين',
        pdfBody: table(['التاريخ والوقت', 'النوع', 'الموظف', 'المبنى', 'الدور', 'دورة المياه', 'نوع التقييم', 'النتيجة', 'الحالة'], data.rows.map(entryCells)),
        sheets: [{ name: 'سجل الجولات', columns: ENTRY_COLUMNS, rows: data.rows.map(entryRow) }],
      };
    }
    case 'feedback': {
      const data = await listFeedback({ ...q, rating: parseEnum(sp, 'rating', ['excellent', 'good', 'bad'] as const), offset: 0, limit: MAX_ROWS });
      meta.push(['عدد التقييمات', String(data.total)]);
      return {
        q,
        meta,
        subtitle: 'تقييمات المستفيدين عبر رموز QR',
        pdfBody: table(
          ['دورة المياه', 'الموقع', 'تاريخ ووقت الإرسال', 'التقييم', 'سبب عدم الرضا'],
          data.rows.map((r) => [
            r.restroom.name,
            `${r.restroom.floor} · ${r.restroom.building}`,
            `${instantDayLabel(r.submittedAt)} · ${timeHM(r.submittedAt)}`,
            chip(FEEDBACK_RATING_LABEL[r.rating], r.rating === 'bad' ? 'error' : r.rating === 'good' ? 'warning' : 'success'),
            r.reasons.length ? r.reasons.join('، ') : '—',
          ]),
        ),
        sheets: [
          {
            name: 'تقييمات المستفيدين',
            columns: [
              { header: 'دورة المياه', width: 18 },
              { header: 'الدور', width: 14 },
              { header: 'المبنى', width: 16 },
              { header: 'التاريخ', width: 18 },
              { header: 'الوقت', width: 8 },
              { header: 'التقييم', width: 10 },
              { header: 'سبب عدم الرضا', width: 40 },
            ],
            rows: data.rows.map((r) => [r.restroom.name, r.restroom.floor, r.restroom.building, instantDate(r.submittedAt), timeHM(r.submittedAt), FEEDBACK_RATING_LABEL[r.rating], r.reasons.join('، ') || '—']),
          },
        ],
      };
    }
    case 'notes': {
      const data = await listNotes({
        ...q,
        supervisorId: parseUuid(sp, 'supervisor'),
        severity: parseEnum(sp, 'severity', ['high', 'mid', 'low'] as const),
        offset: 0,
        limit: MAX_ROWS,
      });
      meta.push(['عدد الملاحظات', String(data.total)]);
      return {
        q,
        meta,
        subtitle: 'ملاحظات المشرفين الميدانيين (للاطلاع)',
        pdfBody: table(
          ['الملاحظة', 'الأهمية', 'الموقع', 'المشرف الميداني', 'التاريخ والوقت', 'الصور'],
          data.rows.map((n) => [
            n.text,
            chip(SEVERITY_LABEL[n.severity], n.severity === 'high' ? 'error' : n.severity === 'mid' ? 'warning' : 'success'),
            `${n.restroom.name} · ${n.restroom.floor} · ${n.restroom.building}`,
            n.supervisor,
            `${instantDayLabel(n.createdAt)} · ${timeHM(n.createdAt)}`,
            n.photos.length ? `${n.photos.length} صور` : 'بدون صور مرفقة',
          ]),
        ),
        sheets: [
          {
            name: 'الملاحظات',
            columns: [
              { header: 'الملاحظة', width: 44 },
              { header: 'الأهمية', width: 14 },
              { header: 'دورة المياه', width: 18 },
              { header: 'الدور', width: 14 },
              { header: 'المبنى', width: 16 },
              { header: 'المشرف الميداني', width: 18 },
              { header: 'التاريخ', width: 18 },
              { header: 'الوقت', width: 8 },
              { header: 'عدد الصور', width: 10 },
            ],
            rows: data.rows.map((n) => [n.text, SEVERITY_LABEL[n.severity], n.restroom.name, n.restroom.floor, n.restroom.building, n.supervisor, instantDate(n.createdAt), timeHM(n.createdAt), n.photos.length]),
          },
        ],
      };
    }
    case 'staff': {
      const data = await staffReport(
        { ...q, monitorId: parseUuid(sp, 'monitor'), approval: parseEnum(sp, 'approval', ['approved', 'not_approved'] as const) },
        now,
      );
      return {
        q,
        meta,
        subtitle: 'المرشحون للمكافأة وأداء المراقبين الأساسيين',
        pdfBody: [
          '<h2>المرشحون للمكافأة</h2>',
          table(
            ['#', 'الموظف', 'الموقع', 'الالتزام', 'الجودة', 'الاعتماد'],
            data.candidates.map((c) => [String(c.rank), c.name, `${c.restroom.name} · ${c.restroom.floor} · ${c.restroom.building}`, num(pctText(c.cp)), num(pctText(c.q)), chip(c.approved ? 'معتمد ✓' : 'غير معتمد', c.approved ? 'success' : 'neutral')]),
            { empty: 'لا يوجد مرشحون في هذه الفترة.' },
          ),
          '<h2>أداء الموظفين</h2>',
          table(
            ['#', 'الموظف', 'الموقع', 'الجولات', 'نسبة الالتزام', 'الجودة', 'التصنيف'],
            data.rows.map((r) => [
              String(r.rank),
              r.name,
              `${r.restroom.name} · ${r.restroom.floor} · ${r.restroom.building}`,
              num(`${r.completed} / ${r.required}`),
              num(pctText(r.cp)),
              num(pctText(r.q)),
              r.classificationLabel ? chip(r.classificationLabel, r.classification === 'excellent' ? 'success' : r.classification === 'regular' ? 'warning' : 'error') : '—',
            ]),
          ),
        ].join(''),
        sheets: [
          {
            name: 'المرشحون للمكافأة',
            columns: [
              { header: '#', width: 5 },
              { header: 'الموظف', width: 20 },
              { header: 'الموقع', width: 36 },
              { header: 'الالتزام', width: 12, numFmt: '0.0%' },
              { header: 'الجودة', width: 12, numFmt: '0.0%' },
              { header: 'الاعتماد', width: 12 },
            ],
            rows: data.candidates.map((c) => [c.rank, c.name, `${c.restroom.name} · ${c.restroom.floor} · ${c.restroom.building}`, pctNum(c.cp), pctNum(c.q), c.approved ? 'معتمد' : 'غير معتمد']),
          },
          {
            name: 'أداء الموظفين',
            columns: [
              { header: '#', width: 5 },
              { header: 'الموظف', width: 20 },
              { header: 'الموقع', width: 36 },
              { header: 'المكتملة', width: 10 },
              { header: 'المطلوبة', width: 10 },
              { header: 'نسبة الالتزام', width: 14, numFmt: '0.0%' },
              { header: 'متوسط جودة الجولات', width: 16, numFmt: '0.0%' },
              { header: 'متوسط تقييم المشرف', width: 16, numFmt: '0.0%' },
              { header: 'الجودة', width: 12, numFmt: '0.0%' },
              { header: 'التصنيف', width: 14 },
            ],
            rows: data.rows.map((r) => [r.rank, r.name, `${r.restroom.name} · ${r.restroom.floor} · ${r.restroom.building}`, r.completed, r.required, pctNum(r.cp), pctNum(r.a), pctNum(r.s), pctNum(r.q), r.classificationLabel ?? '—']),
          },
        ],
      };
    }
  }
}

export async function exportReport(user: SessionUser, sp: URLSearchParams, now: Date) {
  const report = parseEnum(sp, 'report', REPORTS);
  const format = parseEnum(sp, 'format', ['pdf', 'xlsx'] as const);
  if (!report || !format) throw new ApiError(422, 'bad_export', 'حدد نوع التقرير وصيغته.');
  const built = await buildReport(report, sp, user, now);
  const title = TITLES[report];
  const fileBase = `jodex-${report}-${built.q.range.from}_${built.q.range.to}`;
  let body: Buffer;
  let contentType: string;
  if (format === 'pdf') {
    const html = await reportDocument({ title, subtitle: built.subtitle, meta: built.meta, body: built.pdfBody });
    body = await htmlToPdf(html, { format: 'A4', landscape: report === 'log' });
    contentType = 'application/pdf';
  } else {
    body = await buildWorkbook(built.sheets.map((s) => ({ ...s, title: `${title} — جُودِكس`, meta: built.meta })));
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  await audit(user.id, 'report.export', 'reports', report, { format, query: Object.fromEntries(sp.entries()) });
  return { body, contentType, filename: `${fileBase}.${format}` };
}

