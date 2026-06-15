import { tracker } from './tracker';
import { configManager } from './config';
import type { TestReport, CaseResult } from './types';

export function generateReport(suiteName: string, results: CaseResult[]): TestReport {
  return {
    suite: suiteName,
    project: configManager.getProject() ?? 'unknown',
    environment: (window as any).pwaBridge ? 'webview' : 'browser',
    userAgent: navigator.userAgent,
    url: location.href,
    timestamp: Date.now(),
    duration: results.reduce((sum, r) => sum + r.duration, 0),
    results,
    trackedEvents: tracker.getEvents(),
    summary: {
      total: results.length,
      passed: results.filter(r => r.status === 'passed').length,
      failed: results.filter(r => r.status === 'failed').length,
      skipped: results.filter(r => r.status === 'skipped').length,
    },
  };
}

export function printReportToConsole(report: TestReport): void {
  const { summary } = report;
  console.group(`%c[AutoBot] ${report.suite}`, 'color:#00bcd4;font-weight:bold');
  console.log(`${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${report.duration}ms)`);

  for (const r of report.results) {
    const icon = r.status === 'passed' ? '✓' : r.status === 'failed' ? '✗' : '○';
    const color = r.status === 'passed' ? 'green' : r.status === 'failed' ? 'red' : 'gray';
    console.log(`%c  ${icon} ${r.name} (${r.duration}ms)`, `color:${color}`);
    if (r.error) console.log(`    → ${r.error}`);
  }

  if (report.trackedEvents.length > 0) {
    console.log(`\n  Tracked events: ${report.trackedEvents.length}`);
  }
  console.groupEnd();
}

export function exportReportJSON(report: TestReport): string {
  return JSON.stringify(report, null, 2);
}

export function downloadReport(report: TestReport): void {
  const json = exportReportJSON(report);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `autobot_report_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
